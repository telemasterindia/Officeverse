/**
 * Officeverse — gamification repositories (Phase 20). DATA ACCESS ONLY.
 * Points ledger, achievements, streaks. Server-side aggregation (no client
 * ranking of large sets). NOTHING here is read by HR / payroll code.
 */
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  gamificationAchievements,
  gamificationPointRules,
  gamificationPointTransactions,
  gamificationStreaks,
  gamificationUserAchievements,
  users,
  type GamificationAchievement,
  type GamificationPointRule,
  type GamificationPointTransaction,
  type GamificationStreak,
  type GamificationUserAchievement,
  type NewGamificationPointTransaction,
  type NewGamificationUserAchievement,
} from "@/lib/db/schema";

/* ------------------------------ rules -------------------------- */

export async function listPointRules(ex: DBX = getDb()): Promise<GamificationPointRule[]> {
  return ex.select().from(gamificationPointRules);
}

/* --------------------------- transactions --------------------- */

/** Insert one ledger row. Returns the new id, or 0 when the dedupe key already
 *  exists (award-once). Never throws for the duplicate case. */
export async function insertPointTransaction(
  v: NewGamificationPointTransaction,
  ex: DBX = getDb(),
): Promise<{ id: number; created: boolean }> {
  const existing = await ex
    .select({ id: gamificationPointTransactions.id })
    .from(gamificationPointTransactions)
    .where(eq(gamificationPointTransactions.dedupeKey, v.dedupeKey))
    .limit(1);
  if (existing[0]) return { id: existing[0].id, created: false };
  try {
    const res = await ex.insert(gamificationPointTransactions).values(v);
    return { id: Number((res as unknown as { insertId?: number }).insertId ?? 0), created: true };
  } catch {
    // lost a race on the unique index — treat as already-awarded
    const row = await ex
      .select({ id: gamificationPointTransactions.id })
      .from(gamificationPointTransactions)
      .where(eq(gamificationPointTransactions.dedupeKey, v.dedupeKey))
      .limit(1);
    return { id: row[0]?.id ?? 0, created: false };
  }
}

export async function getPointTransactionById(
  id: number,
  ex: DBX = getDb(),
): Promise<GamificationPointTransaction | undefined> {
  const rows = await ex
    .select()
    .from(gamificationPointTransactions)
    .where(eq(gamificationPointTransactions.id, id))
    .limit(1);
  return rows[0];
}

export async function markTransactionReversed(id: number, ex: DBX = getDb()): Promise<void> {
  await ex
    .update(gamificationPointTransactions)
    .set({ status: "REVERSED" })
    .where(eq(gamificationPointTransactions.id, id));
}

export async function listUserTransactions(
  userId: number,
  limit = 50,
  ex: DBX = getDb(),
): Promise<GamificationPointTransaction[]> {
  return ex
    .select()
    .from(gamificationPointTransactions)
    .where(eq(gamificationPointTransactions.userId, userId))
    .orderBy(desc(gamificationPointTransactions.id))
    .limit(Math.min(200, Math.max(1, limit)));
}

/** SUM of ACTIVE points for a user over an optional operational-date window. */
export async function sumActivePoints(
  userId: number,
  from: string | null,
  to: string | null,
  ex: DBX = getDb(),
): Promise<number> {
  const conds: SQL[] = [
    eq(gamificationPointTransactions.userId, userId),
    eq(gamificationPointTransactions.status, "ACTIVE"),
  ];
  if (from) conds.push(gte(gamificationPointTransactions.operationalDate, from));
  if (to) conds.push(lte(gamificationPointTransactions.operationalDate, to));
  const rows = await ex
    .select({ n: sql<number>`coalesce(sum(${gamificationPointTransactions.points}), 0)` })
    .from(gamificationPointTransactions)
    .where(and(...conds));
  return Number(rows[0]?.n ?? 0);
}

