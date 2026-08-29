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
  calculatePayroll,
  pickEffectiveProfile,
  PAYROLL_CALC_VERSION,
  type PayrollStatus,
} from "./payroll";
import { recomputeBonus } from "./service";
import * as repo from "../db/repos/payroll";
import * as hrRepo from "../db/repos/hr";
import type { NewPayrollRun, NewSalaryProfile, PayrollRun, User } from "@/lib/db/schema";

type Meta = { ip?: string | null; userAgent?: string | null };

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
  employeeName?: string;
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
  },
  extra?: { employeeName?: string; process?: string },
): SalaryProfileDTO {
  return {
    id: p.id,
    ...(extra?.employeeName ? { employeeName: extra.employeeName } : {}),
    ...(extra?.process ? { process: extra.process } : {}),
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
  filter: { employee?: string | undefined },
): Promise<{ dbUnavailable?: boolean; rows: SalaryProfileDTO[] }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listSalaryProfiles(filter);
  return {
    rows: rows.map((r) =>
      profileDTO(r, { employeeName: r.employeeName, process: r.employeeProcess }),
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
  month: string;
  process: string;
  status: PayrollStatus;
  baseSalary: string;
  regularityBonus: number;
  calculatedSalary: string;
  leaveCount: number;
  offCount: number;
  calculationVersion: string;
  calculatedAt: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
  reopenReason: string | null;
}

function payrollDTO(r: PayrollRun, employeeName?: string): PayrollDTO {
  return {
    payrollRunId: r.id,
    userId: r.userId,
    ...(employeeName ? { employeeName } : {}),
    month: r.periodMonth,
    process: r.process,
    status: r.status as PayrollStatus,
    baseSalary: r.baseSalary,
    regularityBonus: r.regularityBonus,
    calculatedSalary: r.calculatedSalary,
    leaveCount: r.leaveCount,
    offCount: r.offCount,
    calculationVersion: r.calculationVersion,
    calculatedAt: r.calculatedAt ?? null,
    approvedAt: r.approvedAt ?? null,
    lockedAt: r.lockedAt ?? null,
    reopenReason: r.reopenReason ?? null,
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

  // ---- pure money maths ----
  const calc = calculatePayroll({
    baseSalary: baseSalaryNum,
    regularityBonus: bonus.bonusAmount,
    leaveCount: bonus.leaveCount,
    offCount: bonus.offCount,
  });

  const now = nowIST();
  const snapshot = {
    process: process as PayrollRun["process"],
    status: "CALCULATED" as const,
    baseSalary: toAmount(calc.baseSalary),
    regularityBonus: calc.regularityBonus,
    calculatedSalary: toAmount(calc.calculatedSalary),
    leaveCount: calc.leaveCount,
    offCount: calc.offCount,
    salaryProfileId: eff?.id ?? null,
    bonusRecordId: bonusRow?.id ?? null,
    calculationVersion: PAYROLL_CALC_VERSION,
    calculatedByUserId: actor.id,
    calculatedAt: now,
    updatedAt: now,
  };

  const before = existing
    ? {
        status: existing.status,
        baseSalary: existing.baseSalary,
        regularityBonus: existing.regularityBonus,
        calculatedSalary: existing.calculatedSalary,
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
        baseSalary: snapshot.baseSalary,
        regularityBonus: snapshot.regularityBonus,
        calculatedSalary: snapshot.calculatedSalary,
        leaveCount: snapshot.leaveCount,
        offCount: snapshot.offCount,
      },
      salaryProfileId: snapshot.salaryProfileId,
      bonusRecordId: snapshot.bonusRecordId,
      version: PAYROLL_CALC_VERSION,
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
  return { rows: rows.map((r) => payrollDTO(r, r.employeeName)) };
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
