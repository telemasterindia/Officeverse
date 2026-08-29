/**
 * Officeverse — Live Experience admin service (Phase 21).
 *
 * Admin-only management of: display tokens, TV settings, the celebration asset
 * library (incl. validated video upload), and the broadcast/announcement
 * engine. Every mutation is permission-checked (`assertCanManageOfficeTv`) and
 * written to the audit log. NOTHING here touches payroll / salary / incentive /
 * commission — an announcement is an announcement, never a money rule.
 */
import { getDb, isDbConfigured } from "@/lib/db";
import { celebrationAssets, type User } from "@/lib/db/schema";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { nowIST, istWallClockToEpochMs } from "../time";
import { assertCanManageOfficeTv, assertValidAnnouncement } from "../authz/office-tv";
import * as repo from "../db/repos/office-tv";
import { DEFAULT_CELEBRATION_ASSETS, isCelebrationCategory } from "./assets";
import { DEFAULT_TV_CONFIG, resolveTvConfig, type TvConfig } from "./config";
import { generateDisplayToken } from "./tokens";
import { celebrationAssetKey, getAssetStore, __resetAssetStore } from "./asset-storage";
import { validateCelebrationUpload, MAX_CELEBRATION_BYTES } from "./asset-validate";
import { pickActiveAnnouncement, expiredAnnouncementIds } from "./announcement-select";

export { __resetAssetStore };

type Meta = { ip?: string | null; userAgent?: string | null };

function wallToMs(wall: string | null | undefined): number | null {
  if (!wall) return null;
  try {
    return istWallClockToEpochMs(wall);
  } catch {
    return null;
  }
}

/* ============================ seeding ========================= */

export async function seedOfficeTv(
  actor: Pick<User, "id" | "role">,
  meta: Meta = {},
): Promise<{ dbUnavailable?: boolean; assetsAdded: number; settingsCreated: boolean }> {
  assertCanManageOfficeTv(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, assetsAdded: 0, settingsCreated: false };
  const db = getDb();
  const now = nowIST();

  const existing = await repo.listAssets(db);
  const have = new Set(existing.map((a) => `${a.category}:${a.kind}`));
  let assetsAdded = 0;
  for (const a of DEFAULT_CELEBRATION_ASSETS) {
    if (have.has(`${a.category}:${a.kind}`)) continue;
    await db.insert(celebrationAssets).values({
      category: a.category,
      kind: a.kind,
      label: a.label,
      effect: a.effect,
      enabled: a.enabled,
      builtin: a.builtin,
      createdAt: now,
    });
    assetsAdded += 1;
  }

  const settings = await repo.getTvSettings(db);
  let settingsCreated = false;
  if (!settings) {
    await repo.upsertTvSettings(
      {
        displayName: DEFAULT_TV_CONFIG.displayName,
        rotationSec: DEFAULT_TV_CONFIG.rotationSec,
        leaderboardWindow: DEFAULT_TV_CONFIG.leaderboardWindow,
        celebrationIntensity: DEFAULT_TV_CONFIG.celebrationIntensity,
        soundEnabled: DEFAULT_TV_CONFIG.soundEnabled,
        thirdAcceptedThreshold: DEFAULT_TV_CONFIG.thirdAcceptedThreshold,
        teamMilestoneEvery: DEFAULT_TV_CONFIG.teamMilestoneEvery,
        updatedByUserId: actor.id,
        updatedAt: now,
      },
      db,
    );
    settingsCreated = true;
  }

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "office_tv.seed",
    entityType: "office_tv",
    metadata: { assetsAdded, settingsCreated },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { assetsAdded, settingsCreated };
}

/* ======================= display tokens ===================== */

export interface DisplayDTO {
  id: number;
  name: string;
  tokenPrefix: string;
  scope: string;
  enabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  rotatedAt: string | null;
}

function toDisplayDTO(r: Awaited<ReturnType<typeof repo.listDisplays>>[number]): DisplayDTO {
  return {
    id: r.id,
    name: r.name,
    tokenPrefix: r.tokenPrefix,
    scope: r.scope,
    enabled: r.enabled && !r.revokedAt,
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt ?? null,
    revokedAt: r.revokedAt ?? null,
    rotatedAt: r.rotatedAt ?? null,
  };
}

