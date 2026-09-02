/**
 * Officeverse — Monthly Regularity Bonus calculation (Phase 12; rule extended in
 * Admin UAT Batch-2 §5). PURE. No DB.
 *
 * BUSINESS RULE:
 *   No approved leave AND no effective Off AND fewer than 3 Late Units in the
 *   calendar month → ₹1,000.
 *   ANY approved leave OR ANY effective Off OR Late Units ≥ 3 → not eligible, ₹0.
 *
 * Counts INCLUDE sandwich-generated leave days (they are leave) and Off records
 * from Late/Short conversion (they are Off). They EXCLUDE pending/rejected/
 * cancelled leave and VOID Off — but that filtering is the caller's job: this
 * function consumes the already-authoritative Phase-11 counts, never
 * attendance.status. The Late-Unit weighting + the 3-unit threshold are computed
 * in `./late-units.ts`; this engine only consumes the boolean outcome.
 */

export const REGULARITY_BONUS_AMOUNT = 1000;
/** v2 — Admin UAT Batch-2 §5 added the Late-Units disqualifier. v1 rows keep
 *  their meaning (leave / Off only). */
export const REGULARITY_RULE_VERSION = "v2";

export type DisqualifyingReason = "APPROVED_LEAVE" | "OFF_RECORDED" | "LATE_UNITS_THRESHOLD";

export interface BonusInput {
  periodMonth: string; // "YYYY-MM"
  /** distinct approved leave_days (ORIGINAL + SANDWICH) whose date is in the month */
  approvedLeaveDaysInMonth: number;
  /** ACTIVE off_records for the month (VOID already excluded) */
  effectiveOffCountInMonth: number;
  /** Admin UAT Batch-2 §5 — true when monthly Late Units ≥ 3 (see late-units.ts).
   *  Optional + defaulting to false keeps every pre-Batch-2 caller unchanged. */
  lateUnitsThresholdReached?: boolean | undefined;
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
  if (input.lateUnitsThresholdReached === true) reasons.push("LATE_UNITS_THRESHOLD");

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
  if (r.disqualifyingReasons.includes("LATE_UNITS_THRESHOLD")) {
    bits.push("3 or more Late Units this month");
  }
  return `Not eligible — ${bits.join(" and ")}.`;
}
