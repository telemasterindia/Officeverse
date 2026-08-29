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
