/**
 * Officeverse — Scoring Engine repositories (Phase 2). DATA ACCESS ONLY.
 *
 * scoring_rules (mutable header) · scoring_rule_versions (immutable snapshots) ·
 * scoring_runs (audit + run-once idempotency). No business evaluation logic
 * lives here — that is `src/server/scoring/*`. Nothing here is read by HR /
 * payroll code, and nothing here mutates a CRM row.
 */
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  scoringRuleVersions,
  scoringRules,
  scoringRuns,
  type NewScoringRule,
  type NewScoringRuleVersion,
  type NewScoringRun,
  type ScoringRule,
  type ScoringRuleVersion,
  type ScoringRun,
} from "@/lib/db/schema";

/* -------------------------------- rules ---------------------------------- */

export interface RuleWithVersions extends ScoringRule {
  versions: ScoringRuleVersion[];
}

export async function getRuleById(id: number, ex: DBX = getDb()): Promise<ScoringRule | undefined> {
  const rows = await ex.select().from(scoringRules).where(eq(scoringRules.id, id)).limit(1);
  return rows[0];
}

export async function listRules(
  filter: { event?: string; enabledOnly?: boolean } = {},
  ex: DBX = getDb(),
): Promise<ScoringRule[]> {
  const conds: SQL[] = [];
  if (filter.event) conds.push(eq(scoringRules.event, filter.event));
  if (filter.enabledOnly) conds.push(eq(scoringRules.enabled, true));
  const q = ex.select().from(scoringRules);
  const rows = conds.length ? await q.where(and(...conds)) : await q;
  return [...rows].sort((a, b) => a.priority - b.priority || a.id - b.id);
}

export async function getVersionsForRule(
  ruleId: number,
  ex: DBX = getDb(),
): Promise<ScoringRuleVersion[]> {
  return ex
    .select()
    .from(scoringRuleVersions)
    .where(eq(scoringRuleVersions.ruleId, ruleId))
    .orderBy(asc(scoringRuleVersions.version));
}

/** Enabled rules for an event, each with ALL its versions (caller selects by date). */
export async function listEnabledRulesForEvent(
  event: string,
  ex: DBX = getDb(),
): Promise<RuleWithVersions[]> {
  const rules = await ex
    .select()
    .from(scoringRules)
    .where(and(eq(scoringRules.enabled, true), eq(scoringRules.event, event)))
    .orderBy(asc(scoringRules.priority), asc(scoringRules.id));
  if (rules.length === 0) return [];

  const out: RuleWithVersions[] = [];
  for (const r of rules) {
    const versions = await getVersionsForRule(r.id, ex);
    out.push({ ...r, versions });
  }
  return out;
}

/**
 * Rules (any status) with all versions — for the Admin console + Admin dry-run
 * (which may preview a still-disabled rule). `enabledOnly` narrows to live rules.
 */
export async function listRulesWithVersions(
  filter: { event?: string; enabledOnly?: boolean; ruleId?: number } = {},
  ex: DBX = getDb(),
): Promise<RuleWithVersions[]> {
  const conds: SQL[] = [];
  if (filter.event) conds.push(eq(scoringRules.event, filter.event));
  if (filter.enabledOnly) conds.push(eq(scoringRules.enabled, true));
  if (filter.ruleId) conds.push(eq(scoringRules.id, filter.ruleId));
  const base = ex.select().from(scoringRules);
  const rules = conds.length ? await base.where(and(...conds)) : await base;
  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.id - b.id);
  const out: RuleWithVersions[] = [];
  for (const r of sorted) {
    out.push({ ...r, versions: await getVersionsForRule(r.id, ex) });
  }
  return out;
}

export async function countEnabledRulesForEvent(event: string, ex: DBX = getDb()): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`count(*)` })
    .from(scoringRules)
    .where(and(eq(scoringRules.enabled, true), eq(scoringRules.event, event)));
  return Number(rows[0]?.n ?? 0);
}

export async function insertRule(v: NewScoringRule, ex: DBX = getDb()): Promise<number> {
  const rows = await ex.insert(scoringRules).values(v).$returningId();
  return Number(rows[0]?.id ?? 0);
}

export async function updateRuleHeader(
  id: number,
  patch: Partial<
    Pick<
      NewScoringRule,
      | "name"
      | "event"
      | "appliesTo"
      | "ruleMatchingMode"
      | "priority"
      | "enabled"
      | "currentVersion"
      | "updatedAt"
    >
  >,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(scoringRules).set(patch).where(eq(scoringRules.id, id));
}

export async function setRuleEnabled(
  id: number,
  enabled: boolean,
  updatedAt: string,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(scoringRules).set({ enabled, updatedAt }).where(eq(scoringRules.id, id));
}

/* ------------------------------ versions -------------------------------- */

export async function insertRuleVersion(
  v: NewScoringRuleVersion,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex.insert(scoringRuleVersions).values(v).$returningId();
  return Number(rows[0]?.id ?? 0);
}

/** Close the currently-open version (effective_until IS NULL) at `from`. */
export async function closeOpenVersionAt(
  ruleId: number,
  from: string,
  ex: DBX = getDb(),
): Promise<void> {
  await ex
    .update(scoringRuleVersions)
    .set({ effectiveUntil: from })
    .where(
      and(
        eq(scoringRuleVersions.ruleId, ruleId),
        sql`${scoringRuleVersions.effectiveUntil} is null`,
      ),
    );
}

/* -------------------------------- runs ---------------------------------- */

export async function findRun(
  eventType: string,
  sourceType: string,
  sourceId: string,
  ex: DBX = getDb(),
): Promise<ScoringRun | undefined> {
  const rows = await ex
    .select()
    .from(scoringRuns)
    .where(
      and(
        eq(scoringRuns.eventType, eventType),
        eq(scoringRuns.sourceType, sourceType),
        eq(scoringRuns.sourceId, sourceId),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Insert one run row. Returns the id + whether THIS call created it (run-once). */
export async function insertRun(
  v: NewScoringRun,
  ex: DBX = getDb(),
): Promise<{ id: number; created: boolean }> {
  const existing = await findRun(v.eventType, v.sourceType, v.sourceId, ex);
  if (existing) return { id: existing.id, created: false };
  try {
    const rows = await ex.insert(scoringRuns).values(v).$returningId();
    return { id: Number(rows[0]?.id ?? 0), created: true };
  } catch {
    const row = await findRun(v.eventType, v.sourceType, v.sourceId, ex);
    return { id: row?.id ?? 0, created: false };
  }
}

export async function listRecentRuns(limit = 50, ex: DBX = getDb()): Promise<ScoringRun[]> {
  return ex
    .select()
    .from(scoringRuns)
    .orderBy(desc(scoringRuns.id))
    .limit(Math.min(200, Math.max(1, limit)));
}
