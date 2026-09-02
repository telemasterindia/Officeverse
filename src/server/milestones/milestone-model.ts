/**
 * Officeverse — MILESTONE ENGINE model (Phase 10 Stage 4). PURE.
 *
 * Milestones are a RECOGNITION layer. They CONSUME authoritative scoring-ledger
 * / performance data and, when a configured threshold is reached, fire ONE
 * recognition moment (celebration / announcement / Office TV). They never score,
 * never award points, never touch payroll / incentive.
 *
 * Every threshold, name, period, celebration and announcement choice is
 * configuration — nothing is hard-coded in logic. This module owns the config
 * shape + a total, never-throwing normaliser + validator.
 *
 * No DB, no I/O.
 */

export const MILESTONE_TYPES = [
  "INDIVIDUAL_COUNT",
  "INDIVIDUAL_POINTS",
  "INDIVIDUAL_EVENT",
  "TEAM_COUNT",
  "TEAM_POINTS",
  "TEAM_EVENT",
] as const;
export type MilestoneType = (typeof MILESTONE_TYPES)[number];

export const MILESTONE_PERIODS = ["DAILY", "WEEKLY", "MONTHLY", "ALL_TIME"] as const;
export type MilestonePeriod = (typeof MILESTONE_PERIODS)[number];

export const MILESTONE_TRIGGER_POLICIES = [
  "ONCE",
  "PER_PERIOD",
  "EVERY_THRESHOLD_CROSSING",
] as const;
export type MilestoneTriggerPolicy = (typeof MILESTONE_TRIGGER_POLICIES)[number];

export const MILESTONE_LEVELS = ["LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"] as const;
export type MilestoneLevel = (typeof MILESTONE_LEVELS)[number];

/** Future types the model accepts as *reserved* — configuration may name them,
 *  but Stage 4 evaluates only the six above; an unknown type fails safely
 *  (never fires) rather than throwing. */
export const RESERVED_MILESTONE_TYPES = [
  "SALES_TARGET",
  "REVENUE_TARGET",
  "DEBT_TARGET",
  "POWER_HOUR_TARGET",
  "STREAK_TARGET",
] as const;

export const TEAM_TYPES: ReadonlySet<string> = new Set(["TEAM_COUNT", "TEAM_POINTS", "TEAM_EVENT"]);
export const POINTS_TYPES: ReadonlySet<string> = new Set(["INDIVIDUAL_POINTS", "TEAM_POINTS"]);
export const COUNT_OR_EVENT_TYPES: ReadonlySet<string> = new Set([
  "INDIVIDUAL_COUNT",
  "INDIVIDUAL_EVENT",
  "TEAM_COUNT",
  "TEAM_EVENT",
]);

export interface MilestoneScope {
  processes: string[] | null;
}

