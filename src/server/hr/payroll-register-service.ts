/**
 * Officeverse — Monthly Attendance Register + Consolidated Payroll.
 *
 * A read-only, ALL-employees-at-once view over data that already exists:
 *   - the daily `attendance` rows (same rows payroll's Late-Units / bonus use)
 *   - the effective-dated base salary, Regularity Bonus and Late-Units engine
 *     via the SINGLE shared `computePayrollBreakdown` (no second calc system)
 *
 * Nothing here writes a `payroll_runs` row or an audit entry. When a persisted
 * run exists it is shown VERBATIM with its real status (so APPROVED / LOCKED
 * runs are never silently recalculated); when none exists a live DRAFT preview
 * is computed. Admin + HR only — the exact gate the rest of payroll uses.
 */
import { and, gte, inArray, lte } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { attendance, type User } from "@/lib/db/schema";
import { assertCanManagePayroll, type HrRole } from "../authz/hr";
import { HttpError } from "../http-error";
import { listStaffRows, type StaffRow } from "../db/repos/staff";
import * as repo from "../db/repos/payroll";
import { calculatePayrollForEmployee, computePayrollBreakdown } from "./payroll-service";

const MONTH_RE = /^\d{4}-\d{2}$/;

export interface RegisterFilters {
  month: string; // YYYY-MM
  process?: string | undefined; // US | UK | IN | AU
  q?: string | undefined; // name / email fragment
}

/** Actual calendar days of `month` — handles 28 / 29 / 30 / 31. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}
function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, "0")}` };
}

export type DayCode = "P" | "L" | "AB" | "HD" | "";

/**
 * Map ONE real `attendance` row to the register code. Derived only from the
 * stored classification — no fabricated values.
 *   AB — status ABSENT
 *   HD — status SHORT_ATTENDANCE, or the short-attendance flag
 *   L  — check-in classified LATE or SHORT (short-late)
 *   P  — a check-in exists and none of the above
 */
export function dayCode(row: {
  status: string;
  checkInStatus: string;
  shortAttendance: boolean;
  firstCheckInAt: string | null;
}): DayCode {
  if (row.status === "ABSENT") return "AB";
  if (row.status === "SHORT_ATTENDANCE" || row.shortAttendance) return "HD";
  if (row.checkInStatus === "LATE" || row.checkInStatus === "SHORT") return "L";
  if (row.firstCheckInAt || row.status === "ON_TIME" || row.status === "EARLY_DEPARTURE")
    return "P";
  return "";
}

/**
 * Fetch the month's real `attendance` rows for a set of users and map each to
 * its register code. The SINGLE source both the register grid and the
 * consolidated totals use, so present/late/half-day/absent always agree.
 */
async function dayCodesByUser(
  userIds: number[],
  from: string,
  to: string,
): Promise<Map<number, Map<number, DayCode>>> {
  const byUserDay = new Map<number, Map<number, DayCode>>();
  if (userIds.length === 0) return byUserDay;
  const att = await getDb()
    .select({
      userId: attendance.userId,
      operationalDate: attendance.operationalDate,
      status: attendance.status,
      checkInStatus: attendance.checkInStatus,
      shortAttendance: attendance.shortAttendance,
      firstCheckInAt: attendance.firstCheckInAt,
    })
    .from(attendance)
    .where(
      and(
        inArray(attendance.userId, userIds),
        gte(attendance.operationalDate, from),
        lte(attendance.operationalDate, to),
      ),
    );
  for (const r of att) {
    const day = Number(r.operationalDate.slice(8, 10));
    if (!byUserDay.has(r.userId)) byUserDay.set(r.userId, new Map());
    byUserDay.get(r.userId)!.set(day, dayCode(r));
  }
  return byUserDay;
}

function tally(dayMap: Map<number, DayCode> | undefined): {
  present: number;
  late: number;
  halfDay: number;
  absent: number;
} {
  const t = { present: 0, late: 0, halfDay: 0, absent: 0 };
  for (const c of (dayMap ?? new Map()).values()) {
    if (c === "P") t.present += 1;
    else if (c === "L") t.late += 1;
    else if (c === "HD") t.halfDay += 1;
    else if (c === "AB") t.absent += 1;
  }
  return t;
}

