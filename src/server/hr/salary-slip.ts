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

/** Company identity frozen onto a slip (Admin UAT Batch-2 follow-up §3) — from
 *  the ONE central Company Branding source, snapshotted so a re-render stays
 *  byte-identical even after branding later changes. */
export interface SlipBranding {
  companyName: string;
  legalName: string | null;
  address: string | null;
  taxId: string | null;
  footer: string | null;
  logoMime: string | null;
  /** base64 of the exact logo bytes embedded in the PDF (or null) */
  logoDataBase64: string | null;
}

/** The subset of a payroll_run that a salary slip freezes. */
export interface SlipSnapshot {
  process: string;
  baseSalary: string; // "30000.00"  (== monthlyBaseSalary unless proration)
  monthlyBaseSalary: string;
  payableBaseSalary: string;
  regularityBonus: number; // whole rupees
  calculatedSalary: string; // net "31000.00"
  leaveCount: number;
  offCount: number;
  unpaidLeaveDays: number;
  lateShortCount: number;
  lateFullCount: number;
  lateUnits: string; // "3.0"
  lateDeduction: string; // "1000.00"
  payrollStatusAtGeneration: PayrollStatus;
  calculationVersion: string;
  /* identity — not part of the money figures, carried for the document */
  employeeCode: string;
  joiningDate: string | null;
  branding: SlipBranding;
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
  /* Batch-2 follow-up §3 — optional so the pure figure-comparison helpers can
   *  keep passing minimal fixtures; a real payroll_run row carries them all. */
  monthlyBaseSalary?: string;
  payableBaseSalary?: string;
  unpaidLeaveDays?: number;
  lateShortCount?: number;
  lateFullCount?: number;
  lateUnits?: string;
  lateDeduction?: string;
}

const EMPTY_BRANDING: SlipBranding = {
  companyName: "",
  legalName: null,
  address: null,
  taxId: null,
  footer: null,
  logoMime: null,
  logoDataBase64: null,
};

/**
 * `extra` (identity + branding) is optional ONLY so the pure figure-comparison
 * helpers (`snapshotUnchanged` in the batch) can build a snapshot without it —
 * `slipSnapshotEquals` never looks at identity or branding. The real
 * `generateSlipForRun` always supplies it.
 */
export function buildSlipSnapshot(
  run: PayrollRunLike,
  extra: { employeeCode: string; joiningDate: string | null; branding: SlipBranding } = {
    employeeCode: "",
    joiningDate: null,
    branding: EMPTY_BRANDING,
  },
): SlipSnapshot {
  return {
    process: run.process,
    baseSalary: run.baseSalary,
    monthlyBaseSalary: run.monthlyBaseSalary ?? run.baseSalary,
    payableBaseSalary: run.payableBaseSalary ?? run.baseSalary,
    regularityBonus: run.regularityBonus,
    calculatedSalary: run.calculatedSalary,
    leaveCount: run.leaveCount,
    offCount: run.offCount,
    unpaidLeaveDays: run.unpaidLeaveDays ?? 0,
    lateShortCount: run.lateShortCount ?? 0,
    lateFullCount: run.lateFullCount ?? 0,
    lateUnits: run.lateUnits ?? "0.0",
    lateDeduction: run.lateDeduction ?? "0.00",
    payrollStatusAtGeneration: run.status as PayrollStatus,
    calculationVersion: run.calculationVersion,
    employeeCode: extra.employeeCode,
    joiningDate: extra.joiningDate,
    branding: extra.branding,
  };
}

/** Do two snapshots represent the same payroll FIGURES? (generation metadata
 *  such as timestamps, and cosmetic identity/branding, are intentionally
 *  excluded.) A regenerate after a reopen that changed any figure returns false
 *  → the caller writes a NEW version. */
export function slipSnapshotEquals(a: SlipSnapshot, b: SlipSnapshot): boolean {
  return (
    a.process === b.process &&
    a.baseSalary === b.baseSalary &&
    a.monthlyBaseSalary === b.monthlyBaseSalary &&
    a.payableBaseSalary === b.payableBaseSalary &&
    a.regularityBonus === b.regularityBonus &&
    a.calculatedSalary === b.calculatedSalary &&
    a.leaveCount === b.leaveCount &&
    a.offCount === b.offCount &&
    a.unpaidLeaveDays === b.unpaidLeaveDays &&
    a.lateShortCount === b.lateShortCount &&
    a.lateFullCount === b.lateFullCount &&
    a.lateUnits === b.lateUnits &&
    a.lateDeduction === b.lateDeduction &&
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
