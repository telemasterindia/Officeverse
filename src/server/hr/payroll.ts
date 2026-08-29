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

export const PAYROLL_CALC_VERSION = "v1";

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