async function roster(f: RegisterFilters): Promise<StaffRow[]> {
  const opts = {
    activeOnly: true as const,
    ...(f.process ? { process: f.process } : {}),
    ...(f.q && f.q.trim() ? { q: f.q.trim() } : {}),
  };
  const [agents, closers] = await Promise.all([
    listStaffRows("agent", opts),
    listStaffRows("closer", opts),
  ]);
  return [...agents, ...closers].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/* ---------------------- monthly attendance register ---------------------- */

export interface AttendanceRegisterRow {
  userId: number;
  name: string;
  employeeCode: string; // canonical TMI_CC_### / TMI_CL_###
  role: "agent" | "closer";
  process: string; // authoritative users.process
  photoAvailable: boolean;
  /** day number (1..N) → code */
  days: Record<number, DayCode>;
  summary: {
    present: number;
    late: number;
    halfDay: number;
    absent: number;
    leave: number; // approved leave days in the month
    lateUnits: number; // Short×1.0 + Late×1.5
  };
}

export interface AttendanceRegister {
  dbUnavailable?: boolean;
  month: string;
  days: number;
  rows: AttendanceRegisterRow[];
}

export async function monthlyAttendanceRegister(
  actor: Pick<User, "id" | "role">,
  f: RegisterFilters,
): Promise<AttendanceRegister> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!MONTH_RE.test(f.month)) throw new HttpError(400, "month must be YYYY-MM", "bad_month");
  const nDays = daysInMonth(f.month);
  if (!isDbConfigured()) return { dbUnavailable: true, month: f.month, days: nDays, rows: [] };

  const staff = await roster(f);
  if (staff.length === 0) return { month: f.month, days: nDays, rows: [] };

  const { from, to } = monthRange(f.month);
  const byUserDay = await dayCodesByUser(
    staff.map((s) => s.userId),
    from,
    to,
  );

  const rows: AttendanceRegisterRow[] = [];
  for (const s of staff) {
    const dayMap = byUserDay.get(s.userId);
    const days: Record<number, DayCode> = {};
    for (let d = 1; d <= nDays; d++) days[d] = dayMap?.get(d) ?? "";
    const t = tally(dayMap);
    // leave + late-units come from the SAME canonical engine payroll uses
    const cb = await computePayrollBreakdown(s.userId, f.month);
    rows.push({
      userId: s.userId,
      name: s.fullName,
      employeeCode: s.code,
      role: s.kind,
      process: s.process,
      photoAvailable: s.photoAvailable,
      days,
      summary: {
        present: t.present,
        late: t.late,
        halfDay: t.halfDay,
        absent: t.absent,
        leave: cb.attendance.approvedLeaveDays,
        lateUnits: cb.attendance.lateUnits,
      },
    });
  }
  return { month: f.month, days: nDays, rows };
}

/* ----------------------- consolidated payroll table ---------------------- */

export type PayrollStatusValue = "DRAFT" | "CALCULATED" | "APPROVED" | "LOCKED";

export interface ConsolidatedPayrollRow {
  userId: number;
  name: string;
  employeeCode: string;
  role: "agent" | "closer";
  process: string;
  photoAvailable: boolean;
  baseSalary: string;
  presentDays: number;
  halfDays: number;
  lateCount: number; // check-ins classified late/short-late
  lateUnits: string;
  absentDays: number;
  leaveCount: number;
  leaveDeduction: string; // unpaid-leave deduction (₹0 until a rate is defined)
  regularityBonus: number;
  lateDeduction: string;
  offDeduction: string;
  adjustmentsTotal: string;
  overtimeAmount: string;
  finalCalculatedSalary: string;
  payrollStatus: PayrollStatusValue;
  /** true = a stored payroll_runs row (shown verbatim); false = live preview */
  persisted: boolean;
}

export interface ConsolidatedPayroll {
  dbUnavailable?: boolean;
  month: string;
  rows: ConsolidatedPayrollRow[];
}

