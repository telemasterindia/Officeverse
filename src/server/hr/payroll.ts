/**
 * Officeverse — monthly payroll calculation + lifecycle rules (Phase 13). PURE.
 * No DB, no I/O.
 *
 * SCOPE (deliberately minimal — no salary business rule is invented here):
 *   calculatedSalary = baseSalary + regularityBonus
 *
 * There is NO deduction, tax, PF, ESI, TDS, proration, unpaid-leave or
 * attendance-penalty term — those rules are not frozen, so they are not
 * modelled. There is deliberately no separate-statement / bonus-beyond-
 * regularity field either. leaveCount / offCount are carried for the snapshot
 * and the views ONLY; they do not change the amount.
 *
 * The regularity bonus is NOT recomputed here — the caller passes the
 * authoritative Phase-12 result in.
 */
import { paiseToAmount, sumPaise, toPaise, toSignedPaise } from "./payroll-money";
import {
  prorateBaseSalary,
  type EmploymentPeriodLike,
  type ProrationBasis,
} from "./payroll-proration";

export const PAYROLL_CALC_VERSION = "v1";
/** Phase 16 breakdown calc — proration + unpaid-leave / Off / overtime /
 *  adjustment TERMS present (values default to 0 until their business rate is
 *  configured). Old "v1" rows keep their meaning. */
export const PAYROLL_CALC_VERSION_V2 = "v2";

export const PAYROLL_STATUSES = ["DRAFT", "CALCULATED", "APPROVED", "LOCKED"] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

/* --------------------------- money helpers ----------------------- */

