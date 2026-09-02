/**
 * Officeverse — Payroll + Salary foundation service (Phase 13).
 *
 * Turns two authoritative inputs into an auditable monthly salary snapshot:
 *   1. the effective-dated base salary (salary_profiles)
 *   2. the Phase-12 ₹1,000 Regularity Bonus result (consumed, NOT recomputed)
 *
 * calculatedSalary = baseSalary + regularityBonus. No deduction / tax / PF /
 * ESI / TDS / proration term — those rules are not frozen. The Closer reward
 * track is entirely out of scope here and is never consumed or stored; it
 * remains a wholly separate future statement.
 *
 * Lifecycle: DRAFT → CALCULATED → APPROVED → LOCKED. APPROVED and LOCKED runs
 * are never silently mutated — an explicit, audited reopen is required.
 */
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { assertCanManagePayroll, type HrRole } from "../authz/hr";
import { nowIST } from "../time";
import {
  assertPayrollTransition,
  calculateMonthlyPayroll,
  pickEffectiveProfile,
  PAYROLL_CALC_VERSION_V2,
  type PayrollStatus,
} from "./payroll";
import { PRORATION_BASES, type ProrationBasis } from "./payroll-proration";
import { PAYROLL_ROUNDING_POLICY } from "./payroll-money";
import { computeLateDeduction } from "./late-units";
import { recomputeBonus } from "./service";
import { env } from "../env";
import * as repo from "../db/repos/payroll";
import * as inputsRepo from "../db/repos/payroll-inputs";
import * as hrRepo from "../db/repos/hr";
import { getAgentByCode, getCloserByCode } from "../db/repos/staff";
import { isCanonicalAgentCode, isCanonicalCloserCode } from "@/lib/officeverse/staff-codes";
import type { NewPayrollRun, NewSalaryProfile, PayrollRun, User } from "@/lib/db/schema";

type Meta = { ip?: string | null; userAgent?: string | null };

/**
 * Resolve a FULL canonical business Employee ID to the internal `users.id`.
 *
 * The prefix routes the lookup — `TMI_CC_###` → `agents.agent_code`,
 * `TMI_CL_###` → `closers.closer_code` — so an Agent and a Closer that share a
 * numeric suffix (e.g. `TMI_CC_010` vs `TMI_CL_010`) resolve to two different
 * users and can never collide. The id is obtained ONLY after this exact-string
 * match; the input is never coerced to a number and its prefix / leading zeros
 * are never stripped. Every payroll/salary employee-selection path goes through
 * here before touching `users.id`.
 */
export async function resolveEmployeeUserId(employeeId: string): Promise<number> {
  const code = (employeeId ?? "").trim();
  if (isCanonicalAgentCode(code)) {
    const a = await getAgentByCode(code);
    if (!a) throw new HttpError(404, `No Agent with Employee ID ${code}`, "employee_not_found");
    return a.userId;
  }
  if (isCanonicalCloserCode(code)) {
    const c = await getCloserByCode(code);
    if (!c) throw new HttpError(404, `No Closer with Employee ID ${code}`, "employee_not_found");
    return c.userId;
  }
  throw new HttpError(
    422,
    `"${code}" is not a valid Employee ID — use the full canonical form, e.g. TMI_CC_010 (Agent) or TMI_CL_010 (Closer)`,
    "bad_employee_id",
  );
}

/* --------------------------- small helpers ---------------------- */

function ymdRegex(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function monthRegex(v: string): boolean {
  return /^\d{4}-\d{2}$/.test(v);
}
function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta));
  return dt.toISOString().slice(0, 10);
}
function toAmount(n: number): string {
  return n.toFixed(2);
}
function monthDayRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
/** Proration is OFF unless the business has picked a denominator. */
function configuredProrationBasis(): ProrationBasis | null {
  const v = env("OFFICEVERSE_PRORATION_BASIS")?.toUpperCase();
  return v && (PRORATION_BASES as readonly string[]).includes(v) ? (v as ProrationBasis) : null;
}

async function processOf(userId: number): Promise<string> {
  const rows = await getDb()
    .select({ process: users.process })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.process ?? "US";
}

/* ==================== salary profile configuration ============== */

export interface SetSalaryInput {
  baseSalary: number; // rupees, >= 0
  effectiveFrom: string; // "YYYY-MM-DD"
  note?: string | undefined;
}