export async function consolidatedPayroll(
  actor: Pick<User, "id" | "role">,
  f: RegisterFilters,
): Promise<ConsolidatedPayroll> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!MONTH_RE.test(f.month)) throw new HttpError(400, "month must be YYYY-MM", "bad_month");
  if (!isDbConfigured()) return { dbUnavailable: true, month: f.month, rows: [] };

  const staff = await roster(f);
  if (staff.length === 0) return { month: f.month, rows: [] };

  const { from, to } = monthRange(f.month);
  const byUserDay = await dayCodesByUser(
    staff.map((s) => s.userId),
    from,
    to,
  );

  const rows: ConsolidatedPayrollRow[] = [];
  for (const s of staff) {
    const run = await repo.getPayrollRun(s.userId, f.month);
    const c = tally(byUserDay.get(s.userId));
    const identity = {
      userId: s.userId,
      name: s.fullName,
      employeeCode: s.code,
      role: s.kind,
      process: s.process,
      photoAvailable: s.photoAvailable,
    };

    if (run) {
      // persisted — shown verbatim, NEVER recomputed (respects APPROVED / LOCKED)
      rows.push({
        ...identity,
        baseSalary: run.monthlyBaseSalary,
        presentDays: c.present,
        halfDays: c.halfDay,
        lateCount: c.late,
        lateUnits: run.lateUnits,
        absentDays: c.absent,
        leaveCount: run.leaveCount,
        leaveDeduction: run.unpaidLeaveDeduction,
        regularityBonus: run.regularityBonus,
        lateDeduction: run.lateDeduction,
        offDeduction: run.offDeduction,
        adjustmentsTotal: run.adjustmentsTotal,
        overtimeAmount: run.overtimeAmount,
        finalCalculatedSalary: run.calculatedSalary,
        payrollStatus: run.status as PayrollStatusValue,
        persisted: true,
      });
      continue;
    }

    // no stored run → live DRAFT preview via the single shared engine
    const cb = await computePayrollBreakdown(s.userId, f.month);
    rows.push({
      ...identity,
      baseSalary: cb.calc.monthlyBaseSalary,
      presentDays: c.present,
      halfDays: c.halfDay,
      lateCount: c.late,
      lateUnits: cb.calc.lateUnits.toFixed(1),
      absentDays: c.absent,
      leaveCount: cb.calc.approvedLeaveDays,
      leaveDeduction: cb.calc.unpaidLeaveDeduction,
      regularityBonus: cb.calc.regularityBonus,
      lateDeduction: cb.calc.lateDeduction,
      offDeduction: cb.calc.offDeduction,
      adjustmentsTotal: cb.calc.adjustmentsTotal,
      overtimeAmount: cb.calc.overtimeAmount,
      finalCalculatedSalary: cb.calc.calculatedSalary,
      payrollStatus: "DRAFT",
      persisted: false,
    });
  }
  return { month: f.month, rows };
}

/* ------------------- calculate & persist for everyone ------------------- */

export interface CalculateAllResult {
  ok: true;
  month: string;
  calculated: number;
  skipped: number; // APPROVED / LOCKED — left untouched
  failed: number;
}

/**
 * Run the EXISTING per-employee calculation + persist for every rostered
 * employee whose run is not APPROVED / LOCKED. Reuses
 * `calculatePayrollForEmployee` verbatim — no new rules, one audit row each.
 */
export async function calculateAllPayroll(
  actor: Pick<User, "id" | "role">,
  f: RegisterFilters,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<CalculateAllResult> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!MONTH_RE.test(f.month)) throw new HttpError(400, "month must be YYYY-MM", "bad_month");
  const staff = await roster(f);
  let calculated = 0;
  let skipped = 0;
  let failed = 0;
  for (const s of staff) {
    const run = await repo.getPayrollRun(s.userId, f.month);
    if (run && (run.status === "APPROVED" || run.status === "LOCKED")) {
      skipped += 1; // never silently recalculated
      continue;
    }
    try {
      await calculatePayrollForEmployee(actor, s.userId, f.month, meta);
      calculated += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok: true, month: f.month, calculated, skipped, failed };
}
