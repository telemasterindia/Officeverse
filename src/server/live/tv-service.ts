/**
 * Officeverse — Live Experience: the read-only Office TV state (Phase 21).
 *
 * Authenticated ONLY by a display token (never a user session). Returns exactly
 * what a large-screen office scoreboard needs and NOTHING sensitive:
 *   - the Phase-20 authoritative leaderboard (rank / real photo / points /
 *     badge / streak) — no duplicate ranking logic
 *   - team-level counters (submitted / accepted / sales / points today)
 *   - the current admin announcement, if any (server-authoritative time)
 *   - new recognition moments since the client's last `seq`
 *
 * NEVER returned: lead PII, phone/address, salary/HR data, follow-up failures,
 * late/leave status, private contact info. The TV cannot mutate anything.
 */
import { desc, inArray } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { staffPhotos, users } from "@/lib/db/schema";
import { HttpError } from "../http-error";
import { currentShiftDate, nowIST } from "../time";
import { getPhotoStore } from "../hr/photo-storage";
import { getAssetStore } from "./asset-storage";
import { listAgentPresence } from "../presence/service";
import { getLeaderboard, type LeaderboardEntry } from "../gamification/service";
import { pointsByReferences, performanceAggregate } from "../db/repos/gamification";
import { resolvePerformancePeriod } from "../gamification/performance";
import * as repo from "../db/repos/office-tv";
import { recognitionBus } from "./bus";
import { resolveTvConfig, type TvConfig } from "./config";
import { currentAnnouncementForTv } from "./service";
import { hashDisplayToken, tokenMatchesHash } from "./tokens";
import { buildRecentRecognitionFeed, type RecentRecognitionItem } from "./recognition-feed";

/* --------------------------- token auth --------------------------- */

export interface VerifiedDisplay {
  id: number;
  name: string;
  scope: string;
}

/** Verify a raw bearer token. Throws HttpError(401) if unknown / disabled /
 *  revoked. Constant-time hash comparison; no token value is ever logged. */
export async function verifyDisplayToken(
  rawToken: string | null | undefined,
): Promise<VerifiedDisplay> {
  const token = (rawToken ?? "").trim();
  if (!token || token.length < 16) {
    throw new HttpError(401, "Display token required", "no_token");
  }
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const row = await repo.findDisplayByHash(hashDisplayToken(token));
  if (!row || !row.enabled || row.revokedAt) {
    throw new HttpError(401, "Invalid or revoked display token", "bad_token");
  }
  // defence in depth: re-check with a constant-time compare
  if (!tokenMatchesHash(token, row.tokenHash)) {
    throw new HttpError(401, "Invalid display token", "bad_token");
  }
  if (row.scope !== "tv_read") {
    throw new HttpError(403, "Display token is not read-scoped", "bad_scope");
  }
  return { id: row.id, name: row.name, scope: row.scope };
}

/* ------------------------- approved video bytes ------------------- */

export interface TvAssetBytes {
  mime: string;
  bytes: Uint8Array;
}

/** Approved celebration video bytes for the TV, token-authenticated. Returns
 *  null when the asset is unknown / disabled / has no stored file (the TV then
 *  falls back to the built-in CSS effect). */
export async function tvAssetBytes(
  rawToken: string | null | undefined,
  assetId: number,
): Promise<TvAssetBytes | null> {
  await verifyDisplayToken(rawToken);
  if (!isDbConfigured()) return null;
  const row = await repo.getAsset(assetId).catch(() => undefined);
  if (!row || !row.enabled || !row.storageKey || row.kind !== "video") return null;
  const bytes = await getAssetStore()
    .get(row.storageKey)
    .catch(() => null);
  if (!bytes) return null;
  return { mime: row.mime ?? "video/mp4", bytes };
}

/* --------------------------- photo cache -------------------------- */