export interface SalaryProfileDTO {
  id: number;
  userId?: number;
  employeeName?: string;
  /** current canonical Employee ID (agents.agent_code / closers.closer_code) */
  employeeCode?: string | null;
  employeeRole?: string;
  photoAvailable?: boolean;
  process?: string;
  baseSalary: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  note: string | null;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

function profileDTO(
  p: {
    id: number;
    baseSalary: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    active: boolean;
    note: string | null;
    createdByUserId: number | null;
    updatedByUserId: number | null;
    createdAt: string;
    updatedAt: string;
    userId?: number;
  },
  extra?: {
    employeeName?: string;
    process?: string;
    employeeCode?: string | null;
    employeeRole?: string;
    photoAvailable?: boolean;
  },
): SalaryProfileDTO {
  return {
    id: p.id,
    ...(p.userId ? { userId: p.userId } : {}),
    ...(extra?.employeeName ? { employeeName: extra.employeeName } : {}),
    ...(extra?.process ? { process: extra.process } : {}),
    ...(extra?.employeeCode !== undefined ? { employeeCode: extra.employeeCode } : {}),
    ...(extra?.employeeRole ? { employeeRole: extra.employeeRole } : {}),
    ...(extra?.photoAvailable !== undefined ? { photoAvailable: extra.photoAvailable } : {}),
    baseSalary: p.baseSalary,
    effectiveFrom: p.effectiveFrom,
    effectiveTo: p.effectiveTo ?? null,
    active: p.active,
    note: p.note ?? null,
    createdByUserId: p.createdByUserId ?? null,
    updatedByUserId: p.updatedByUserId ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * Add a new effective-dated base-salary record for an employee. The previous
 * open-ended profile (if any) is closed the day before the new effectiveFrom,
 * so history is preserved and never rewritten.
 */
export async function setSalaryProfile(
  actor: Pick<User, "id" | "role">,
  targetUserId: number,
  input: SetSalaryInput,
  meta: Meta = {},
): Promise<{ id: number }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!Number.isFinite(input.baseSalary) || input.baseSalary < 0) {
    throw new HttpError(400, "Base salary must be a number >= 0", "bad_amount");
  }
  if (!ymdRegex(input.effectiveFrom)) {
    throw new HttpError(400, "effectiveFrom must be YYYY-MM-DD", "bad_date");
  }
  const now = nowIST();
  const db = getDb();

  // close any earlier still-open profile at (effectiveFrom - 1 day)
  const priorOpen = await repo.listOpenSalaryProfilesBefore(targetUserId, input.effectiveFrom, db);
  for (const p of priorOpen) {
    await repo.updateSalaryProfile(
      p.id,
      { effectiveTo: addDays(input.effectiveFrom, -1), updatedByUserId: actor.id, updatedAt: now },
      db,
    );
  }

  const v: NewSalaryProfile = {
    userId: targetUserId,
    baseSalary: toAmount(input.baseSalary),
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    active: true,
    note: input.note?.trim().slice(0, 255) ?? null,
    createdByUserId: actor.id,
    updatedByUserId: actor.id,
    createdAt: now,
    updatedAt: now,
  };
  const id = await repo.insertSalaryProfile(v, db);

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "salary_profile.create",
    entityType: "salary_profile",
    entityId: id,
    metadata: {
      employee: targetUserId,
      baseSalary: v.baseSalary,
      effectiveFrom: v.effectiveFrom,
      closedPrior: priorOpen.map((p) => p.id),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { id };
}

export async function listSalaryProfiles(
  actor: Pick<User, "role">,
  filter: { employee?: string | undefined; process?: string | undefined },
): Promise<{ dbUnavailable?: boolean; rows: SalaryProfileDTO[] }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listSalaryProfiles(filter);
  return {
    rows: rows.map((r) =>
      profileDTO(r, {
        employeeName: r.employeeName,
        process: r.employeeProcess,
        employeeCode: r.employeeCode,
        employeeRole: r.employeeRole,
        photoAvailable: r.photoAvailable,
      }),
    ),
  };
}

/** Employee: their own current base-salary record (read-only). */
export async function mySalaryProfile(
  user: Pick<User, "id">,
  month: string,
): Promise<{ dbUnavailable?: boolean; baseSalary: string | null; effectiveFrom: string | null }> {
  if (!isDbConfigured()) return { dbUnavailable: true, baseSalary: null, effectiveFrom: null };
  const profiles = await repo.listSalaryProfilesForUser(user.id);
  const eff = pickEffectiveProfile(
    profiles.map((p) => ({
      id: p.id,
      baseSalary: p.baseSalary,
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo ?? null,
      active: p.active,
    })),
    monthRegex(month) ? month : new Date().toISOString().slice(0, 7),
  );
  return {
    baseSalary: eff ? String(eff.baseSalary) : null,
    effectiveFrom: eff?.effectiveFrom ?? null,
  };
}

/* ========================== payroll runs ======================= */

export interface PayrollDTO {
  payrollRunId?: number;
  userId?: number;
  employeeName?: string;
  /** current canonical Employee ID (agents.agent_code / closers.closer_code) */
  employeeCode?: string | null;
  photoAvailable?: boolean;
  month: string;
  process: string;
  status: PayrollStatus;
  /** full-month base (Phase-13 meaning of base_salary is preserved) */
  baseSalary: string;
  monthlyBaseSalary: string;
  payableBaseSalary: string;
  prorationBasis: string | null;
  prorationNumerator: number;
  prorationDenominator: number;
  regularityBonus: number;
  leaveCount: number;
  offCount: number;
  unpaidLeaveDays: number;
  unpaidLeaveDeduction: string;
  offDaysConsidered: number;
  offDeduction: string;
  approvedOvertimeMinutes: number;
  overtimeAmount: string;
  adjustmentsTotal: string;
  /* -- Admin UAT Batch-2 §5 — Late-Units -- */
  lateShortCount: number;
  lateFullCount: number;
  lateUnits: string;
  lateDeduction: string;
  /** gross before statutory deductions */
  calculatedSalary: string;
  calculationVersion: string;
  calculatedAt: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
  reopenReason: string | null;
}

function payrollDTO(
  r: PayrollRun,
  employeeName?: string,
  extra?: { employeeCode?: string | null; photoAvailable?: boolean; employeeProcess?: string },
): PayrollDTO {
  return {
    payrollRunId: r.id,
    userId: r.userId,
    ...(employeeName ? { employeeName } : {}),
    ...(extra?.employeeCode !== undefined ? { employeeCode: extra.employeeCode } : {}),
    ...(extra?.photoAvailable !== undefined ? { photoAvailable: extra.photoAvailable } : {}),
    month: r.periodMonth,
    // display the CURRENT authoritative process where we have it (list path);
    // the per-run snapshot remains the fallback for single-run reads.
    process: extra?.employeeProcess ?? r.process,
    status: r.status as PayrollStatus,
    baseSalary: r.baseSalary,
    monthlyBaseSalary: r.monthlyBaseSalary,
    payableBaseSalary: r.payableBaseSalary,
    prorationBasis: r.prorationBasis ?? null,
    prorationNumerator: r.prorationNumerator,
    prorationDenominator: r.prorationDenominator,
    regularityBonus: r.regularityBonus,
    leaveCount: r.leaveCount,
    offCount: r.offCount,
    unpaidLeaveDays: r.unpaidLeaveDays,
    unpaidLeaveDeduction: r.unpaidLeaveDeduction,
    offDaysConsidered: r.offDaysConsidered,
    offDeduction: r.offDeduction,
    approvedOvertimeMinutes: r.approvedOvertimeMinutes,
    overtimeAmount: r.overtimeAmount,
    adjustmentsTotal: r.adjustmentsTotal,
    lateShortCount: r.lateShortCount,
    lateFullCount: r.lateFullCount,
    lateUnits: r.lateUnits,
    lateDeduction: r.lateDeduction,
    calculatedSalary: r.calculatedSalary,
    calculationVersion: r.calculationVersion,
    calculatedAt: r.calculatedAt ?? null,
    approvedAt: r.approvedAt ?? null,
    lockedAt: r.lockedAt ?? null,
    reopenReason: r.reopenReason ?? null,
  };
}

/**
 * Gather every authoritative input for one employee+month and run the pure
 * breakdown engine — WITHOUT persisting a `payroll_runs` row or writing an
 * audit entry. This is the single source of the salary calculation: both
 * `calculatePayrollForEmployee` (persists) and the consolidated
 * Attendance+Payroll register (read-only preview) call it, so there is exactly
 * ONE calculation path. It calls the same canonical functions
 * (`pickEffectiveProfile`, `recomputeBonus`, Late-Units, `calculateMonthlyPayroll`)
 * in the same order as before.
 */
export interface PayrollComputeResult {
  calc: ReturnType<typeof calculateMonthlyPayroll>;
  process: string;
  effectiveProfileId: number | null;
  bonusRowId: number | null;
  /** raw monthly attendance counts feeding the calc (for the register) */
  attendance: {
    lateShort: number;
    late: number;
    lateUnits: number;
    approvedLeaveDays: number;
    activeOffDays: number;
    unpaidLeaveDays: number;
  };
}

export async function computePayrollBreakdown(
  targetUserId: number,
  month: string,
): Promise<PayrollComputeResult> {
  const db = getDb();
  const process = await processOf(targetUserId);

  // ---- effective-dated base salary (snapshot) ----
  const profiles = await repo.listSalaryProfilesForUser(targetUserId, db);
  const eff = pickEffectiveProfile(
    profiles.map((p) => ({
      id: p.id,
      baseSalary: p.baseSalary,
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo ?? null,
      active: p.active,
    })),
    month,
  );
  const baseSalaryNum = eff ? Number(eff.baseSalary) : 0;

  // ---- authoritative Phase-12 Regularity Bonus (consumed, not recomputed) ----
  const bonus = await recomputeBonus(targetUserId, process, month);
  const bonusRow = await hrRepo.getBonus(targetUserId, month, db);

  // ---- Phase-16 authoritative inputs (counts only; every monetary RATE is
  //      still an undefined business decision, so the deductions/OT/adjustment
  //      amounts passed to the engine below are ₹0 except HR-typed adjustments)
  const { from, to } = monthDayRange(month);
  const employmentPeriods = await inputsRepo.listEmploymentPeriodsForUser(targetUserId, db);
  const unpaidLeaveDays = await inputsRepo.countUnpaidLeaveDaysInMonth(targetUserId, from, to, db);

  // ---- Admin UAT Batch-2 §5 — Late-Units: monthly SHORT-LATE / LATE check-in
  //      counts → 1-day salary cut when the weighted units reach 3. Per-day
  //      value = base ÷ ACTUAL calendar days of `month`. Bonus voiding is
  //      already handled inside recomputeBonus (same threshold), so nothing
  //      extra is done to `bonus.bonusAmount` here.
  const lateness = await hrRepo.countCheckInLatenessInMonth(targetUserId, from, to, db);
  const lateCalc = computeLateDeduction({
    monthlyBaseSalary: baseSalaryNum,
    month,
    shortLateCount: lateness.shortLate,
    lateCount: lateness.late,
  });
  const approvedOvertimeMinutes = await inputsRepo.sumApprovedOvertimeMinutes(
    targetUserId,
    month,
    db,
  );
  const adjustmentsTotal = await inputsRepo.activeAdjustmentsTotal(targetUserId, month, db);

  // ---- pure breakdown engine ----
  const calc = calculateMonthlyPayroll({
    month,
    monthlyBaseSalary: baseSalaryNum,
    regularityBonus: bonus.bonusAmount,
    employmentPeriods: employmentPeriods.map((p) => ({
      startDate: p.startDate,
      endDate: p.endDate ?? null,
      active: p.active,
    })),
    prorationBasis: configuredProrationBasis(),
    approvedLeaveDays: bonus.leaveCount,
    unpaidLeaveDays,
    activeOffDays: bonus.offCount,
    approvedOvertimeMinutes,
    // undefined business rates → ₹0 (never invented here)
    unpaidLeaveDeduction: 0,
    offDeduction: 0,
    overtimeAmount: 0,
    adjustmentsTotal,
    // Admin UAT Batch-2 §5 — Late-Units (a defined rule, so a real amount)
    lateShortCount: lateCalc.shortLateCount,
    lateFullCount: lateCalc.lateCount,
    lateUnits: lateCalc.lateUnits,
    lateDeduction: lateCalc.lateDeductionAmount,
  });

  return {
    calc,
    process,
    effectiveProfileId: eff?.id ?? null,
    bonusRowId: bonusRow?.id ?? null,
    attendance: {
      lateShort: lateness.shortLate,
      late: lateness.late,
      lateUnits: lateCalc.lateUnits,
      approvedLeaveDays: bonus.leaveCount,
      activeOffDays: bonus.offCount,
      unpaidLeaveDays,
    },
  };
}

/**
 * Calculate (or recalculate) one employee's payroll for a calendar month.
 * Idempotent — unique (user, month); a DRAFT / CALCULATED run is updated in
 * place, an APPROVED / LOCKED run is refused (reopen first).
 */
export async function calculatePayrollForEmployee(
  actor: Pick<User, "id" | "role">,
  targetUserId: number,
  month: string,
  meta: Meta = {},
): Promise<{ ok: true; payroll: PayrollDTO }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!monthRegex(month)) throw new HttpError(400, "month must be YYYY-MM", "bad_month");
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");

  const db = getDb();
  const existing = await repo.getPayrollRun(targetUserId, month, db);
  if (existing) {
    assertPayrollTransition(existing.status as PayrollStatus, "calculate");
  }

  const computed = await computePayrollBreakdown(targetUserId, month);
  const { calc, process } = computed;
  const eff = { id: computed.effectiveProfileId };
  const bonusRow = { id: computed.bonusRowId };

  const now = nowIST();
  const snapshot = {
    process: process as PayrollRun["process"],
    status: "CALCULATED" as const,
    // base_salary keeps its Phase-13 meaning: the full-month base
    baseSalary: calc.monthlyBaseSalary,
    monthlyBaseSalary: calc.monthlyBaseSalary,
    payableBaseSalary: calc.payableBaseSalary,
    prorationBasis: calc.prorationBasis,
    prorationNumerator: calc.prorationNumerator,
    prorationDenominator: calc.prorationDenominator,
    regularityBonus: calc.regularityBonus,
    calculatedSalary: calc.calculatedSalary,
    leaveCount: calc.approvedLeaveDays,
    offCount: calc.activeOffDays,
    unpaidLeaveDays: calc.unpaidLeaveDays,
    unpaidLeaveDeduction: calc.unpaidLeaveDeduction,
    offDaysConsidered: calc.activeOffDays,
    offDeduction: calc.offDeduction,
    approvedOvertimeMinutes: calc.approvedOvertimeMinutes,
    overtimeAmount: calc.overtimeAmount,
    adjustmentsTotal: calc.adjustmentsTotal,
    lateShortCount: calc.lateShortCount,
    lateFullCount: calc.lateFullCount,
    lateUnits: calc.lateUnits.toFixed(1),
    lateDeduction: calc.lateDeduction,
    salaryProfileId: eff?.id ?? null,
    bonusRecordId: bonusRow?.id ?? null,
    calculationVersion: PAYROLL_CALC_VERSION_V2,
    calculatedByUserId: actor.id,
    calculatedAt: now,
    updatedAt: now,
  };

  const before = existing
    ? {
        status: existing.status,
        baseSalary: existing.baseSalary,
        payableBaseSalary: existing.payableBaseSalary,
        regularityBonus: existing.regularityBonus,
        calculatedSalary: existing.calculatedSalary,
        calculationVersion: existing.calculationVersion,
      }
    : null;

  if (existing) {
    await repo.updatePayrollRun(existing.id, snapshot, db);
  } else {
    const v: NewPayrollRun = {
      userId: targetUserId,
      periodMonth: month,
      ...snapshot,
      createdAt: now,
    };
    await repo.insertPayrollRun(v, db);
  }

  const saved = await repo.getPayrollRun(targetUserId, month, db);

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "payroll.calculate",
    entityType: "payroll_run",
    entityId: saved?.id ?? null,
    metadata: {
      employee: targetUserId,
      month,
      process,
      before,
      after: {
        status: snapshot.status,
        monthlyBaseSalary: snapshot.monthlyBaseSalary,
        payableBaseSalary: snapshot.payableBaseSalary,
        prorationBasis: snapshot.prorationBasis,
        prorationNumerator: snapshot.prorationNumerator,
        prorationDenominator: snapshot.prorationDenominator,
        regularityBonus: snapshot.regularityBonus,
        unpaidLeaveDays: snapshot.unpaidLeaveDays,
        unpaidLeaveDeduction: snapshot.unpaidLeaveDeduction,
        offDaysConsidered: snapshot.offDaysConsidered,
        offDeduction: snapshot.offDeduction,
        approvedOvertimeMinutes: snapshot.approvedOvertimeMinutes,
        overtimeAmount: snapshot.overtimeAmount,
        adjustmentsTotal: snapshot.adjustmentsTotal,
        lateShortCount: snapshot.lateShortCount,
        lateFullCount: snapshot.lateFullCount,
        lateUnits: snapshot.lateUnits,
        lateDeduction: snapshot.lateDeduction,
        calculatedSalary: snapshot.calculatedSalary,
      },
      salaryProfileId: snapshot.salaryProfileId,
      bonusRecordId: snapshot.bonusRecordId,
      version: PAYROLL_CALC_VERSION_V2,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { ok: true, payroll: payrollDTO(saved!) };
}