export async function listDisplays(
  actor: Pick<User, "role">,
): Promise<{ dbUnavailable?: boolean; rows: DisplayDTO[] }> {
  assertCanManageOfficeTv(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listDisplays();
  return { rows: rows.map(toDisplayDTO) };
}

/** Returns the raw token exactly ONCE. It is never retrievable again. */
export async function createDisplay(
  actor: Pick<User, "id" | "role">,
  name: string,
  meta: Meta = {},
): Promise<{ id: number; token: string; tokenPrefix: string }> {
  assertCanManageOfficeTv(actor.role);
  if (name.trim().length < 2)
    throw new HttpError(400, "A display name is required", "name_required");
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const t = generateDisplayToken();
  const { id } = await repo.insertDisplay(
    {
      name: name.trim().slice(0, 80),
      tokenHash: t.tokenHash,
      tokenPrefix: t.tokenPrefix,
      scope: "tv_read",
      enabled: true,
      createdByUserId: actor.id,
      createdAt: nowIST(),
    },
    db,
  );
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "office_tv.display_create",
    entityType: "office_tv_display",
    entityId: id,
    metadata: { name: name.trim().slice(0, 80), tokenPrefix: t.tokenPrefix },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { id, token: t.token, tokenPrefix: t.tokenPrefix };
}

export async function revokeDisplay(
  actor: Pick<User, "id" | "role">,
  id: number,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManageOfficeTv(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const row = await repo.getDisplay(id, db);
  if (!row) throw new HttpError(404, "Display not found", "not_found");
  await repo.updateDisplay(id, { enabled: false, revokedAt: nowIST() }, db);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "office_tv.display_revoke",
    entityType: "office_tv_display",
    entityId: id,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

/** Rotate: issue a NEW token for the same display; the old token stops working. */
export async function rotateDisplay(
  actor: Pick<User, "id" | "role">,
  id: number,
  meta: Meta = {},
): Promise<{ token: string; tokenPrefix: string }> {
  assertCanManageOfficeTv(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const row = await repo.getDisplay(id, db);
  if (!row) throw new HttpError(404, "Display not found", "not_found");
  const t = generateDisplayToken();
  await repo.updateDisplay(
    id,
    {
      tokenHash: t.tokenHash,
      tokenPrefix: t.tokenPrefix,
      enabled: true,
      revokedAt: null,
      rotatedAt: nowIST(),
    },
    db,
  );
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "office_tv.display_rotate",
    entityType: "office_tv_display",
    entityId: id,
    metadata: { tokenPrefix: t.tokenPrefix },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { token: t.token, tokenPrefix: t.tokenPrefix };
}

/* ======================= TV settings ======================= */

export async function getSettings(
  actor: Pick<User, "role">,
): Promise<{ dbUnavailable?: boolean; config: TvConfig }> {
  assertCanManageOfficeTv(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, config: DEFAULT_TV_CONFIG };
  const row = await repo.getTvSettings();
  return { config: resolveTvConfig(row as Record<string, unknown> | undefined) };
}

export async function updateSettings(
  actor: Pick<User, "id" | "role">,
  patch: Record<string, unknown>,
  meta: Meta = {},
): Promise<{ ok: true; config: TvConfig }> {
  assertCanManageOfficeTv(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const merged = resolveTvConfig({
    ...(await repo.getTvSettings(db)),
    ...patch,
  } as Record<string, unknown>);
  await repo.upsertTvSettings(
    {
      displayName: merged.displayName,
      rotationSec: merged.rotationSec,
      leaderboardWindow: merged.leaderboardWindow,
      celebrationIntensity: merged.celebrationIntensity,
      soundEnabled: merged.soundEnabled,
      thirdAcceptedThreshold: merged.thirdAcceptedThreshold,
      teamMilestoneEvery: merged.teamMilestoneEvery,
      updatedByUserId: actor.id,
      updatedAt: nowIST(),
    },
    db,
  );
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "office_tv.settings_update",
    entityType: "office_tv_settings",
    metadata: { ...merged },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, config: merged };
}

/* ==================== celebration assets =================== */

export interface AssetDTO {
  id: number;
  category: string;
  kind: string;
  label: string;
  enabled: boolean;
  builtin: boolean;
  hasVideo: boolean;
  mime: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

function toAssetDTO(r: Awaited<ReturnType<typeof repo.listAssets>>[number]): AssetDTO {
  return {
    id: r.id,
    category: r.category,
    kind: r.kind,
    label: r.label,
    enabled: r.enabled,
    builtin: r.builtin,
    hasVideo: !!r.storageKey,
    mime: r.mime ?? null,
    sizeBytes: r.sizeBytes ?? null,
    createdAt: r.createdAt,
  };
}

export async function listAssets(
  actor: Pick<User, "role">,
): Promise<{ dbUnavailable?: boolean; rows: AssetDTO[] }> {
  assertCanManageOfficeTv(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listAssets();
  return { rows: rows.map(toAssetDTO) };
}

export interface UploadAssetInput {
  category: string;
  label: string;
  bytes: Uint8Array;
  declaredMime?: string | null;
  filename?: string | null;
  durationMs?: number | null;
}

export async function uploadAsset(
  actor: Pick<User, "id" | "role">,
  input: UploadAssetInput,
  meta: Meta = {},
): Promise<{ ok: true; id: number }> {
  assertCanManageOfficeTv(actor.role);
  if (!isCelebrationCategory(input.category)) {
    throw new HttpError(400, "Unknown celebration category", "bad_category");
  }
  if (input.bytes.length > MAX_CELEBRATION_BYTES) {
    throw new HttpError(413, "Celebration video is too large", "file_too_large");
  }
  const check = validateCelebrationUpload({
    bytes: input.bytes,
    declaredMime: input.declaredMime ?? null,
    filename: input.filename ?? null,
  });
  if (!check.ok || !check.mime) {
    throw new HttpError(
      415,
      `Rejected celebration upload: ${check.reason}`,
      check.reason ?? "invalid",
    );
  }
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const now = nowIST();

  const { id } = await repo.insertAsset(
    {
      category: input.category,
      kind: "video",
      label: input.label.trim().slice(0, 80) || `${input.category} clip`,
      mime: check.mime,
      sizeBytes: input.bytes.length,
      durationMs: input.durationMs ?? null,
      enabled: true,
      builtin: false,
      uploadedByUserId: actor.id,
      createdAt: now,
    },
    db,
  );

  const ext = check.mime === "video/webm" ? "webm" : "mp4";
  const key = celebrationAssetKey(input.category, id, check.safeName, ext);
  await getAssetStore().put(key, input.bytes);
  await repo.updateAsset(id, { storageKey: key, updatedAt: now }, db);

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "office_tv.asset_upload",
    entityType: "celebration_asset",
    entityId: id,
    metadata: { category: input.category, mime: check.mime, sizeBytes: input.bytes.length },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, id };
}

export async function setAssetEnabled(
  actor: Pick<User, "id" | "role">,
  id: number,
  enabled: boolean,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManageOfficeTv(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const row = await repo.getAsset(id, db);
  if (!row) throw new HttpError(404, "Asset not found", "not_found");
  await repo.updateAsset(id, { enabled, updatedAt: nowIST() }, db);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "office_tv.asset_toggle",
    entityType: "celebration_asset",
    entityId: id,
    metadata: { enabled },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

export async function deleteAsset(
  actor: Pick<User, "id" | "role">,
  id: number,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManageOfficeTv(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const row = await repo.getAsset(id, db);
  if (!row) throw new HttpError(404, "Asset not found", "not_found");
  if (row.builtin) throw new HttpError(409, "Built-in effects cannot be deleted", "builtin");
  if (row.storageKey) {
    try {
      await getAssetStore().deleteKey(row.storageKey);
    } catch {
      /* best-effort */
    }
  }
  await repo.deleteAsset(id, db);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "office_tv.asset_delete",
    entityType: "celebration_asset",
    entityId: id,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

/* ===================== announcements ======================= */

export interface AnnouncementInput {
  title: string;
  subtitle?: string | null;
  message: string;
  audience?: "all" | "agents" | "closers";
  process?: "US" | "UK" | "IN" | "AU" | null;
  effect?: string | null;
  assetId?: number | null;
  durationMs?: number;
  priority?: "NORMAL" | "IMPORTANT" | "URGENT";
  /** IST wall-clock "YYYY-MM-DD HH:MM" — null = show on publish */
  publishAt?: string | null;
  expiresAt?: string | null;
  publishNow?: boolean;
}

export interface AnnouncementDTO {
  id: number;
  title: string;
  subtitle: string | null;
  message: string;
  audience: string;
  process: string | null;
  effect: string | null;
  priority: string;
  status: string;
  durationMs: number;
  publishAt: string | null;
  expiresAt: string | null;
  publishedAt: string | null;
  createdAt: string;
}

function toAnnouncementDTO(
  r: Awaited<ReturnType<typeof repo.listAnnouncements>>[number],
): AnnouncementDTO {
  return {
    id: r.id,
    title: r.title,
    subtitle: r.subtitle ?? null,
    message: r.message,
    audience: r.audience,
    process: r.process ?? null,
    effect: r.effect ?? null,
    priority: r.priority,
    status: r.status,
    durationMs: r.durationMs,
    publishAt: r.publishAt ?? null,
    expiresAt: r.expiresAt ?? null,
    publishedAt: r.publishedAt ?? null,
    createdAt: r.createdAt,
  };
}

export async function listAnnouncements(
  actor: Pick<User, "role">,
): Promise<{ dbUnavailable?: boolean; rows: AnnouncementDTO[] }> {
  assertCanManageOfficeTv(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listAnnouncements(60);
  return { rows: rows.map(toAnnouncementDTO) };
}

export async function createAnnouncement(
  actor: Pick<User, "id" | "role">,
  input: AnnouncementInput,
  meta: Meta = {},
): Promise<{ ok: true; id: number; status: string }> {
  assertCanManageOfficeTv(actor.role);
  const durationMs = input.durationMs ?? 12_000;
  const priority = input.priority ?? "NORMAL";
  assertValidAnnouncement({ title: input.title, message: input.message, durationMs, priority });
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const now = nowIST();
  const publishNow = input.publishNow === true || (!input.publishAt && input.publishNow !== false);
  const status = publishNow ? "published" : "scheduled";

  const { id } = await repo.insertAnnouncement(
    {
      title: input.title.trim().slice(0, 120),
      subtitle: input.subtitle?.trim().slice(0, 160) || null,
      message: input.message.trim().slice(0, 600),
      audience: input.audience ?? "all",
      process: input.process ?? null,
      effect: input.effect?.trim().slice(0, 24) || null,
      assetId: input.assetId ?? null,
      durationMs,
      priority,
      status,
      publishAt: input.publishAt ?? null,
      expiresAt: input.expiresAt ?? null,
      enabled: true,
      createdByUserId: actor.id,
      createdAt: now,
      updatedAt: now,
      publishedAt: publishNow ? now : null,
    },
    db,
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: publishNow ? "office_tv.announcement_publish" : "office_tv.announcement_schedule",
    entityType: "office_tv_announcement",
    entityId: id,
    metadata: {
      title: input.title.trim().slice(0, 120),
      priority,
      audience: input.audience ?? "all",
      publishAt: input.publishAt ?? null,
      expiresAt: input.expiresAt ?? null,
      status,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, id, status };
}

export async function publishAnnouncementNow(
  actor: Pick<User, "id" | "role">,
  id: number,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManageOfficeTv(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const row = await repo.getAnnouncement(id, db);
  if (!row) throw new HttpError(404, "Announcement not found", "not_found");
  if (row.status === "published" && row.publishedAt) {
    // idempotent — a duplicate publish request is a no-op
    return { ok: true };
  }
  const now = nowIST();
  await repo.updateAnnouncement(
    id,
    { status: "published", publishAt: null, publishedAt: now, enabled: true, updatedAt: now },
    db,
  );
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "office_tv.announcement_publish",
    entityType: "office_tv_announcement",
    entityId: id,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

export async function stopAnnouncement(
  actor: Pick<User, "id" | "role">,
  id: number,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManageOfficeTv(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const row = await repo.getAnnouncement(id, db);
  if (!row) throw new HttpError(404, "Announcement not found", "not_found");
  const now = nowIST();
  await repo.updateAnnouncement(id, { status: "stopped", enabled: false, updatedAt: now }, db);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "office_tv.announcement_stop",
    entityType: "office_tv_announcement",
    entityId: id,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

/**
 * Resolve the single announcement the TV should show right now (server clock),
 * flipping any past-expiry rows to "expired" as a side effect. Shared by the
 * token state endpoint.
 */
export async function currentAnnouncementForTv(nowMs: number): Promise<{
  id: number;
  title: string;
  subtitle: string | null;
  message: string;
  effect: string | null;
  priority: string;
  durationMs: number;
  audience: string;
  process: string | null;
} | null> {
  if (!isDbConfigured()) return null;
  const db = getDb();
  const rows = await repo.liveAnnouncements(db);
  const mapped = rows.map((r) => ({
    id: r.id,
    status: r.status,
    enabled: r.enabled,
    priority: r.priority,
    publishAtMs: wallToMs(r.publishAt),
    expiresAtMs: wallToMs(r.expiresAt),
    publishedAtMs: wallToMs(r.publishedAt),
    createdAtMs: wallToMs(r.createdAt) ?? nowMs,
    _row: r,
  }));

  const expired = expiredAnnouncementIds(mapped, nowMs);
  if (expired.length) await repo.markAnnouncementsExpired(expired, db);

  const active = pickActiveAnnouncement(
    mapped.filter((m) => !expired.includes(m.id)),
    nowMs,
  );
  if (!active) return null;
  const r = active._row;
  return {
    id: r.id,
    title: r.title,
    subtitle: r.subtitle ?? null,
    message: r.message,
    effect: r.effect ?? null,
    priority: r.priority,
    durationMs: r.durationMs,
    audience: r.audience,
    process: r.process ?? null,
  };
}