interface PhotoCacheEntry {
  atMs: number;
  data: Map<number, { mime: string | null; b64: string | null }>;
}
const g = globalThis as unknown as { __ovTvPhotoCache?: PhotoCacheEntry };
const PHOTO_TTL_MS = 30_000;
// leaderboard top rows + the current celebration subject(s)
const MAX_PHOTOS = 16;

async function photosFor(userIds: number[]): Promise<Record<number, string | null>> {
  const wanted = userIds.slice(0, MAX_PHOTOS);
  const cache = g.__ovTvPhotoCache;
  const fresh = cache && Date.now() - cache.atMs < PHOTO_TTL_MS ? cache.data : null;
  const out: Record<number, string | null> = {};
  const missing: number[] = [];
  for (const id of wanted) {
    const hit = fresh?.get(id);
    if (hit) out[id] = hit.b64 ? `data:${hit.mime ?? "image/jpeg"};base64,${hit.b64}` : null;
    else missing.push(id);
  }
  if (missing.length === 0) return out;

  const db = getDb();
  const rows = await db
    .select()
    .from(staffPhotos)
    .where(inArray(staffPhotos.userId, missing))
    .orderBy(desc(staffPhotos.id));
  const latest = new Map<number, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.userId)) latest.set(r.userId, r);

  const store = getPhotoStore();
  const next = fresh ?? new Map<number, { mime: string | null; b64: string | null }>();
  for (const id of missing) {
    const r = latest.get(id);
    if (!r) {
      next.set(id, { mime: null, b64: null });
      out[id] = null;
      continue;
    }
    try {
      const bytes = await store.get(r.path);
      const b64 = bytes ? Buffer.from(bytes).toString("base64") : null;
      next.set(id, { mime: r.mime ?? null, b64 });
      out[id] = b64 ? `data:${r.mime ?? "image/jpeg"};base64,${b64}` : null;
    } catch {
      next.set(id, { mime: null, b64: null });
      out[id] = null;
    }
  }
  g.__ovTvPhotoCache = { atMs: Date.now(), data: next };
  return out;
}

/* ---------------------------- tv state --------------------------- */

export interface TvLeaderRow {
  rank: number;
  userId: number;
  name: string;
  role: string;
  points: number;
  badge: string | null;
  streak: number;
  photo: string | null;
}

/** Stage 5 — one row per agent for the "Today's Production" screen. Actual work
 *  completed today, NOT points/ranking. Read straight from the authoritative
 *  per-agent aggregation the Performance screen already uses — no new scoring. */
export interface TvProductionRow {
  userId: number;
  name: string;
  photo: string | null;
  leadsSubmitted: number;
  leadsAccepted: number;
  sales: number;
}

export interface TvState {
  dbUnavailable?: boolean;
  serverTimeMs: number;
  serverDate: string;
  config: Pick<TvConfig, "displayName" | "rotationSec" | "soundEnabled" | "celebrationIntensity">;
  window: string;
  leaderboard: TvLeaderRow[];
  team: {
    leadsSubmitted: number;
    leadsAccepted: number;
    sales: number;
    teamPoints: number;
    onlineCount: number;
  };
  /** Stage 5 — "Today's Production" screen data (agents only). */
  dailyProduction: TvProductionRow[];
  /** Stage 5 — the active Power Hour, or null. Reuses the existing announcement
   *  (`effect = POWERHOUR`) — no new engine, no new table. */
  powerHour: { title: string; message: string } | null;
  /** Stage 5 — reserved rotation slot. No team-photo configuration exists in the
   *  current product, so this is always null and the screen is never shown. */
  teamPhoto: null;
  announcement: Awaited<ReturnType<typeof currentAnnouncementForTv>>;
  live: { latestSeq: number; items: ReturnType<typeof recognitionBus.since> };
  /** enriched recent recognition — the Office TV "Recent Achievement" screen */
  recent: RecentRecognitionItem[];
}