async function transition(
  actor: Pick<User, "id" | "role">,
  targetUserId: number,
  month: string,
  action: "approve" | "lock",
  meta: Meta,
): Promise<{ ok: true; payroll: PayrollDTO }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const run = await repo.getPayrollRun(targetUserId, month, db);
  if (!run) throw new HttpError(404, "No payroll run for that employee / month", "not_found");
  assertPayrollTransition(run.status as PayrollStatus, action);

  const now = nowIST();
  const patch =
    action === "approve"
      ? { status: "APPROVED" as const, approvedByUserId: actor.id, approvedAt: now, updatedAt: now }
      : { status: "LOCKED" as const, lockedByUserId: actor.id, lockedAt: now, updatedAt: now };
  await repo.updatePayrollRun(run.id, patch, db);

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: `payroll.${action}`,
    entityType: "payroll_run",
    entityId: run.id,
    metadata: {
      employee: targetUserId,
      month,
      before: { status: run.status },
      after: { status: patch.status },
      calculatedSalary: run.calculatedSalary,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  const saved = await repo.getPayrollRun(targetUserId, month, db);
  return { ok: true, payroll: payrollDTO(saved!) };
}

export function approvePayroll(
  actor: Pick<User, "id" | "role">,
  targetUserId: number,
  month: string,
  meta: Meta = {},
) {
  return transition(actor, targetUserId, month, "approve", meta);
}