export async function countActiveEvents(
  userId: number,
  event: string,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`count(*)` })
    .from(gamificationPointTransactions)
    .where(
      and(
        eq(gamificationPointTransactions.userId, userId),
        eq(gamificationPointTransactions.event, event as never),
        eq(gamificationPointTransactions.status, "ACTIVE"),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export interface LeaderboardAggRow {
  userId: number;
  name: string;
  role: "agent" | "closer";
  process: string;
  points: number;
  photoAvailable: boolean;
}

/** Server-side aggregation: points per participant in one operational-date
 *  window, joined to the user for name / role / process / photo presence. */
export async function leaderboardAggregate(
  from: string | null,
  to: string | null,
  filter: { process?: string | undefined } = {},
  ex: DBX = getDb(),
): Promise<LeaderboardAggRow[]> {
  const conds: SQL[] = [
    eq(gamificationPointTransactions.status, "ACTIVE"),
    inArray(gamificationPointTransactions.role, ["agent", "closer"]),
  ];
  if (from) conds.push(gte(gamificationPointTransactions.operationalDate, from));
  if (to) conds.push(lte(gamificationPointTransactions.operationalDate, to));
  if (filter.process)
    conds.push(eq(gamificationPointTransactions.process, filter.process as never));

  const rows = await ex
    .select({
      userId: gamificationPointTransactions.userId,
      points: sql<number>`coalesce(sum(${gamificationPointTransactions.points}), 0)`,
      name: users.fullName,
      role: users.role,
      process: users.process,
      photoAssetId: users.photoAssetId,
    })
    .from(gamificationPointTransactions)
    .innerJoin(users, eq(users.id, gamificationPointTransactions.userId))
    .where(and(...conds))
    .groupBy(
      gamificationPointTransactions.userId,
      users.fullName,
      users.role,
      users.process,
      users.photoAssetId,
    )
    .orderBy(sql`sum(${gamificationPointTransactions.points}) desc`)
    .limit(500);

  return rows
    .filter((r) => r.role === "agent" || r.role === "closer")
    .map((r) => ({
      userId: r.userId,
      name: r.name,
      role: r.role as "agent" | "closer",
      process: r.process,
      points: Number(r.points),
      photoAvailable: r.photoAssetId != null,
    }));
}

/* ---------------- Phase 8: performance intelligence ------------ *
 *  All aggregation is a SUM / COUNT over the AUTHORITATIVE point   *
 *  ledger, filtered by `operational_date` (server shift date) and  *
 *  status='ACTIVE'. No points are computed here — the Scoring      *
 *  Engine already wrote them. No new table.                        */

function windowConds(from: string | null, to: string | null): SQL[] {
  const c: SQL[] = [
    eq(gamificationPointTransactions.status, "ACTIVE"),
    inArray(gamificationPointTransactions.role, ["agent", "closer"]),
  ];
  if (from) c.push(gte(gamificationPointTransactions.operationalDate, from));
  if (to) c.push(lte(gamificationPointTransactions.operationalDate, to));
  return c;
}

export interface PerformanceAggRow {
  userId: number;
  name: string;
  role: "agent" | "closer";
  process: string;
  photoAvailable: boolean;
  points: number;
  leadsSubmitted: number;
  leadsAccepted: number;
  followUps: number;
  sales: number;
  scoredLeads: number;
}

/** Per-participant points + ledger-derived event counts for one operational
 *  window. Ranking happens in the pure `rankLeaderboard`, never here. */
export async function performanceAggregate(
  from: string | null,
  to: string | null,
  filter: { process?: string | undefined } = {},
  ex: DBX = getDb(),
): Promise<PerformanceAggRow[]> {
  const conds = windowConds(from, to);
  if (filter.process)
    conds.push(eq(gamificationPointTransactions.process, filter.process as never));
  const t = gamificationPointTransactions;
  const rows = await ex
    .select({
      userId: t.userId,
      name: users.fullName,
      role: users.role,
      process: users.process,
      photoAssetId: users.photoAssetId,
      points: sql<number>`coalesce(sum(${t.points}), 0)`,
      leadsSubmitted: sql<number>`coalesce(sum(case when ${t.event} = 'LEAD_SUBMITTED' then 1 else 0 end), 0)`,
      leadsAccepted: sql<number>`coalesce(sum(case when ${t.event} in ('LEAD_ACCEPTED','THIRD_ACCEPTED_LEAD') then 1 else 0 end), 0)`,
      followUps: sql<number>`coalesce(sum(case when ${t.event} = 'FOLLOW_UP_COMPLETED' then 1 else 0 end), 0)`,
      sales: sql<number>`coalesce(sum(case when ${t.event} = 'SALE' then 1 else 0 end), 0)`,
      scoredLeads: sql<number>`coalesce(sum(case when ${t.ruleId} is not null then 1 else 0 end), 0)`,
    })
    .from(t)
    .innerJoin(users, eq(users.id, t.userId))
    .where(and(...conds))
    .groupBy(t.userId, users.fullName, users.role, users.process, users.photoAssetId)
    .limit(1000);

  return rows
    .filter((r) => r.role === "agent" || r.role === "closer")
    .map((r) => ({
      userId: r.userId,
      name: r.name,
      role: r.role as "agent" | "closer",
      process: r.process,
      photoAvailable: r.photoAssetId != null,
      points: Number(r.points),
      leadsSubmitted: Number(r.leadsSubmitted),
      leadsAccepted: Number(r.leadsAccepted),
      followUps: Number(r.followUps),
      sales: Number(r.sales),
      scoredLeads: Number(r.scoredLeads),
    }));
}

export interface EventBreakdownRow {
  event: string;
  points: number;
  count: number;
}

/** Points + count grouped by event key for a window (optionally one user). */
export async function eventBreakdown(
  from: string | null,
  to: string | null,
  filter: { userId?: number; process?: string } = {},
  ex: DBX = getDb(),
): Promise<EventBreakdownRow[]> {
  const conds = windowConds(from, to);
  if (filter.userId) conds.push(eq(gamificationPointTransactions.userId, filter.userId));
  if (filter.process)
    conds.push(eq(gamificationPointTransactions.process, filter.process as never));
  const t = gamificationPointTransactions;
  const rows = await ex
    .select({
      event: t.event,
      points: sql<number>`coalesce(sum(${t.points}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(t)
    .where(and(...conds))
    .groupBy(t.event)
    .orderBy(sql`sum(${t.points}) desc`);
  return rows.map((r) => ({ event: r.event, points: Number(r.points), count: Number(r.count) }));
}

export interface RuleBreakdownRow {
  ruleId: number | null;
  ruleVersion: number | null;
  ruleName: string | null;
  event: string;
  points: number;
  count: number;
}

/** Points + count grouped by the scoring rule that produced them (rule_id NULL
 *  = pre-engine / flat-rule legacy award). Explains "which rule generated it". */
export async function ruleBreakdown(
  from: string | null,
  to: string | null,
  filter: { userId?: number; process?: string } = {},
  ex: DBX = getDb(),
): Promise<RuleBreakdownRow[]> {
  const conds = windowConds(from, to);
  if (filter.userId) conds.push(eq(gamificationPointTransactions.userId, filter.userId));
  if (filter.process)
    conds.push(eq(gamificationPointTransactions.process, filter.process as never));
  const t = gamificationPointTransactions;
  const rows = await ex
    .select({
      ruleId: t.ruleId,
      ruleVersion: t.ruleVersion,
      ruleName: t.ruleName,
      event: t.event,
      points: sql<number>`coalesce(sum(${t.points}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(t)
    .where(and(...conds))
    .groupBy(t.ruleId, t.ruleVersion, t.ruleName, t.event)
    .orderBy(sql`sum(${t.points}) desc`);
  return rows.map((r) => ({
    ruleId: r.ruleId ?? null,
    ruleVersion: r.ruleVersion ?? null,
    ruleName: r.ruleName ?? null,
    event: r.event,
    points: Number(r.points),
    count: Number(r.count),
  }));
}

/**
 * Authoritative points per (user, referenceType, referenceId) for a small set
 * of recognition rows — used by the Office TV "Recent Achievement" screen.
 * READ-ONLY aggregation of the ACTIVE ledger; never scores or recomputes.
 * Returns a map keyed `"<userId>:<referenceType>:<referenceId>"`.
 */
export async function pointsByReferences(
  keys: { userId: number; referenceType: string | null; referenceId: string | null }[],
  ex: DBX = getDb(),
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const userIds = [
    ...new Set(keys.map((k) => k.userId).filter((n) => Number.isInteger(n) && n > 0)),
  ];
  const refIds = [...new Set(keys.map((k) => k.referenceId).filter((v): v is string => !!v))];
  if (userIds.length === 0 || refIds.length === 0) return out;
  const t = gamificationPointTransactions;
  const rows = await ex
    .select({
      userId: t.userId,
      referenceType: t.referenceType,
      referenceId: t.referenceId,
      points: sql<number>`coalesce(sum(${t.points}), 0)`,
    })
    .from(t)
    .where(and(eq(t.status, "ACTIVE"), inArray(t.userId, userIds), inArray(t.referenceId, refIds)))
    .groupBy(t.userId, t.referenceType, t.referenceId)
    .limit(200);
  for (const r of rows) {
    out[`${r.userId}:${r.referenceType ?? ""}:${r.referenceId ?? ""}`] = Number(r.points);
  }
  return out;
}

export interface LedgerRow {
  id: number;
  operationalDate: string;
  event: string;
  points: number;
  status: string;
  source: string;
  referenceType: string | null;
  referenceId: string | null;
  ruleId: number | null;
  ruleVersion: number | null;
  ruleName: string | null;
  scoreRunId: number | null;
  /** JSON string of the scoring evaluation context (fields that mattered, band chosen) */
  context: string | null;
  reason: string | null;
  createdAt: string;
}

function jsonStr(v: unknown): string | null {
  if (v == null) return null;
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return null;
  }
}

/** The fully-explainable ledger for one user in a window — every field a
 *  manager needs to answer "why does this employee have N points?". */
export async function userLedger(
  userId: number,
  from: string | null,
  to: string | null,
  limit = 300,
  ex: DBX = getDb(),
): Promise<LedgerRow[]> {
  const t = gamificationPointTransactions;
  const conds: SQL[] = [eq(t.userId, userId)];
  if (from) conds.push(gte(t.operationalDate, from));
  if (to) conds.push(lte(t.operationalDate, to));
  const rows = await ex
    .select()
    .from(t)
    .where(and(...conds))
    .orderBy(desc(t.id))
    .limit(Math.min(1000, Math.max(1, limit)));
  return rows.map((r) => ({
    id: r.id,
    operationalDate: r.operationalDate,
    event: r.event,
    points: r.points,
    status: r.status,
    source: r.source,
    referenceType: r.referenceType ?? null,
    referenceId: r.referenceId ?? null,
    ruleId: r.ruleId ?? null,
    ruleVersion: r.ruleVersion ?? null,
    ruleName: r.ruleName ?? null,
    scoreRunId: r.scoreRunId ?? null,
    context: jsonStr(r.context),
    reason: r.reason ?? null,
    createdAt: r.createdAt,
  }));
}

/* --------------------------- achievements --------------------- */

export async function listAchievements(ex: DBX = getDb()): Promise<GamificationAchievement[]> {
  return ex.select().from(gamificationAchievements);
}

export async function listUserAchievements(
  userId: number,
  ex: DBX = getDb(),
): Promise<GamificationUserAchievement[]> {
  return ex
    .select()
    .from(gamificationUserAchievements)
    .where(eq(gamificationUserAchievements.userId, userId))
    .orderBy(desc(gamificationUserAchievements.id));
}

/** Award-once: relies on the unique (user, code) index. */
export async function insertUserAchievement(
  v: NewGamificationUserAchievement,
  ex: DBX = getDb(),
): Promise<{ created: boolean }> {
  const existing = await ex
    .select({ id: gamificationUserAchievements.id })
    .from(gamificationUserAchievements)
    .where(
      and(
        eq(gamificationUserAchievements.userId, v.userId),
        eq(gamificationUserAchievements.achievementCode, v.achievementCode),
      ),
    )
    .limit(1);
  if (existing[0]) return { created: false };
  try {
    await ex.insert(gamificationUserAchievements).values(v);
    return { created: true };
  } catch {
    return { created: false };
  }
}

/* ---------------------------- streaks ------------------------- */

export async function getStreak(
  userId: number,
  streakType: string,
  ex: DBX = getDb(),
): Promise<GamificationStreak | undefined> {
  const rows = await ex
    .select()
    .from(gamificationStreaks)
    .where(
      and(
        eq(gamificationStreaks.userId, userId),
        eq(gamificationStreaks.streakType, streakType as never),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function upsertStreak(
  userId: number,
  streakType: string,
  next: { currentCount: number; bestCount: number; lastOperationalDate: string | null },
  nowWall: string,
  ex: DBX = getDb(),
): Promise<void> {
  const existing = await getStreak(userId, streakType, ex);
  if (existing) {
    await ex
      .update(gamificationStreaks)
      .set({
        currentCount: next.currentCount,
        bestCount: next.bestCount,
        lastOperationalDate: next.lastOperationalDate,
        updatedAt: nowWall,
      })
      .where(eq(gamificationStreaks.id, existing.id));
  } else {
    await ex.insert(gamificationStreaks).values({
      userId,
      streakType: streakType as never,
      currentCount: next.currentCount,
      bestCount: next.bestCount,
      lastOperationalDate: next.lastOperationalDate,
      updatedAt: nowWall,
    });
  }
}
