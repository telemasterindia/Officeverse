/**
 * Officeverse — Monthly Regularity Bonus calculation (Phase 12). PURE. No DB.
 *
 * FROZEN BUSINESS RULE:
 *   No approved leave AND no effective Off in the calendar month → ₹1,000.
 *   ANY approved leave OR ANY effective Off → not eligible, ₹0.
 *
 * Counts INCLUDE sandwich-generated leave days (they are leave) and Off records
 * from Late/Short conversion (they are Off). They EXCLUDE pending/rejected/
 * cancelled leave and VOID Off — but that filtering is the caller's job: this
 * function consumes the already-authoritative Phase-11 counts, never
 * attendance.status.
 */

export const REGULARITY_BONUS_AMOUNT = 1000;
export const REGULARITY_RULE_VERSION = "v1";

export type DisqualifyingReason = "APPROVED_LEAVE" | "OFF_RECORDED";

export interface BonusInput {
  periodMonth: string; // "YYYY-MM"
  /** distinct approved leave_days (ORIGINAL + SANDWICH) whose date is in the month */
  approvedLeaveDaysInMonth: number;
  /** ACTIVE off_records for the month (VOID already excluded) */
  effectiveOffCountInMonth: number;
}

export interface BonusResult {
  periodMonth: string;
  eligible: boolean;
  bonusAmount: number;
  leaveCount: number;
  offCount: number;
  disqualifyingReasons: DisqualifyingReason[];
  calculationVersion: string;
}

export function computeRegularityBonus(input: BonusInput): BonusResult {
  const leaveCount = Math.max(0, Math.trunc(input.approvedLeaveDaysInMonth));
  const offCount = Math.max(0, Math.trunc(input.effectiveOffCountInMonth));

  const reasons: DisqualifyingReason[] = [];
  if (leaveCount > 0) reasons.push("APPROVED_LEAVE");
  if (offCount > 0) reasons.push("OFF_RECORDED");

  const eligible = reasons.length === 0;
  return {
    periodMonth: input.periodMonth,
    eligible,
    bonusAmount: eligible ? REGULARITY_BONUS_AMOUNT : 0,
    leaveCount,
    offCount,
    disqualifyingReasons: reasons,
    calculationVersion: REGULARITY_RULE_VERSION,
  };
}

/** Human sentence for the employee view. */
export function bonusReasonText(r: BonusResult): string {
  if (r.eligible) return "Eligible — no Leave and no Off this month.";
  const bits: string[] = [];
  if (r.disqualifyingReasons.includes("APPROVED_LEAVE")) bits.push("Approved Leave recorded");
  if (r.disqualifyingReasons.includes("OFF_RECORDED")) bits.push("Off recorded");
  return `Not eligible — ${bits.join(" and ")}.`;
}