export function lockPayroll(
  actor: Pick<User, "id" | "role">,
  targetUserId: number,
  month: string,
  meta: Meta = {},
) {
  return transition(actor, targetUserId, month, "lock", meta);
}

/**
 * The ONLY way an APPROVED / LOCKED run changes: an explicit authorized reopen.
 * Sets the run back to CALCULATED so it can be recalculated, and records who /
 * when / why. Never silently mutates a locked snapshot.
 */
export async function reopenPayroll(
  actor: Pick<User, "id" | "role">,
  targetUserId: number,
  month: string,
  reason: string,
  meta: Meta = {},
): Promise<{ ok: true; payroll: PayrollDTO }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new HttpError(400, "A reopen reason is required", "reason_required");
  }
  const db = getDb();
  const run = await repo.getPayrollRun(targetUserId, month, db);
  if (!run) throw new HttpError(404, "No payroll run for that employee / month", "not_found");
  assertPayrollTransition(run.status as PayrollStatus, "reopen");

  const now = nowIST();
  await repo.updatePayrollRun(
    run.id,
    {
      status: "CALCULATED",
      reopenedByUserId: actor.id,
      reopenedAt: now,
      reopenReason: trimmed.slice(0, 255),
      approvedByUserId: null,
      approvedAt: null,
      lockedByUserId: null,
      lockedAt: null,
      updatedAt: now,
    },
    db,
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "payroll.reopen",
    entityType: "payroll_run",
    entityId: run.id,
    metadata: {
      employee: targetUserId,
      month,
      before: { status: run.status },
      after: { status: "CALCULATED" },
      reason: trimmed.slice(0, 200),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  const saved = await repo.getPayrollRun(targetUserId, month, db);
  return { ok: true, payroll: payrollDTO(saved!) };
}

/* ----------------------------- reads -------------------------- */

export async function listPayroll(
  actor: Pick<User, "role">,
  f: repo.PayrollFilter,
): Promise<{ dbUnavailable?: boolean; rows: PayrollDTO[] }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listPayrollRuns(f);
  return {
    rows: rows.map((r) =>
      payrollDTO(r, r.employeeName, {
        employeeCode: r.employeeCode,
        photoAvailable: r.photoAvailable,
        employeeProcess: r.employeeProcess,
      }),
    ),
  };
}