/** paise-safe add of a rupee amount (may carry paise) and a whole-rupee amount. */
function addMoney(rupees: number, wholeRupees: number): number {
  const paise = Math.round(rupees * 100) + Math.round(wholeRupees) * 100;
  return paise / 100;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* --------------------------- calculation ------------------------- */

export interface PayrollCalcInput {
  /** monthly base salary in rupees, from the effective-dated salary profile */
  baseSalary: number;
  /** authoritative ₹ Regularity Bonus for the month (Phase-12 result) — 0 or 1000 */
  regularityBonus: number;
  /** authoritative leave-day count for the month (snapshot / display only) */
  leaveCount: number;
  /** authoritative Off count for the month (snapshot / display only) */
  offCount: number;
}

export interface PayrollCalcResult {
  baseSalary: number;
  regularityBonus: number;
  /** baseSalary + regularityBonus — nothing else */
  calculatedSalary: number;
  leaveCount: number;
  offCount: number;
  calculationVersion: string;
}

export function calculatePayroll(input: PayrollCalcInput): PayrollCalcResult {
  if (!Number.isFinite(input.baseSalary) || input.baseSalary < 0) {
    throw new Error("baseSalary must be a finite number >= 0");
  }
  if (!Number.isFinite(input.regularityBonus) || input.regularityBonus < 0) {
    throw new Error("regularityBonus must be a finite number >= 0");
  }

  const baseSalary = round2(input.baseSalary);
  const regularityBonus = Math.trunc(input.regularityBonus);
  const calculatedSalary = addMoney(baseSalary, regularityBonus);
  const leaveCount = Math.max(0, Math.trunc(input.leaveCount || 0));
  const offCount = Math.max(0, Math.trunc(input.offCount || 0));

  return {
    baseSalary,
    regularityBonus,
    calculatedSalary,
    leaveCount,
    offCount,
    calculationVersion: PAYROLL_CALC_VERSION,
  };
}

/* ================= Phase 16 — breakdown calculation ============= *
 * Composes the monthly gross-before-statutory from explicit inputs.
 *
 * FROZEN behaviour: with every Phase-16 term at its default (no proration
 * basis, no unpaid-leave rate, no Off rate, no overtime rate, no adjustments)
 * this is EXACTLY the Phase-13 result: gross = baseSalary + regularityBonus.
 *
 * Terms whose monetary RATE is an undefined business decision
 * (unpaidLeaveDeduction, offDeduction, overtimeAmount) are accepted as
 * already-resolved PAISE values from the service; the service passes 0 until a
 * rate is configured — this engine never invents a rate.
 * -------------------------------------------------------------------- */

export interface MonthlyPayrollInput {
  month: string; // "YYYY-MM"
  /** full-month base salary in rupees (from the effective-dated profile) */
  monthlyBaseSalary: number;
  /** authoritative ₹ Regularity Bonus for the month (Phase-12) — 0 or 1000 */
  regularityBonus: number;
  /** proration inputs — omit basis to keep the full month payable */
  employmentPeriods?: EmploymentPeriodLike[];
  prorationBasis?: ProrationBasis | null | undefined;
  /** authoritative counts (snapshot / provenance) */
  approvedLeaveDays?: number;
  unpaidLeaveDays?: number;
  activeOffDays?: number;
  approvedOvertimeMinutes?: number;
  /** already-resolved deduction/earning amounts in RUPEES (service supplies 0
   *  until the business rate exists). unpaidLeaveDeduction / offDeduction are
   *  positive numbers that REDUCE gross; overtimeAmount / adjustmentsTotal are
   *  signed and ADD to gross. */
  unpaidLeaveDeduction?: number;
  offDeduction?: number;
  overtimeAmount?: number;
  adjustmentsTotal?: number;
}

export interface MonthlyPayrollResult {
  month: string;
  monthlyBaseSalary: string;
  payableBaseSalary: string;
  prorationApplied: boolean;
  prorationBasis: string | null;
  prorationNumerator: number;
  prorationDenominator: number;
  regularityBonus: number;
  approvedLeaveDays: number;
  unpaidLeaveDays: number;
  unpaidLeaveDeduction: string;
  activeOffDays: number;
  offDeduction: string;
  approvedOvertimeMinutes: number;
  overtimeAmount: string;
  adjustmentsTotal: string;
  /** gross before statutory deductions */
  calculatedSalary: string;
  calculationVersion: string;
}

export function calculateMonthlyPayroll(input: MonthlyPayrollInput): MonthlyPayrollResult {
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new Error("month must be YYYY-MM");
  if (!Number.isFinite(input.monthlyBaseSalary) || input.monthlyBaseSalary < 0) {
    throw new Error("monthlyBaseSalary must be a finite number >= 0");
  }
  if (!Number.isFinite(input.regularityBonus) || input.regularityBonus < 0) {
    throw new Error("regularityBonus must be a finite number >= 0");
  }
  for (const [k, v] of [
    ["unpaidLeaveDeduction", input.unpaidLeaveDeduction],
    ["offDeduction", input.offDeduction],
  ] as const) {
    if (v != null && (!Number.isFinite(v) || v < 0)) {
      throw new Error(`${k} must be a finite number >= 0`);
    }
  }

  const monthlyBasePaise = toPaise(input.monthlyBaseSalary);
  const proration = prorateBaseSalary({
    monthlyBasePaise,
    month: input.month,
    employmentPeriods: input.employmentPeriods ?? [],
    basis: input.prorationBasis ?? null,
  });

  const regularityBonusPaise = toPaise(Math.trunc(input.regularityBonus)); // ₹ integer
  const unpaidDeductionPaise = toPaise(input.unpaidLeaveDeduction ?? 0);
  const offDeductionPaise = toPaise(input.offDeduction ?? 0);
  const overtimePaise = toSignedPaise(input.overtimeAmount ?? 0);
  const adjustmentsPaise = toSignedPaise(input.adjustmentsTotal ?? 0);

  const grossPaise = sumPaise(
    proration.payableBasePaise,
    regularityBonusPaise,
    overtimePaise,
    adjustmentsPaise,
    -unpaidDeductionPaise,
    -offDeductionPaise,
  );

  return {
    month: input.month,
    monthlyBaseSalary: paiseToAmount(monthlyBasePaise),
    payableBaseSalary: paiseToAmount(proration.payableBasePaise),
    prorationApplied: proration.applied,
    prorationBasis: proration.basis,
    prorationNumerator: proration.numerator,
    prorationDenominator: proration.denominator,
    regularityBonus: Math.trunc(input.regularityBonus),
    approvedLeaveDays: Math.max(0, Math.trunc(input.approvedLeaveDays ?? 0)),
    unpaidLeaveDays: Math.max(0, Math.trunc(input.unpaidLeaveDays ?? 0)),
    unpaidLeaveDeduction: paiseToAmount(unpaidDeductionPaise),
    activeOffDays: Math.max(0, Math.trunc(input.activeOffDays ?? 0)),
    offDeduction: paiseToAmount(offDeductionPaise),
    approvedOvertimeMinutes: Math.max(0, Math.trunc(input.approvedOvertimeMinutes ?? 0)),
    overtimeAmount: paiseToAmount(overtimePaise),
    adjustmentsTotal: paiseToAmount(adjustmentsPaise),
    calculatedSalary: paiseToAmount(grossPaise < 0 ? 0 : grossPaise),
    calculationVersion: PAYROLL_CALC_VERSION_V2,
  };
}

/* --------------------- effective-dated salary ------------------- */

export interface EffectiveProfileLike {
  id: number;
  baseSalary: string | number;
  effectiveFrom: string; // "YYYY-MM-DD"
  effectiveTo: string | null;
  active: boolean;
}

/** first calendar day of a "YYYY-MM" period. */
export function periodFirstDay(periodMonth: string): string {
  return `${periodMonth}-01`;
}

/**
 * Pick the base-salary profile in effect on the FIRST day of the payroll month.
 * A raise dated later in / after the month never affects it, so a past month's
 * payroll keeps its original salary. Returns null when nothing applies.
 */
export function pickEffectiveProfile<T extends EffectiveProfileLike>(
  profiles: T[],
  periodMonth: string,
): T | null {
  const onDay = periodFirstDay(periodMonth);
  const eligible = profiles.filter(
    (p) =>
      p.active && p.effectiveFrom <= onDay && (p.effectiveTo == null || p.effectiveTo >= onDay),
  );
  if (eligible.length === 0) return null;
  // latest start wins (deterministic tie-break on id)
  eligible.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.id - a.id);
  return eligible[0] ?? null;
}

/* ----------------------- lifecycle rules ----------------------- */

/** A DRAFT or CALCULATED run may be (re)calculated in place. APPROVED / LOCKED
 *  may not — they must be explicitly reopened first. */
export function canRecalculate(status: PayrollStatus): boolean {
  return status === "DRAFT" || status === "CALCULATED";
}

/** Only a CALCULATED run can be approved. */
export function canApprove(status: PayrollStatus): boolean {
  return status === "CALCULATED";
}

/** Only an APPROVED run can be locked. */
export function canLock(status: PayrollStatus): boolean {
  return status === "APPROVED";
}

/** APPROVED or LOCKED runs are the only ones that need reopening. */
export function canReopen(status: PayrollStatus): boolean {
  return status === "APPROVED" || status === "LOCKED";
}

export type PayrollAction = "calculate" | "approve" | "lock" | "reopen";

/** Guard used by the service before any state change. */
export function assertPayrollTransition(status: PayrollStatus, action: PayrollAction): void {
  const ok =
    (action === "calculate" && canRecalculate(status)) ||
    (action === "approve" && canApprove(status)) ||
    (action === "lock" && canLock(status)) ||
    (action === "reopen" && canReopen(status));
  if (!ok) {
    throw new Error(`Cannot ${action} a ${status} payroll run`);
  }
}