export interface MilestoneDraft {
  name: string;
  description?: string | null;
  type: MilestoneType;
  /** ledger event key for COUNT / EVENT types; ignored for POINTS types */
  metric?: string | null;
  threshold: number;
  period?: MilestonePeriod;
  triggerPolicy?: MilestoneTriggerPolicy;
  scope?: MilestoneScope | null;
  priority?: number;
  recognitionLevel?: MilestoneLevel;
  celebrationProfileId?: number | null;
  announcementId?: number | null;
  /** "YYYY-MM-DD" operational date the milestone becomes active */
  effectiveFrom: string;
  effectiveUntil?: string | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** a ledger event key — uppercase letters, digits, underscore (no injection) */
const EVENT_KEY = /^[A-Z][A-Z0-9_]{1,63}$/;
const PROCESS = /^[A-Z]{2,4}$/;

export interface NormalizedMilestone {
  name: string;
  description: string | null;
  type: MilestoneType;
  metric: string | null;
  threshold: number;
  period: MilestonePeriod;
  triggerPolicy: MilestoneTriggerPolicy;
  scope: MilestoneScope | null;
  priority: number;
  recognitionLevel: MilestoneLevel;
  celebrationProfileId: number | null;
  announcementId: number | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

/** strip C0/C1 control chars + markup chars (no injection), collapse, cap */
function clean(v: unknown, max: number): string {
  let s = "";
  for (const ch of String(v ?? "")) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || ch === "<" || ch === ">" || ch === "&") s += " ";
    else s += ch;
  }
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Total — never throws. Used for storage + DTOs. */
export function normalizeMilestoneDraft(d: MilestoneDraft): NormalizedMilestone {
  const type = (MILESTONE_TYPES as readonly string[]).includes(d.type)
    ? d.type
    : ("INDIVIDUAL_COUNT" as MilestoneType);
  const period = (MILESTONE_PERIODS as readonly string[]).includes(d.period ?? "")
    ? (d.period as MilestonePeriod)
    : "ALL_TIME";
  const policy = (MILESTONE_TRIGGER_POLICIES as readonly string[]).includes(d.triggerPolicy ?? "")
    ? (d.triggerPolicy as MilestoneTriggerPolicy)
    : "ONCE";
  const level = (MILESTONE_LEVELS as readonly string[]).includes(d.recognitionLevel ?? "")
    ? (d.recognitionLevel as MilestoneLevel)
    : "LEVEL_2";
  const processes =
    d.scope && Array.isArray(d.scope.processes)
      ? d.scope.processes.map((p) => clean(p, 4)).filter((p) => PROCESS.test(p))
      : null;
  const th = Math.trunc(Number(d.threshold));
  return {
    name: clean(d.name, 120),
    description: d.description ? clean(d.description, 400) : null,
    type,
    metric: POINTS_TYPES.has(type) ? null : d.metric ? clean(d.metric, 64) : null,
    threshold: Number.isFinite(th) ? th : 0,
    period,
    triggerPolicy: policy,
    scope: processes && processes.length ? { processes } : null,
    priority:
      Number.isInteger(d.priority) &&
      (d.priority as number) >= 0 &&
      (d.priority as number) <= 100_000
        ? (d.priority as number)
        : 100,
    recognitionLevel: level,
    celebrationProfileId:
      Number.isInteger(d.celebrationProfileId) && (d.celebrationProfileId as number) > 0
        ? (d.celebrationProfileId as number)
        : null,
    announcementId:
      Number.isInteger(d.announcementId) && (d.announcementId as number) > 0
        ? (d.announcementId as number)
        : null,
    effectiveFrom: String(d.effectiveFrom ?? ""),
    effectiveUntil: d.effectiveUntil ? String(d.effectiveUntil) : null,
  };
}

/** Field-level error codes for the service to reject a bad draft. */
export function validateMilestoneDraft(d: MilestoneDraft): string[] {
  const errs: string[] = [];
  const n = normalizeMilestoneDraft(d);
  if (n.name.length === 0) errs.push("name_invalid");
  if (!(MILESTONE_TYPES as readonly string[]).includes(d.type)) errs.push("type_invalid");
  if (
    !(MILESTONE_PERIODS as readonly string[]).includes(d.period ?? "DAILY") &&
    d.period !== undefined
  )
    errs.push("period_invalid");
  if (
    d.triggerPolicy !== undefined &&
    !(MILESTONE_TRIGGER_POLICIES as readonly string[]).includes(d.triggerPolicy)
  )
    errs.push("trigger_policy_invalid");
  if (!Number.isInteger(n.threshold) || n.threshold <= 0 || n.threshold > 100_000_000)
    errs.push("threshold_invalid");
  if (COUNT_OR_EVENT_TYPES.has(n.type)) {
    if (!n.metric) errs.push("metric_required");
    else if (!EVENT_KEY.test(n.metric)) errs.push("metric_malformed");
  }
  if (!YMD.test(n.effectiveFrom)) errs.push("effective_from_invalid");
  if (n.effectiveUntil && !YMD.test(n.effectiveUntil)) errs.push("effective_until_invalid");
  if (n.effectiveUntil && YMD.test(n.effectiveUntil) && n.effectiveUntil < n.effectiveFrom)
    errs.push("effective_until_before_from");
  return errs;
}

export function isTeamType(type: string): boolean {
  return TEAM_TYPES.has(type);
}
export function isPointsType(type: string): boolean {
  return POINTS_TYPES.has(type);
}
/** an unknown / reserved-but-unimplemented type → never evaluated (fails safe) */
export function isEvaluableType(type: string): type is MilestoneType {
  return (MILESTONE_TYPES as readonly string[]).includes(type);
}