/** Employee: their OWN payroll only. Never calculates — read-only. */
export async function myPayroll(
  user: Pick<User, "id">,
  month: string | undefined,
): Promise<{ dbUnavailable?: boolean; rows: PayrollDTO[] }> {
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = month
    ? await repo.listPayrollRunsForUser(user.id, month, month)
    : await repo.listPayrollRunsForUser(user.id);
  return { rows: rows.map((r) => payrollDTO(r)) };
}

/* ============== Phase 16 — payroll input foundations ============= */

/* ---- employment periods (join / exit dates) — Admin/HR ---- */

export interface EmploymentPeriodInput {
  startDate: string;
  endDate?: string | null | undefined;
  note?: string | undefined;
}

export async function setEmploymentPeriod(
  actor: Pick<User, "id" | "role">,
  targetUserId: number,
  input: EmploymentPeriodInput,
  meta: Meta = {},
): Promise<{ id: number }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!ymdRegex(input.startDate))
    throw new HttpError(400, "startDate must be YYYY-MM-DD", "bad_date");
  if (input.endDate != null && input.endDate !== "" && !ymdRegex(input.endDate)) {
    throw new HttpError(400, "endDate must be YYYY-MM-DD", "bad_date");
  }
  if (input.endDate && input.endDate < input.startDate) {
    throw new HttpError(400, "endDate is before startDate", "bad_range");
  }
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const now = nowIST();
  const id = await inputsRepo.insertEmploymentPeriod({
    userId: targetUserId,
    startDate: input.startDate,
    endDate: input.endDate && input.endDate !== "" ? input.endDate : null,
    active: true,
    note: input.note?.trim().slice(0, 255) ?? null,
    createdByUserId: actor.id,
    updatedByUserId: actor.id,
    createdAt: now,
    updatedAt: now,
  });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "employment_period.create",
    entityType: "employment_period",
    entityId: id,
    metadata: {
      employee: targetUserId,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { id };
}

