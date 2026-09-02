/**
 * Officeverse — MILESTONE ENGINE repository (Phase 10 Stage 4). DATA ACCESS ONLY.
 *
 * Milestone definitions + the append-only trigger/idempotency log, plus
 * READ-ONLY authoritative-value lookups over the EXISTING point ledger
 * (`gamification_point_transactions`) — the same table the Phase-8 leaderboard
 * aggregates. Nothing here scores, awards points, or writes payroll / incentive.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  gamificationPointTransactions,
  milestoneTriggers,
  milestones,
  users,
  type Milestone,
  type MilestoneTrigger,
  type NewMilestone,
  type NewMilestoneTrigger,
} from "@/lib/db/schema";

/* ------------------------------ definitions ------------------------------ */

export async function insertMilestone(v: NewMilestone, ex: DBX = getDb()): Promise<number> {
  const rows = await ex.insert(milestones).values(v).$returningId();
  return Number(rows[0]?.id ?? 0);
}

export async function updateMilestone(
  id: number,
  patch: Partial<NewMilestone>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(milestones).set(patch).where(eq(milestones.id, id));
}

export async function getMilestone(id: number, ex: DBX = getDb()): Promise<Milestone | undefined> {
  const rows = await ex.select().from(milestones).where(eq(milestones.id, id)).limit(1);
  return rows[0];
}

export async function listMilestones(ex: DBX = getDb()): Promise<Milestone[]> {
  return ex.select().from(milestones).orderBy(asc(milestones.priority), asc(milestones.id));
}

/** Enabled milestones whose effective window contains `operationalDate`, by
 *  priority then id. The service filters by `metric` / `type` in memory (the
 *  configured set is tiny). */
export async function listActiveMilestones(
  operationalDate: string,
  ex: DBX = getDb(),
): Promise<Milestone[]> {
  const rows = await ex
    .select()
    .from(milestones)
    .where(and(eq(milestones.enabled, true), lte(milestones.effectiveFrom, operationalDate)))
    .orderBy(asc(milestones.priority), asc(milestones.id));
  return rows.filter((m) => !m.effectiveUntil || operationalDate <= m.effectiveUntil);
}

/* ------------------------------- triggers ------------------------------- */

export async function insertTrigger(
  v: NewMilestoneTrigger,
  ex: DBX = getDb(),
): Promise<{ id: number; created: boolean }> {
  const existing = await ex
    .select({ id: milestoneTriggers.id })
    .from(milestoneTriggers)
    .where(eq(milestoneTriggers.dedupeKey, v.dedupeKey))
    .limit(1);
  if (existing[0]) return { id: existing[0].id, created: false };
  try {
    const rows = await ex.insert(milestoneTriggers).values(v).$returningId();
    return { id: Number(rows[0]?.id ?? 0), created: true };
  } catch {
    const row = await ex
      .select({ id: milestoneTriggers.id })
      .from(milestoneTriggers)
      .where(eq(milestoneTriggers.dedupeKey, v.dedupeKey))
      .limit(1);
    return { id: row[0]?.id ?? 0, created: false };
  }
}

/** Every dedupe key already recorded for a milestone — the eval core uses this
 *  set so a retry / repeat is a no-op. */
export async function firedKeysForMilestone(
  milestoneId: number,
  ex: DBX = getDb(),
): Promise<Set<string>> {
  const rows = await ex
    .select({ k: milestoneTriggers.dedupeKey })
    .from(milestoneTriggers)
    .where(eq(milestoneTriggers.milestoneId, milestoneId))
    .limit(2000);
  return new Set(rows.map((r) => r.k));
}

export async function listTriggers(
  filter: { milestoneId?: number | undefined } = {},
  limit = 100,
  ex: DBX = getDb(),
): Promise<MilestoneTrigger[]> {
  const conds: SQL[] = [];
  if (filter.milestoneId) conds.push(eq(milestoneTriggers.milestoneId, filter.milestoneId));
  const q = ex.select().from(milestoneTriggers);
  return (conds.length ? q.where(and(...conds)) : q)
    .orderBy(desc(milestoneTriggers.id))
    .limit(Math.min(500, Math.max(1, limit)));
}

/* ------------------- authoritative value reads (READ-ONLY) ------------- */

const windowConds = (from: string | null, to: string | null): SQL[] => {
  const c: SQL[] = [eq(gamificationPointTransactions.status, "ACTIVE")];
  if (from) c.push(gte(gamificationPointTransactions.operationalDate, from));
  if (to) c.push(lte(gamificationPointTransactions.operationalDate, to));
  return c;
};

/** COUNT of ACTIVE ledger rows for one user + event key in an operational window. */
export async function countUserEvent(
  userId: number,
  event: string,
  from: string | null,
  to: string | null,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`count(*)` })
    .from(gamificationPointTransactions)
    .where(
      and(
        ...windowConds(from, to),
        eq(gamificationPointTransactions.userId, userId),
        eq(gamificationPointTransactions.event, event as never),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

/** SUM of ACTIVE points for one user in an operational window. */
export async function sumUserPoints(
  userId: number,
  from: string | null,
  to: string | null,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`coalesce(sum(${gamificationPointTransactions.points}), 0)` })
    .from(gamificationPointTransactions)
    .where(and(...windowConds(from, to), eq(gamificationPointTransactions.userId, userId)));
  return Number(rows[0]?.n ?? 0);
}

const teamConds = (process: string | null): SQL[] => {
  const c: SQL[] = [inArray(gamificationPointTransactions.role, ["agent", "closer"])];
  if (process) c.push(eq(gamificationPointTransactions.process, process as never));
  return c;
};

/** COUNT of ACTIVE ledger rows for an event key across the team (optional
 *  process) in an operational window. */
export async function countTeamEvent(
  event: string,
  from: string | null,
  to: string | null,
  process: string | null,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`count(*)` })
    .from(gamificationPointTransactions)
    .where(
      and(
        ...windowConds(from, to),
        ...teamConds(process),
        eq(gamificationPointTransactions.event, event as never),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

/** SUM of ACTIVE points across the team (optional process) in an operational window. */
export async function sumTeamPoints(
  from: string | null,
  to: string | null,
  process: string | null,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`coalesce(sum(${gamificationPointTransactions.points}), 0)` })
    .from(gamificationPointTransactions)
    .where(and(...windowConds(from, to), ...teamConds(process)));
  return Number(rows[0]?.n ?? 0);
}

/** full name for a subject (individual milestones) */
export async function userName(userId: number, ex: DBX = getDb()): Promise<string | null> {
  const rows = await ex
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.fullName ?? null;
}
