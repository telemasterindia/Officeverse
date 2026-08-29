/**
 * Officeverse — salary-slip rules (Phase 14). PURE. No DB, no I/O.
 *
 * The salary slip is a PRESENTATION layer over a Phase-13 payroll_run. It never
 * recalculates salary — every value it shows is a snapshot of the authoritative
 * payroll_run taken at generation time.
 *
 * Eligibility:
 *   LOCKED    → final slip (preferred historical document)
 *   APPROVED  → final slip
 *   CALCULATED→ PREVIEW only (clearly marked, never the final document)
 *   DRAFT     → rejected
 */

export const PAYROLL_STATUSES = ["DRAFT", "CALCULATED", "APPROVED", "LOCKED"] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export interface SlipEligibility {
  ok: boolean;
  isPreview: boolean;
  reason: string;
}

export function salarySlipEligibility(
  payrollStatus: PayrollStatus,
  opts: { allowPreview?: boolean } = {},
): SlipEligibility {
  if (payrollStatus === "LOCKED" || payrollStatus === "APPROVED") {
    return { ok: true, isPreview: false, reason: "" };
  }
  if (payrollStatus === "CALCULATED") {
    return opts.allowPreview
      ? { ok: true, isPreview: true, reason: "Preview only — payroll is not yet approved." }
      : {
          ok: false,
          isPreview: false,
          reason: "Payroll must be APPROVED or LOCKED before a salary slip can be generated.",
        };
  }
  return {
    ok: false,
    isPreview: false,
    reason: "Payroll is still a DRAFT — nothing to generate a salary slip from.",
  };
}

/* --------------------------- filename ------------------------- */

/** Deterministic, path-traversal-safe filename. Employee-derived text is
 *  reduced to `[A-Za-z0-9_]`; empty falls back to `user<id>`. */
export function sanitizeSlipFilename(
  periodMonth: string,
  employeeName: string,
  userId: number,
  isPreview = false,
): string {
  const month = /^\d{4}-\d{2}$/.test(periodMonth) ? periodMonth : "unknown-month";
  const cleanedName = employeeName
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  const who = cleanedName || `user${Math.max(0, Math.trunc(userId))}`;
  const suffix = isPreview ? "_PREVIEW" : "";
  return `Officeverse_Salary_Slip_${month}_${who}${suffix}.pdf`;
}

/* --------------------------- snapshot ------------------------- */

/** The subset of a payroll_run that a salary slip freezes. */
export interface SlipSnapshot {
  process: string;
  baseSalary: string; // "30000.00"
  regularityBonus: number; // whole rupees
  calculatedSalary: string; // "31000.00"
  leaveCount: number;
  offCount: number;
  payrollStatusAtGeneration: PayrollStatus;
  calculationVersion: string;
}

export interface PayrollRunLike {
  process: string;
  status: string;
  baseSalary: string;
  regularityBonus: number;
  calculatedSalary: string;
  leaveCount: number;
  offCount: number;
  calculationVersion: string;
}

export function buildSlipSnapshot(run: PayrollRunLike): SlipSnapshot {
  return {
    process: run.process,
    baseSalary: run.baseSalary,
    regularityBonus: run.regularityBonus,
    calculatedSalary: run.calculatedSalary,
    leaveCount: run.leaveCount,
    offCount: run.offCount,
    payrollStatusAtGeneration: run.status as PayrollStatus,
    calculationVersion: run.calculationVersion,
  };
}

/** Do two snapshots represent the same payroll figures? (generation metadata
 *  such as timestamps is intentionally excluded.) A regenerate after a reopen
 *  that changed any figure returns false → the caller writes a NEW version. */
export function slipSnapshotEquals(a: SlipSnapshot, b: SlipSnapshot): boolean {
  return (
    a.process === b.process &&
    a.baseSalary === b.baseSalary &&
    a.regularityBonus === b.regularityBonus &&
    a.calculatedSalary === b.calculatedSalary &&
    a.leaveCount === b.leaveCount &&
    a.offCount === b.offCount &&
    a.payrollStatusAtGeneration === b.payrollStatusAtGeneration &&
    a.calculationVersion === b.calculationVersion
  );
}

/* ----------------------- send state machine ------------------ */

export type SalarySlipStatus = "GENERATED" | "SENT" | "FAILED";

/** Status of the slip DOCUMENT after a send attempt resolves. The document
 *  itself is never recreated by a send — only this status + the send history
 *  change. */
export function slipStatusAfterSend(success: boolean): SalarySlipStatus {
  return success ? "SENT" : "FAILED";
}