export interface EmploymentPeriodDTO {
  id: number;
  startDate: string;
  endDate: string | null;
  active: boolean;
  note: string | null;
}

export async function listEmploymentPeriods(
  actor: Pick<User, "role">,
  targetUserId: number,
): Promise<{ dbUnavailable?: boolean; rows: EmploymentPeriodDTO[] }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await inputsRepo.listEmploymentPeriodsForUser(targetUserId);
  return {
    rows: rows.map((p) => ({
      id: p.id,
      startDate: p.startDate,
      endDate: p.endDate ?? null,
      active: p.active,
      note: p.note ?? null,
    })),
  };
}

/* ---- overtime records (FOUNDATION — no rate, amount is ₹0) ---- */

export interface OvertimeInput {
  userId: number;
  workDate: string;
  overtimeMinutes: number;
  scheduledShiftStart?: string | undefined;
  scheduledShiftEnd?: string | undefined;
  actualLogout?: string | undefined;
  reason?: string | undefined;
}

export async function recordOvertime(
  actor: Pick<User, "id" | "role">,
  input: OvertimeInput,
  meta: Meta = {},
): Promise<{ id: number }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!ymdRegex(input.workDate))
    throw new HttpError(400, "workDate must be YYYY-MM-DD", "bad_date");
  const minutes = Math.trunc(input.overtimeMinutes);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60) {
    throw new HttpError(400, "overtimeMinutes must be 0..1440", "bad_minutes");
  }
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const now = nowIST();
  const id = await inputsRepo.insertOvertimeRecord({
    userId: input.userId,
    workDate: input.workDate,
    periodMonth: input.workDate.slice(0, 7),
    scheduledShiftStart: input.scheduledShiftStart ?? null,
    scheduledShiftEnd: input.scheduledShiftEnd ?? null,
    actualLogout: input.actualLogout ?? null,
    overtimeMinutes: minutes,
    status: "PENDING",
    reason: input.reason?.trim().slice(0, 255) ?? null,
    createdByUserId: actor.id,
    createdAt: now,
    updatedAt: now,
  });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "overtime.record",
    entityType: "overtime_record",
    entityId: id,
    metadata: { employee: input.userId, workDate: input.workDate, minutes },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { id };
}

