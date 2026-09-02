/**
 * Officeverse — INCENTIVE ENGINE repositories (Phase 9). DATA ACCESS ONLY.
 *
 * Schemes (mutable header) + immutable versions + persisted results. Mirrors the
 * scoring-rule repo conventions. NOTHING here computes points, incentives, or a
 * payment; it never touches scoring / payroll / salary tables.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  incentiveResults,
  incentiveSchemeVersions,
  incentiveSchemes,
  type IncentiveResult,
  type IncentiveScheme,
  type IncentiveSchemeVersion,
  type NewIncentiveResult,
  type NewIncentiveScheme,
  type NewIncentiveSchemeVersion,
} from "@/lib/db/schema";

/* ------------------------------ schemes ------------------------------ */

export async function insertScheme(v: NewIncentiveScheme, ex: DBX = getDb()): Promise<number> {
  const rows = await ex.insert(incentiveSchemes).values(v).$returningId();
  return Number(rows[0]?.id ?? 0);
}

export async function updateSchemeHeader(
  id: number,
  patch: Partial<
    Pick<
      NewIncentiveScheme,
      | "name"
      | "description"
      | "enabled"
      | "periodType"
      | "priority"
      | "combineMode"
      | "currentVersion"
      | "updatedAt"
    >
  >,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(incentiveSchemes).set(patch).where(eq(incentiveSchemes.id, id));
}

export async function getScheme(
  id: number,
  ex: DBX = getDb(),
): Promise<IncentiveScheme | undefined> {
  const rows = await ex.select().from(incentiveSchemes).where(eq(incentiveSchemes.id, id)).limit(1);
  return rows[0];
}

export async function listSchemes(ex: DBX = getDb()): Promise<IncentiveScheme[]> {
  return ex.select().from(incentiveSchemes).orderBy(incentiveSchemes.priority, incentiveSchemes.id);
}

export async function listEnabledSchemes(ex: DBX = getDb()): Promise<IncentiveScheme[]> {
  return ex
    .select()
    .from(incentiveSchemes)
    .where(eq(incentiveSchemes.enabled, true))
    .orderBy(incentiveSchemes.priority, incentiveSchemes.id);
}

/* ------------------------------ versions ---------------------------- */

export async function insertSchemeVersion(
  v: NewIncentiveSchemeVersion,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex.insert(incentiveSchemeVersions).values(v).$returningId();
  return Number(rows[0]?.id ?? 0);
}

/** Close the currently-open version (effective_until IS NULL) at `from`. */
export async function closeOpenSchemeVersionAt(
  schemeId: number,
  from: string,
  ex: DBX = getDb(),
): Promise<void> {
  const open = await ex
    .select({ id: incentiveSchemeVersions.id })
    .from(incentiveSchemeVersions)
    .where(
      and(
        eq(incentiveSchemeVersions.schemeId, schemeId),
        eq(incentiveSchemeVersions.effectiveUntil, null as never),
      ),
    );
  for (const o of open) {
    await ex
      .update(incentiveSchemeVersions)
      .set({ effectiveUntil: from })
      .where(eq(incentiveSchemeVersions.id, o.id));
  }
}

export async function getVersionsForScheme(
  schemeId: number,
  ex: DBX = getDb(),
): Promise<IncentiveSchemeVersion[]> {
  return ex
    .select()
    .from(incentiveSchemeVersions)
    .where(eq(incentiveSchemeVersions.schemeId, schemeId))
    .orderBy(desc(incentiveSchemeVersions.version));
}

/* ------------------------------ results ---------------------------- */

export async function getResultByDedupe(
  dedupeKey: string,
  ex: DBX = getDb(),
): Promise<IncentiveResult | undefined> {
  const rows = await ex
    .select()
    .from(incentiveResults)
    .where(eq(incentiveResults.dedupeKey, dedupeKey))
    .limit(1);
  return rows[0];
}

export async function getResultById(
  id: number,
  ex: DBX = getDb(),
): Promise<IncentiveResult | undefined> {
  const rows = await ex.select().from(incentiveResults).where(eq(incentiveResults.id, id)).limit(1);
  return rows[0];
}

export async function insertResult(v: NewIncentiveResult, ex: DBX = getDb()): Promise<number> {
  const rows = await ex.insert(incentiveResults).values(v).$returningId();
  return Number(rows[0]?.id ?? 0);
}

/** Replace a NON-finalized result in place (same dedupeKey). Never touches a
 *  FINALIZED / APPROVED / REVERSED row — the caller guards that. */
export async function updateResult(
  id: number,
  patch: Partial<NewIncentiveResult>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(incentiveResults).set(patch).where(eq(incentiveResults.id, id));
}

export async function listResults(
  filter: {
    schemeId?: number | undefined;
    userId?: number | undefined;
    status?: string[] | undefined;
    from?: string | undefined;
    to?: string | undefined;
  },
  ex: DBX = getDb(),
): Promise<IncentiveResult[]> {
  const c = [];
  if (filter.schemeId) c.push(eq(incentiveResults.schemeId, filter.schemeId));
  if (filter.userId) c.push(eq(incentiveResults.userId, filter.userId));
  if (filter.status && filter.status.length)
    c.push(inArray(incentiveResults.status, filter.status as never));
  if (filter.from) c.push(eq(incentiveResults.periodFrom, filter.from));
  if (filter.to) c.push(eq(incentiveResults.periodTo, filter.to));
  return ex
    .select()
    .from(incentiveResults)
    .where(c.length ? and(...c) : undefined)
    .orderBy(desc(incentiveResults.id))
    .limit(500);
}
