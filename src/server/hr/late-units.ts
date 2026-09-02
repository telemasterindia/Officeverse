/**
 * Officeverse — Late-Unit threshold + Regularity Bonus rule (Admin UAT Batch-2 §5).
 * PURE. No DB. No money side effects.
 *
 * AUTHORITATIVE BUSINESS RULE (Owner-confirmed, supersedes the earlier
 * "2 Late = 1 Off" / "3 Short = 1 Off" conversion for pay purposes):
 *
 *   Short Late  = 1.0 unit
 *   Late        = 1.5 units
 *   Late Units  = shortLateCount × 1.0  +  lateCount × 1.5
 *
 *   Late Units ≥ 3  → ONE day salary cut  +  NO ₹1,000 regularity bonus
 *   Late Units < 3  → no late-driven cut  +  ₹1,000 regularity bonus,
 *                     PROVIDED there is no actual approved leave / absence
 *                     in the month (which independently voids the bonus per
 *                     the existing frozen leave rule).
 *
 *   Worked examples:
 *     1 Short              1.0  → no cut · bonus
 *     2 Short              2.0  → no cut · bonus
 *     1 Late               1.5  → no cut · bonus
 *     1 Short + 1 Late     2.5  → no cut · bonus
 *     2 Short + 1 Late     3.5  → 1-day cut · no bonus
 *     3 Short              3.0  → 1-day cut · no bonus
 *     2 Late               3.0  → 1-day cut · no bonus
 *
 * ONE day's value = monthlyBaseSalary ÷ ACTUAL calendar days in the payroll
 * month being calculated (Aug ÷ 31, Sep ÷ 30, Feb ÷ 28, leap Feb ÷ 29).
 */

export const SHORT_LATE_UNITS = 1.0;
export const LATE_UNITS = 1.5;
export const LATE_UNITS_THRESHOLD = 3;
export const REGULARITY_BONUS_AMOUNT = 1000;
/** rule version stamped on payroll snapshots for auditability */
export const LATE_UNITS_RULE_VERSION = "late-units-v1";

export interface LateUnitsInput {
  shortLateCount: number;
  lateCount: number;
}

export interface LateUnitsResult {
  shortLateCount: number;
  lateCount: number;
  /** shortLateCount × 1.0 + lateCount × 1.5 */
  lateUnits: number;
  thresholdReached: boolean;
  /** number of full days of salary to deduct for lateness (0 or 1) */
  salaryCutDays: number;
  /** true when lateness alone blocks the ₹1,000 bonus */
  bonusBlockedByLate: boolean;
  ruleVersion: string;
}

const nn = (n: number): number => Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));

export function computeLateUnits(input: LateUnitsInput): LateUnitsResult {
  const shortLateCount = nn(input.shortLateCount);
  const lateCount = nn(input.lateCount);
  // keep 1-decimal precision (weights are .0 / .5) and avoid float drift
  const lateUnits =
    Math.round((shortLateCount * SHORT_LATE_UNITS + lateCount * LATE_UNITS) * 10) / 10;
  const thresholdReached = lateUnits >= LATE_UNITS_THRESHOLD;
  return {
    shortLateCount,
    lateCount,
    lateUnits,
    thresholdReached,
    salaryCutDays: thresholdReached ? 1 : 0,
    bonusBlockedByLate: thresholdReached,
    ruleVersion: LATE_UNITS_RULE_VERSION,
  };
}

/** Actual calendar days in a "YYYY-MM" month (28..31). */
export function calendarDaysInMonth(month: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return 30;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** One day's salary = monthlyBaseSalary ÷ calendar days in that month, to paise. */
export function perDaySalary(monthlyBaseSalary: number, month: string): number {
  const base = Math.max(0, Number(monthlyBaseSalary) || 0);
  const days = calendarDaysInMonth(month);
  return Math.round((base / days) * 100) / 100;
}

export interface LateDeductionInput {
  monthlyBaseSalary: number;
  month: string; // "YYYY-MM"
  shortLateCount: number;
  lateCount: number;
}

export interface LateDeductionResult extends LateUnitsResult {
  month: string;
  perDaySalary: number;
  /** ₹ amount to deduct from salary for lateness (perDaySalary × salaryCutDays) */
  lateDeductionAmount: number;
}

export function computeLateDeduction(input: LateDeductionInput): LateDeductionResult {
  const units = computeLateUnits(input);
  const per = perDaySalary(input.monthlyBaseSalary, input.month);
  return {
    ...units,
    month: input.month,
    perDaySalary: per,
    lateDeductionAmount: Math.round(per * units.salaryCutDays * 100) / 100,
  };
}

export interface RegularityBonusInput {
  /** result of computeLateUnits (or its threshold) */
  lateThresholdReached: boolean;
  /** true when the month has any approved leave day OR effective Off / absence */
  hasApprovedLeaveOrAbsence: boolean;
}

export interface RegularityBonusResult {
  eligible: boolean;
  amount: number;
  reasons: string[];
  ruleVersion: string;
}

export function computeRegularityBonusV2(input: RegularityBonusInput): RegularityBonusResult {
  const reasons: string[] = [];
  if (input.lateThresholdReached) reasons.push("LATE_UNITS_THRESHOLD");
  if (input.hasApprovedLeaveOrAbsence) reasons.push("APPROVED_LEAVE_OR_ABSENCE");
  const eligible = reasons.length === 0;
  return {
    eligible,
    amount: eligible ? REGULARITY_BONUS_AMOUNT : 0,
    reasons,
    ruleVersion: LATE_UNITS_RULE_VERSION,
  };
}