export async function decideOvertime(
  actor: Pick<User, "id" | "role">,
  overtimeId: number,
  decision: "APPROVED" | "REJECTED" | "VOID",
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const row = await inputsRepo.getOvertimeRecordById(overtimeId);
  if (!row) throw new HttpError(404, "Overtime record not found", "not_found");
  const now = nowIST();
  await inputsRepo.updateOvertimeRecord(overtimeId, {
    status: decision,
    ...(decision === "APPROVED"
      ? { approvedByUserId: actor.id, approvedAt: now }
      : { approvedByUserId: null, approvedAt: null }),
    updatedAt: now,
  });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "overtime.decision",
    entityType: "overtime_record",
    entityId: overtimeId,
    metadata: { employee: row.userId, decision, minutes: row.overtimeMinutes },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

function overtimeDTO(r: {
  id: number;
  userId: number;
  workDate: string;
  periodMonth: string;
  overtimeMinutes: number;
  status: string;
  reason: string | null;
  approvedAt: string | null;
}) {
  return {
    id: r.id,
    userId: r.userId,
    workDate: r.workDate,
    month: r.periodMonth,
    overtimeMinutes: r.overtimeMinutes,
    status: r.status,
    reason: r.reason ?? null,
    approvedAt: r.approvedAt ?? null,
    /** no overtime rate is configured — the amount is always ₹0 */
    overtimeAmount: "0.00",
  };
}

export async function listOvertime(
  actor: Pick<User, "role">,
  f: inputsRepo.OvertimeFilter,
): Promise<{ dbUnavailable?: boolean; rows: ReturnType<typeof overtimeDTO>[] }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await inputsRepo.listOvertimeRecords(f);
  return { rows: rows.map(overtimeDTO) };
}

export async function myOvertime(
  user: Pick<User, "id">,
  month: string | undefined,
): Promise<{ dbUnavailable?: boolean; rows: ReturnType<typeof overtimeDTO>[] }> {
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await inputsRepo.listOvertimeRecords({
    userId: user.id,
    ...(month ? { month } : {}),
  });
  return { rows: rows.map(overtimeDTO) };
}

/* ---- payroll adjustments (HR-typed amount + reason) ---- */

export interface AdjustmentInput {
  userId: number;
  month: string;
  kind: "EARNING" | "DEDUCTION";
  label: string;
  amount: number; // non-negative magnitude
  reason?: string | undefined;
}