export interface TvStateInput {
  kind?: string | undefined;
  sinceSeq?: number | undefined;
}

export async function tvState(
  rawToken: string | null | undefined,
  input: TvStateInput = {},
): Promise<TvState> {
  const display = await verifyDisplayToken(rawToken);
  const nowMs = Date.now();
  const serverDate = currentShiftDate("US");

  if (!isDbConfigured()) {
    return {
      dbUnavailable: true,
      serverTimeMs: nowMs,
      serverDate,
      config: {
        displayName: "Officeverse Live",
        rotationSec: 12,
        soundEnabled: false,
        celebrationIntensity: "normal",
      },
      window: "daily",
      leaderboard: [],
      team: { leadsSubmitted: 0, leadsAccepted: 0, sales: 0, teamPoints: 0, onlineCount: 0 },
      dailyProduction: [],
      powerHour: null,
      teamPhoto: null,
      announcement: null,
      live: { latestSeq: recognitionBus.latestSeq(), items: [] },
      recent: [],
    };
  }

  // best-effort touch of the display heartbeat
  repo.touchDisplaySeen(display.id, nowIST()).catch(() => undefined);

  const settingsRow = await repo.getTvSettings().catch(() => undefined);
  const cfg = resolveTvConfig(settingsRow as Record<string, unknown> | undefined);
  const window =
    input.kind && ["daily", "weekly", "monthly", "alltime"].includes(input.kind)
      ? input.kind
      : cfg.leaderboardWindow;

  // Stage 5 — "Today's Production" per agent, from the SAME authoritative
  // per-participant aggregation the Performance screen uses. Today's operational
  // window, ledger-derived; this screen NEVER writes points.
  const prodPeriod = resolvePerformancePeriod(serverDate, { period: "today" });

  const [board, kindCounts, announcement, presence, prodAgg] = await Promise.all([
    getLeaderboard({ id: -1, process: "US" }, { kind: window }).catch(() => null),
    repo.countEventsByKindSince(serverDate).catch(() => [] as { kind: string; n: number }[]),
    currentAnnouncementForTv(nowMs).catch(() => null),
    listAgentPresence().catch(() => null),
    performanceAggregate(prodPeriod.from, prodPeriod.to, {}).catch(() => []),
  ]);

  // agents only, ordered by ACTUAL WORK (accepted → submitted → sales) so the
  // screen reads visibly differently from the points leaderboard.
  const production = prodAgg
    .filter((r) => r.role === "agent")
    .sort(
      (a, b) =>
        b.leadsAccepted - a.leadsAccepted ||
        b.leadsSubmitted - a.leadsSubmitted ||
        b.sales - a.sales ||
        a.userId - b.userId,
    )
    .slice(0, 12);

  const rows: LeaderboardEntry[] = board?.rows ?? [];
  const top = rows.slice(0, 15);

  // Phase 6: the cinematic celebration scene needs the subject's REAL official
  // photo. Deliver it through the SAME token-authed Office-TV photo path the
  // leaderboard already uses (no new endpoint, no bytes in the event). Put the
  // celebration subject(s) FIRST so they are always within MAX_PHOTOS.
  const liveItems = recognitionBus.since(Number(input.sinceSeq ?? 0) || 0);
  const celebSubjectIds = liveItems
    .filter((i) => i.type === "celebration" && i.data && typeof i.data === "object")
    .map((i) => (i.data as { subject?: { userId?: unknown } }).subject?.userId)
    .filter((n): n is number => typeof n === "number" && n > 0);

  // Phase 10 Stage 3 — the "Recent Achievement" screen reads the EXISTING
  // office_tv_events recognition log; enrich it with the subject's name / photo
  // (token-authed path) and authoritative points (ACTIVE ledger, never recomputed).
  const recentRows = (await repo.listEventsForDate(serverDate, 12).catch(() => [])).slice(0, 8);
  const recentSubjectIds = recentRows
    .map((e) => e.subjectUserId)
    .filter((n): n is number => typeof n === "number" && n > 0);

  const photoIds = [
    ...new Set([
      ...celebSubjectIds,
      ...top.map((r) => r.userId),
      ...recentSubjectIds,
      ...production.map((r) => r.userId),
    ]),
  ];
  const photos = await photosFor(photoIds).catch(() => ({}) as Record<number, string | null>);
  const liveItemsWithPhoto = liveItems.map((i) => {
    if (i.type !== "celebration" || !i.data || typeof i.data !== "object") return i;
    const d = i.data as { subject?: { userId?: unknown } | null } & Record<string, unknown>;
    const uid = d.subject?.userId;
    if (typeof uid !== "number" || !d.subject) return i;
    return { ...i, data: { ...d, subject: { ...d.subject, photo: photos[uid] ?? null } } };
  });

  const countBy = (k: string) => kindCounts.find((c) => c.kind === k)?.n ?? 0;
  const onlineCount = presence?.agents?.filter((a) => a.status === "ONLINE").length ?? 0;

  const [nameRows, pointsMap] = await Promise.all([
    recentSubjectIds.length
      ? getDb()
          .select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(inArray(users.id, [...new Set(recentSubjectIds)]))
          .catch(() => [] as { id: number; fullName: string }[])
      : Promise.resolve([] as { id: number; fullName: string }[]),
    recentRows.length
      ? pointsByReferences(
          recentRows
            .filter((e) => e.subjectUserId != null)
            .map((e) => ({
              userId: e.subjectUserId!,
              referenceType: e.referenceType ?? null,
              referenceId: e.referenceId ?? null,
            })),
        ).catch(() => ({}) as Record<string, number>)
      : Promise.resolve({} as Record<string, number>),
  ]);
  const names: Record<number, string | null> = {};
  for (const r of nameRows) names[r.id] = r.fullName;
  const recentFeed = buildRecentRecognitionFeed(
    recentRows.map((e) => ({
      id: e.id,
      kind: e.kind,
      subjectUserId: e.subjectUserId ?? null,
      message: e.message ?? null,
      tier: e.tier,
      referenceType: e.referenceType ?? null,
      referenceId: e.referenceId ?? null,
      createdAt: e.createdAt,
    })),
    { names, photos, points: pointsMap },
  );

  return {
    serverTimeMs: nowMs,
    serverDate,
    config: {
      displayName: cfg.displayName,
      rotationSec: cfg.rotationSec,
      soundEnabled: cfg.soundEnabled,
      celebrationIntensity: cfg.celebrationIntensity,
    },
    window,
    leaderboard: top.map((r) => ({
      rank: r.rank,
      userId: r.userId,
      name: r.name,
      role: r.role,
      points: r.points,
      badge: r.topBadge,
      streak: r.streak,
      photo: photos[r.userId] ?? null,
    })),
    team: {
      leadsSubmitted: countBy("LEAD_SUBMITTED"),
      leadsAccepted: countBy("LEAD_ACCEPTED") + countBy("THIRD_ACCEPTED_LEAD"),
      sales: countBy("SALE"),
      teamPoints: rows.reduce((acc, r) => acc + (r.points > 0 ? r.points : 0), 0),
      onlineCount,
    },
    dailyProduction: production.map((r) => ({
      userId: r.userId,
      name: r.name,
      photo: photos[r.userId] ?? null,
      leadsSubmitted: r.leadsSubmitted,
      leadsAccepted: r.leadsAccepted,
      sales: r.sales,
    })),
    powerHour:
      announcement && announcement.effect === "POWERHOUR"
        ? { title: announcement.title, message: announcement.message }
        : null,
    teamPhoto: null,
    announcement,
    live: {
      latestSeq: recognitionBus.latestSeq(),
      items: liveItemsWithPhoto,
    },
    recent: recentFeed,
  };
}
