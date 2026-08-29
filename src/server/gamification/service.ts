/**
 * Officeverse — gamification service (Phase 20).
 *
 * The ONE server-authoritative place points are awarded / reversed / adjusted.
 * A client NEVER supplies point amounts, ranks, achievements or scores; it may
 * only ask (via a future Phase-21 business-event integration) that an action
 * occurred — the server alone decides whether a qualifying event happened and
 * how many points, if any, it is worth.
 *
 * ZERO payroll coupling: this module imports nothing from ../hr/* / payroll /
 * salary-slip / regularity-bonus / incentive, and is never imported by them.
 * Points are abstract — never money.
 */
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { gamificationAchievements, gamificationPointRules, type User } from "@/lib/db/schema";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { nowIST, currentShiftDate } from "../time";
import { getUserById } from "../db/repos/users";
import {
  assertCanManageGamification,
  assertCanViewParticipant,
  assertValidAdjustment,
  canManageGamification,
  isGamificationParticipant,
} from "../authz/gamification";
import {
  DEFAULT_POINT_RULES,
  dedupeKeyFor,
  isGamificationEvent,
  resolvePoints,
  reversalDedupeKey,
  type GamificationEvent,
} from "./points";
import {
  LEADERBOARD_KINDS,
  rankLeaderboard,
  rankOf,
  windowBounds,
  type LeaderboardKind,
  type LeaderboardRow,
} from "./leaderboard";
import { advanceStreak, effectiveCurrent } from "./streaks";
import { DEFAULT_ACHIEVEMENTS, evaluateAchievements } from "./achievements";
import * as repo from "../db/repos/gamification";

type Meta = { ip?: string | null; userAgent?: string | null };
const STREAK_TYPE = "ACCEPTED_LEAD_STREAK";

/* ============================ seeding ========================= */

/** Idempotently create the default point rules + achievement registry rows.
 *  Every point value is 0 until an Admin configures it — nothing is invented. */
export async function seedGamification(
  actor: Pick<User, "id" | "role">,
  meta: Meta = {},
): Promise<{ dbUnavailable?: boolean; rulesAdded: number; achievementsAdded: number }> {
  assertCanManageGamification(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, rulesAdded: 0, achievementsAdded: 0 };
  const db = getDb();
  const now = nowIST();

  const existingRules = await repo.listPointRules(db);
  const haveRule = new Set(existingRules.map((r) => r.event));
  let rulesAdded = 0;
  for (const r of DEFAULT_POINT_RULES) {
    if (haveRule.has(r.event)) continue;
    await db.insert(gamificationPointRules).values({
      event: r.event,
      points: r.points,
      enabled: r.enabled,
      note: r.note,
      updatedByUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    });
    rulesAdded += 1;
  }

  const existingAch = await repo.listAchievements(db);
  const haveAch = new Set(existingAch.map((a) => a.code));
  let achievementsAdded = 0;
  for (const a of DEFAULT_ACHIEVEMENTS) {
    if (haveAch.has(a.code)) continue;
    await db.insert(gamificationAchievements).values({
      code: a.code,
      name: a.name,
      description: a.description,
      badge: a.badge,
      category: a.category,
      criteria: a.criteria,
      repeatable: a.repeatable,
      enabled: a.enabled,
      createdAt: now,
      updatedAt: now,
    });
    achievementsAdded += 1;
  }

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "gamification.seed",
    entityType: "gamification",
    metadata: { rulesAdded, achievementsAdded },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { rulesAdded, achievementsAdded };
}

/* ====================== award a business event =============== *
 * Internal — the Phase-21 business-event integrations call this. It is NOT a
 * client endpoint; a client can never pick the event, the user or the points.  */

export interface AwardInput {
  userId: number;
  event: GamificationEvent;
  referenceType?: string | null;
  referenceId?: string | number | null;
  /** epoch ms of the business event (server clock); defaults to now */
  atMs?: number;
}

export interface AwardResult {
  awarded: boolean; // false = duplicate / non-participant — nothing changed
  points: number;
  transactionId: number;
  operationalDate: string;
  newAchievements: string[];
  streak: { current: number; best: number } | null;
}