export async function addPayrollAdjustment(
  actor: Pick<User, "id" | "role">,
  input: AdjustmentInput,
  meta: Meta = {},
): Promise<{ id: number }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!monthRegex(input.month)) throw new HttpError(400, "month must be YYYY-MM", "bad_month");
  if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > 100_000_000) {
    throw new HttpError(400, "amount must be a magnitude between 0 and 100,000,000", "bad_amount");
  }
  if (!input.label.trim()) throw new HttpError(400, "label is required", "bad_label");
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const now = nowIST();
  const id = await inputsRepo.insertPayrollAdjustment({
    userId: input.userId,
    periodMonth: input.month,
    kind: input.kind,
    label: input.label.trim().slice(0, 120),
    amount: toAmount(input.amount),
    status: "ACTIVE",
    reason: input.reason?.trim().slice(0, 255) ?? null,
    createdByUserId: actor.id,
    createdAt: now,
    updatedAt: now,
  });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "payroll_adjustment.create",
    entityType: "payroll_adjustment",
    entityId: id,
    metadata: {
      employee: input.userId,
      month: input.month,
      kind: input.kind,
      label: input.label.trim().slice(0, 120),
      amount: toAmount(input.amount),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { id };
}

export async function voidPayrollAdjustment(
  actor: Pick<User, "id" | "role">,
  adjustmentId: number,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const row = await inputsRepo.getPayrollAdjustmentById(adjustmentId);
  if (!row) throw new HttpError(404, "Adjustment not found", "not_found");
  const now = nowIST();
  await inputsRepo.updatePayrollAdjustment(adjustmentId, {
    status: "VOID",
    voidedByUserId: actor.id,
    updatedAt: now,
  });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "payroll_adjustment.void",
    entityType: "payroll_adjustment",
    entityId: adjustmentId,
    metadata: { employee: row.userId, month: row.periodMonth },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

function adjustmentDTO(a: {
  id: number;
  userId: number;
  periodMonth: string;
  kind: string;
  label: string;
  amount: string;
  status: string;
  reason: string | null;
}) {
  return {
    id: a.id,
    userId: a.userId,
    month: a.periodMonth,
    kind: a.kind,
    label: a.label,
    amount: a.amount,
    signedAmount: a.kind === "DEDUCTION" ? `-${a.amount}` : a.amount,
    status: a.status,
    reason: a.reason ?? null,
  };
}

/* ---- the "how was this salary calculated?" breakdown ---- */

export interface PayrollBreakdown {
  dbUnavailable?: boolean;
  payroll: PayrollDTO | null;
  adjustments: ReturnType<typeof adjustmentDTO>[];
  overtime: ReturnType<typeof overtimeDTO>[];
  roundingPolicy: string;
  notes: string[];
}

export async function payrollBreakdown(
  actor: Pick<User, "id" | "role">,
  targetUserId: number,
  month: string,
): Promise<PayrollBreakdown> {
  const isSelf = actor.id === targetUserId;
  if (!isSelf) assertCanManagePayroll(actor.role as HrRole);
  if (!monthRegex(month)) throw new HttpError(400, "month must be YYYY-MM", "bad_month");
  if (!isDbConfigured()) {
    return {
      dbUnavailable: true,
      payroll: null,
      adjustments: [],
      overtime: [],
      roundingPolicy: PAYROLL_ROUNDING_POLICY,
      notes: [],
    };
  }
  const run = await repo.getPayrollRun(targetUserId, month);
  const adjustments = (await inputsRepo.listPayrollAdjustments(targetUserId, month)).map(
    adjustmentDTO,
  );
  const overtime = (await inputsRepo.listOvertimeRecords({ userId: targetUserId, month })).map(
    overtimeDTO,
  );

  const notes: string[] = [];
  if (run && run.prorationBasis == null) {
    notes.push("Proration is not applied — the proration basis (denominator) is not configured.");
  }
  notes.push("Unpaid-leave deduction = ₹0: no per-day unpaid-leave rate is defined.");
  notes.push("Off deduction = ₹0: Late/Short → Off conversion is disabled (Admin UAT §5).");
  notes.push("Overtime amount = ₹0: no overtime rate is configured.");
  if (run) {
    notes.push(
      `Late Units = ${run.lateUnits} (${run.lateShortCount} Short Late × 1.0 + ${run.lateFullCount} Late × 1.5). ` +
        (Number(run.lateDeduction) > 0
          ? `≥ 3 → one day's salary cut of ₹${run.lateDeduction} (base ÷ actual calendar days of ${run.periodMonth}) and no ₹1,000 regularity bonus.`
          : "< 3 → no late-driven salary cut."),
    );
  }

  return {
    payroll: run ? payrollDTO(run) : null,
    adjustments,
    overtime,
    roundingPolicy: PAYROLL_ROUNDING_POLICY,
    notes,
  };
}
