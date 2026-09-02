/**
 * Officeverse — gamification POINTS engine (Phase 20). PURE. No DB, no money.
 *
 * GAMIFICATION IS NOT PAYROLL / INCENTIVE / COMMISSION / REGULARITY BONUS.
 * Nothing in this module (or anything that imports it) is ever read by an HR /
 * payroll / salary-slip calculation. Points are abstract.
 *
 * Point values are DATA-DRIVEN: an Admin configures `gamification_point_rules`
 * (one row per event). Until configured, every rule defaults to 0 points — the
 * engine NEVER invents a value. The example numbers from earlier discussion
 * (+1 / +5 / +20) are NOT frozen and are NOT hard-coded here.
 *
 * The user's total is DERIVED from the immutable transaction ledger
 * (SUM of ACTIVE points); a reversal is an appended negative-mirror row, the
 * original row is never mutated or deleted.
 */

export const GAMIFICATION_EVENTS = [
  "LEAD_SUBMITTED",
  "LEAD_ACCEPTED",
  "SALE",
  "TEAM_MILESTONE",
  "ACHIEVEMENT_UNLOCKED",
  "ADMIN_ADJUSTMENT",
] as const;
export type GamificationEvent = (typeof GAMIFICATION_EVENTS)[number];

/** Events that a normal business action can auto-award. Follow-up activity is
 *  deliberately absent — Follow-up Health is operational, not gamified. */
export const AUTO_AWARD_EVENTS: readonly GamificationEvent[] = [
  "LEAD_SUBMITTED",
  "LEAD_ACCEPTED",
  "SALE",
  "TEAM_MILESTONE",
  "ACHIEVEMENT_UNLOCKED",
];

export function isGamificationEvent(x: string): x is GamificationEvent {
  return (GAMIFICATION_EVENTS as readonly string[]).includes(x);
}

/** Config rows are default-0 and admin-owned. The seed used by the first
 *  migration/seeder — every value is a placeholder the Admin overrides. */
export const DEFAULT_POINT_RULES: ReadonlyArray<{
  event: GamificationEvent;
  points: number;
  enabled: boolean;
  note: string;
}> = GAMIFICATION_EVENTS.filter((e) => e !== "ADMIN_ADJUSTMENT").map((event) => ({
  event,
  points: 0, // CONFIGURABLE — 0 until an Admin sets a value
  enabled: true,
  note: "configure the point value in the gamification rules",
}));

export interface PointRuleLike {
  event: string;
  points: number;
  enabled: boolean;
}

/** Points for one occurrence of `event` given the current rule set. Missing /
 *  disabled / negative rule → 0. Never guesses. */
export function resolvePoints(rules: PointRuleLike[], event: GamificationEvent): number {
  const rule = rules.find((r) => r.event === event);
  if (!rule || !rule.enabled) return 0;
  const p = Math.trunc(rule.points);
  return Number.isFinite(p) && p > 0 ? p : 0;
}

/* ------------------------- idempotency key ------------------------ */

function slug(s: string | number | null | undefined): string {
  return String(s ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .slice(0, 80);
}

/**
 * Deterministic award-once key for a business event. The same lead being
 * accepted, a page refresh, a retried request and a duplicate webhook all
 * produce the SAME key → the unique index rejects the second insert.
 */
export function dedupeKeyFor(
  event: GamificationEvent,
  referenceType: string | null | undefined,
  referenceId: string | number | null | undefined,
): string {
  return `${event}:${slug(referenceType) || "none"}:${slug(referenceId) || "none"}`;
}

/** Key for the reversal of a specific transaction — one reversal per txn. */
export function reversalDedupeKey(originalTxnId: number): string {
  return `REVERSAL:${Math.max(0, Math.trunc(originalTxnId))}`;
}

/**
 * Award-once key for the open-ended Scoring Engine (Phase 2+). Distinct from
 * `dedupeKeyFor` so that N different scoring rules may each score one event
 * exactly once, while the SAME rule can never score the same event twice:
 *
 *   <event>:<sourceType>:<sourceId>:rule:<ruleId>:v<ruleVersion>
 *
 * The legacy `dedupeKeyFor` above is unchanged and still owns the pre-engine
 * `<event>:<referenceType>:<referenceId>` space, so the two never collide.
 */
export function scoredDedupeKey(
  event: string,
  sourceType: string | null | undefined,
  sourceId: string | number | null | undefined,
  ruleId: number,
  ruleVersion: number,
): string {
  return `${slug(event) || "none"}:${slug(sourceType) || "none"}:${slug(sourceId) || "none"}:rule:${Math.trunc(
    ruleId,
  )}:v${Math.trunc(ruleVersion)}`;
}

/* ---------------------- total from the ledger -------------------- */

export interface LedgerRowLike {
  points: number;
  status: string; // "ACTIVE" | "REVERSED"
}

/**
 * Authoritative total = SUM of points over ACTIVE rows only.
 *
 * A reversal appends a negative-mirror row AND flips the original to REVERSED
 * (both excluded from the sum) so the total drops by exactly the original
 * amount, once — while both rows stay in the ledger for the audit trail.
 */
export function totalPoints(rows: LedgerRowLike[]): number {
  return rows.reduce((acc, r) => (r.status === "ACTIVE" ? acc + Math.trunc(r.points) : acc), 0);
}