export async function awardEvent(input: AwardInput, meta: Meta = {}): Promise<AwardResult> {
  if (!isGamificationEvent(input.event) || input.event === "ADMIN_ADJUSTMENT") {
    throw new HttpError(400, "Unknown gamification event", "bad_event");
  }
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();

  const user = await getUserById(input.userId);
  if (!user) throw new HttpError(404, "User not found", "not_found");

  const operationalDate = currentShiftDate(user.process, input.atMs);

  if (!isGamificationParticipant(user.role)) {
    // Admin / HR are not participants — no-op rather than error.
    return {
      awarded: false,
      points: 0,
      transactionId: 0,
      operationalDate,
      newAchievements: [],
      streak: null,
    };
  }
  const role = user.role as "agent" | "closer";

  const rules = await repo.listPointRules(db);
  const points = resolvePoints(rules, input.event);
  const dedupeKey = dedupeKeyFor(input.event, input.referenceType, input.referenceId);

  const { id, created } = await repo.insertPointTransaction(
    {
      userId: user.id,
      role,
      process: user.process,
      event: input.event,
      points,
      operationalDate,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId != null ? String(input.referenceId) : null,
      dedupeKey,
      status: "ACTIVE",
      source: "system",
      createdAt: nowIST(),
    },
    db,
  );
  if (!created) {
    return {
      awarded: false,
      points: 0,
      transactionId: id,
      operationalDate,
      newAchievements: [],
      streak: null,
    };
  }

  // ACCEPTED_LEAD_STREAK — the first accepted lead of an operational day moves
  // it; advanceStreak is a same-day no-op so a second accepted lead does not.
  let streakOut: { current: number; best: number } | null = null;
  if (input.event === "LEAD_ACCEPTED") {
    const cur = await repo.getStreak(user.id, STREAK_TYPE, db);
    const next = advanceStreak(
      {
        currentCount: cur?.currentCount ?? 0,
        bestCount: cur?.bestCount ?? 0,
        lastOperationalDate: cur?.lastOperationalDate ?? null,
      },
      operationalDate,
    );
    if (!cur || next.changed) {
      await repo.upsertStreak(
        user.id,
        STREAK_TYPE,
        {
          currentCount: next.currentCount,
          bestCount: next.bestCount,
          lastOperationalDate: next.lastOperationalDate,
        },
        nowIST(),
        db,
      );
    }
    streakOut = { current: next.currentCount, best: next.bestCount };
  }

  // Achievements — evaluated from authoritative ACTIVE-row counts.
  const [acceptedLeadCount, salesCount, submittedLeadCount, earnedRows, registry] =
    await Promise.all([
      repo.countActiveEvents(user.id, "LEAD_ACCEPTED", db),
      repo.countActiveEvents(user.id, "SALE", db),
      repo.countActiveEvents(user.id, "LEAD_SUBMITTED", db),
      repo.listUserAchievements(user.id, db),
      repo.listAchievements(db),
    ]);
  const acceptedLeadStreak =
    streakOut?.current ?? (await repo.getStreak(user.id, STREAK_TYPE, db))?.currentCount ?? 0;
  const newCodes = evaluateAchievements(
    registry.map((r) => ({
      code: r.code,
      criteria: r.criteria,
      repeatable: r.repeatable,
      enabled: r.enabled,
    })),
    {
      acceptedLeadCount,
      salesCount,
      submittedLeadCount,
      acceptedLeadStreak,
      alreadyEarned: new Set(earnedRows.map((r) => r.achievementCode)),
    },
  );
  for (const code of newCodes) {
    await repo.insertUserAchievement(
      {
        userId: user.id,
        achievementCode: code,
        earnedAt: nowIST(),
        triggerType: input.event,
        triggerId: input.referenceId != null ? String(input.referenceId) : null,
      },
      db,
    );
  }

  await recordAudit({
    actorUserId: null,
    actorRole: "system",
    action: "gamification.award",
    entityType: "gamification_point_transaction",
    entityId: id,
    metadata: {
      user: user.id,
      event: input.event,
      points,
      operationalDate,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId != null ? String(input.referenceId) : null,
      newAchievements: newCodes,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return {
    awarded: true,
    points,
    transactionId: id,
    operationalDate,
    newAchievements: newCodes,
    streak: streakOut,
  };
}

/* ======================= admin corrections ================== *
 * There is NO "give this user 100 points" button. A correction is either the
 * auditable REVERSAL of a specific ledger row, or an explicit ADMIN_ADJUSTMENT
 * that is permission-checked + reason-required + fully audited. Totals are
 * never silently mutated — every change is one more immutable ledger row.      */

export async function reversePointTransaction(
  actor: Pick<User, "id" | "role">,
  transactionId: number,
  reason: string,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManageGamification(actor.role);
  if (reason.trim().length < 5) {
    throw new HttpError(400, "A reason (min 5 chars) is required", "reason_required");
  }
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const orig = await repo.getPointTransactionById(transactionId, db);
  if (!orig) throw new HttpError(404, "Transaction not found", "not_found");
  if (orig.status !== "ACTIVE") {
    throw new HttpError(409, "Transaction is not ACTIVE", "not_active");
  }
  if (orig.reversalOfId != null) {
    throw new HttpError(409, "Cannot reverse a reversal row", "not_reversible");
  }

  await repo.markTransactionReversed(orig.id, db);
  await repo.insertPointTransaction(
    {
      userId: orig.userId,
      role: orig.role,
      process: orig.process,
      event: orig.event,
      points: -orig.points,
      operationalDate: orig.operationalDate,
      referenceType: "reversal",
      referenceId: String(orig.id),
      dedupeKey: reversalDedupeKey(orig.id),
      status: "REVERSED",
      source: "admin",
      reversalOfId: orig.id,
      reason: reason.trim().slice(0, 255),
      createdByUserId: actor.id,
      createdAt: nowIST(),
    },
    db,
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "gamification.reverse",
    entityType: "gamification_point_transaction",
    entityId: orig.id,
    metadata: { user: orig.userId, points: orig.points, reason: reason.trim().slice(0, 200) },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

export async function adjustPoints(
  actor: Pick<User, "id" | "role">,
  input: { targetUserId: number; points: number; reason: string },
  meta: Meta = {},
): Promise<{ ok: true; transactionId: number }> {
  assertValidAdjustment(actor.role, input.points, input.reason);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const target = await getUserById(input.targetUserId);
  if (!target || !isGamificationParticipant(target.role)) {
    throw new HttpError(404, "Target is not a gamification participant", "not_found");
  }
  const now = nowIST();
  const stamp = Date.now();
  const operationalDate = currentShiftDate(target.process);
  const { id } = await repo.insertPointTransaction(
    {
      userId: target.id,
      role: target.role as "agent" | "closer",
      process: target.process,
      event: "ADMIN_ADJUSTMENT",
      points: Math.trunc(input.points),
      operationalDate,
      referenceType: "admin_adjustment",
      referenceId: `${actor.id}-${stamp}`,
      dedupeKey: `ADMIN_ADJUSTMENT:${actor.id}:${target.id}:${stamp}`,
      status: "ACTIVE",
      source: "admin",
      reason: input.reason.trim().slice(0, 255),
      createdByUserId: actor.id,
      createdAt: now,
    },
    db,
  );
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "gamification.adjustment",
    entityType: "gamification_point_transaction",
    entityId: id,
    metadata: {
      user: target.id,
      points: Math.trunc(input.points),
      reason: input.reason.trim().slice(0, 200),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, transactionId: id };
}

/* ============================ reads ========================= */

export interface AchievementDTO {
  code: string;
  name: string;
  description: string | null;
  badge: string | null;
  category: string;
  earnedAt: string | null;
}
export interface TxnDTO {
  id: number;
  event: string;
  points: number;
  operationalDate: string;
  status: string;
  source: string;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  createdAt: string;
}
export interface GamificationProfile {
  dbUnavailable?: boolean;
  userId: number;
  name: string;
  role: string;
  process: string;
  points: { allTime: number; weekly: number; daily: number };
  rank: { allTime: number | null; weekly: number | null };
  streak: { type: string; current: number; best: number; lastDate: string | null };
  achievements: AchievementDTO[];
  recent: TxnDTO[];
}

async function buildProfile(
  target: User,
  opts: { fullHistory: boolean },
): Promise<GamificationProfile> {
  const db = getDb();
  const today = currentShiftDate(target.process);
  const wk = windowBounds("weekly", today);

  const [allTime, weekly, daily, streakRow, achRows, achDefs, txns, boardAll, boardWk] =
    await Promise.all([
      repo.sumActivePoints(target.id, null, null, db),
      repo.sumActivePoints(target.id, wk.from, wk.to, db),
      repo.sumActivePoints(target.id, today, today, db),
      repo.getStreak(target.id, STREAK_TYPE, db),
      repo.listUserAchievements(target.id, db),
      repo.listAchievements(db),
      repo.listUserTransactions(target.id, opts.fullHistory ? 200 : 25, db),
      getRankedBoard("alltime", today, {}),
      getRankedBoard("weekly", today, {}),
    ]);

  const defByCode = new Map(achDefs.map((d) => [d.code, d]));
  return {
    userId: target.id,
    name: target.fullName,
    role: target.role,
    process: target.process,
    points: { allTime, weekly, daily },
    rank: { allTime: rankOf(boardAll, target.id), weekly: rankOf(boardWk, target.id) },
    streak: {
      type: STREAK_TYPE,
      current: streakRow
        ? effectiveCurrent(
            {
              currentCount: streakRow.currentCount,
              bestCount: streakRow.bestCount,
              lastOperationalDate: streakRow.lastOperationalDate ?? null,
            },
            today,
          )
        : 0,
      best: streakRow?.bestCount ?? 0,
      lastDate: streakRow?.lastOperationalDate ?? null,
    },
    achievements: achRows.map((r) => {
      const d = defByCode.get(r.achievementCode);
      return {
        code: r.achievementCode,
        name: d?.name ?? r.achievementCode,
        description: d?.description ?? null,
        badge: d?.badge ?? null,
        category: d?.category ?? "general",
        earnedAt: r.earnedAt,
      };
    }),
    recent: txns.map((t) => ({
      id: t.id,
      event: t.event,
      points: t.points,
      operationalDate: t.operationalDate,
      status: t.status,
      source: t.source,
      referenceType: t.referenceType ?? null,
      referenceId: t.referenceId ?? null,
      reason: t.reason ?? null,
      createdAt: t.createdAt,
    })),
  };
}

function emptyProfile(userId: number): GamificationProfile {
  return {
    dbUnavailable: true,
    userId,
    name: "",
    role: "",
    process: "",
    points: { allTime: 0, weekly: 0, daily: 0 },
    rank: { allTime: null, weekly: null },
    streak: { type: STREAK_TYPE, current: 0, best: 0, lastDate: null },
    achievements: [],
    recent: [],
  };
}

/** Agent / Closer personal view. */
export async function myGamification(user: Pick<User, "id">): Promise<GamificationProfile> {
  if (!isDbConfigured()) return emptyProfile(user.id);
  const full = await getUserById(user.id);
  if (!full) throw new HttpError(404, "User not found", "not_found");
  return buildProfile(full, { fullHistory: false });
}

/** Self, or Admin / HR investigating "why does this person have these points?". */
export async function participantDetail(
  actor: Pick<User, "id" | "role">,
  targetUserId: number,
): Promise<GamificationProfile> {
  assertCanViewParticipant(actor.role, actor.id, targetUserId);
  if (!isDbConfigured()) return emptyProfile(targetUserId);
  const target = await getUserById(targetUserId);
  if (!target) throw new HttpError(404, "User not found", "not_found");
  return buildProfile(target, { fullHistory: canManageGamification(actor.role) });
}

/* --------------------------- leaderboard --------------------- */

export interface LeaderboardEntry extends LeaderboardRow {
  streak: number;
  topBadge: string | null;
}
export interface LeaderboardResult {
  dbUnavailable?: boolean;
  kind: LeaderboardKind;
  process: string | null;
  window: { from: string | null; to: string | null };
  rows: LeaderboardEntry[];
  myRank: number | null;
}

async function getRankedBoard(
  kind: LeaderboardKind,
  operationalDate: string,
  filter: { process?: string | undefined },
): Promise<LeaderboardRow[]> {
  const win = windowBounds(kind, operationalDate);
  const agg = await repo.leaderboardAggregate(win.from, win.to, filter);
  return rankLeaderboard(
    agg.map((r) => ({
      userId: r.userId,
      name: r.name,
      role: r.role,
      process: r.process,
      points: r.points,
      photoAvailable: r.photoAvailable,
    })),
  );
}

export async function getLeaderboard(
  viewer: Pick<User, "id" | "process">,
  input: { kind?: string | undefined; process?: string | undefined },
): Promise<LeaderboardResult> {
  const kind: LeaderboardKind = (LEADERBOARD_KINDS as readonly string[]).includes(input.kind ?? "")
    ? (input.kind as LeaderboardKind)
    : "weekly";
  if (!isDbConfigured()) {
    return {
      dbUnavailable: true,
      kind,
      process: input.process ?? null,
      window: { from: null, to: null },
      rows: [],
      myRank: null,
    };
  }
  const db = getDb();
  const operationalDate = currentShiftDate(viewer.process);
  const win = windowBounds(kind, operationalDate);
  const ranked = await getRankedBoard(kind, operationalDate, { process: input.process });

  // One bounded set of lookups for the top slice — badges + streaks.
  const top = ranked.slice(0, 100);
  const defs = await repo.listAchievements(db);
  const badgeByCode = new Map(defs.map((d) => [d.code, d.badge]));
  const entries: LeaderboardEntry[] = [];
  for (const r of top) {
    const [ach, streakRow] = await Promise.all([
      repo.listUserAchievements(r.userId, db),
      repo.getStreak(r.userId, STREAK_TYPE, db),
    ]);
    const topBadge = ach[0] ? (badgeByCode.get(ach[0].achievementCode) ?? null) : null;
    entries.push({
      ...r,
      topBadge,
      streak: streakRow
        ? effectiveCurrent(
            {
              currentCount: streakRow.currentCount,
              bestCount: streakRow.bestCount,
              lastOperationalDate: streakRow.lastOperationalDate ?? null,
            },
            operationalDate,
          )
        : 0,
    });
  }

  return {
    kind,
    process: input.process ?? null,
    window: { from: win.from, to: win.to },
    rows: entries,
    myRank: rankOf(ranked, viewer.id),
  };
}

/* ------------------------- rule config ---------------------- */

export interface RuleDTO {
  event: string;
  points: number;
  enabled: boolean;
  note: string | null;
}
export async function listRules(
  actor: Pick<User, "role">,
): Promise<{ dbUnavailable?: boolean; rows: RuleDTO[] }> {
  assertCanManageGamification(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listPointRules();
  return {
    rows: rows.map((r) => ({
      event: r.event,
      points: r.points,
      enabled: r.enabled,
      note: r.note ?? null,
    })),
  };
}

export async function setRule(
  actor: Pick<User, "id" | "role">,
  input: { event: string; points: number; enabled: boolean; note?: string },
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManageGamification(actor.role);
  if (!isGamificationEvent(input.event) || input.event === "ADMIN_ADJUSTMENT") {
    throw new HttpError(400, "Unknown event", "bad_event");
  }
  const points = Math.trunc(input.points);
  if (!Number.isFinite(points) || points < 0 || points > 100_000) {
    throw new HttpError(400, "points must be 0..100000", "bad_amount");
  }
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const now = nowIST();
  const rules = await repo.listPointRules(db);
  const existing = rules.find((r) => r.event === input.event);
  const note = input.note?.trim().slice(0, 255) ?? null;
  if (existing) {
    await db
      .update(gamificationPointRules)
      .set({ points, enabled: input.enabled, note, updatedByUserId: actor.id, updatedAt: now })
      .where(eq(gamificationPointRules.id, existing.id));
  } else {
    await db.insert(gamificationPointRules).values({
      event: input.event as GamificationEvent,
      points,
      enabled: input.enabled,
      note,
      updatedByUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    });
  }
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "gamification.rule_set",
    entityType: "gamification_point_rule",
    metadata: { event: input.event, points, enabled: input.enabled },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}
