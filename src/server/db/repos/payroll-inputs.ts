/**
 * Officeverse — Phase 16 payroll-input repositories.
 * DATA ACCESS ONLY: employment_periods, overtime_records, payroll_adjustments,
 * and the unpaid-leave-day count. Authorization lives in ../../authz/hr.ts.
 */
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  employmentPeriods,
  leaveDays,
  leaveRequests,
  overtimeRecords,
  payrollAdjustments,
  type EmploymentPeriod,
  type NewEmploymentPeriod,
  type NewOvertimeRecord,
  type NewPayrollAdjustment,
  type OvertimeRecord,
  type PayrollAdjustment,
} from "@/lib/db/schema";

/* ------------------------- employment_periods ------------------ */

export async function insertEmploymentPeriod(
  v: NewEmploymentPeriod,
  ex: DBX = getDb(),
): Promise<number> {
  const res = await ex.insert(employmentPeriods).values(v);
  return Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
}

export async function updateEmploymentPeriod(
  id: number,
  patch: Partial<NewEmploymentPeriod>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(employmentPeriods).set(patch).where(eq(employmentPeriods.id, id));
}

export async function listEmploymentPeriodsForUser(
  userId: number,
  ex: DBX = getDb(),
): Promise<EmploymentPeriod[]> {
  return ex
    .select()
    .from(employmentPeriods)
    .where(eq(employmentPeriods.userId, userId))
    .orderBy(desc(employmentPeriods.startDate))
    .limit(100);
}

export async function getEmploymentPeriodById(
  id: number,
  ex: DBX = getDb(),
): Promise<EmploymentPeriod | undefined> {
  const rows = await ex
    .select()
    .from(employmentPeriods)
    .where(eq(employmentPeriods.id, id))
    .limit(1);
  return rows[0];
}

/* ---------------------------- unpaid leave --------------------- */

/** distinct leave_days in [from,to] whose parent leave_request is APPROVED and
 *  flagged unpaid. */
export async function countUnpaidLeaveDaysInMonth(
  userId: number,
  from: string,
  to: string,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`count(distinct ${leaveDays.leaveDate})` })
    .from(leaveDays)
    .innerJoin(leaveRequests, eq(leaveRequests.id, leaveDays.leaveRequestId))
    .where(
      and(
        eq(leaveDays.userId, userId),
        gte(leaveDays.leaveDate, from),
        lte(leaveDays.leaveDate, to),
        eq(leaveRequests.status, "APPROVED"),
        eq(leaveRequests.unpaid, true),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

/* --------------------------- overtime_records ------------------ */

export async function insertOvertimeRecord(
  v: NewOvertimeRecord,
  ex: DBX = getDb(),
): Promise<number> {
  const res = await ex.insert(overtimeRecords).values(v);
  return Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
}

export async function updateOvertimeRecord(
  id: number,
  patch: Partial<NewOvertimeRecord>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(overtimeRecords).set(patch).where(eq(overtimeRecords.id, id));
}

export async function getOvertimeRecordById(
  id: number,
  ex: DBX = getDb(),
): Promise<OvertimeRecord | undefined> {
  const rows = await ex.select().from(overtimeRecords).where(eq(overtimeRecords.id, id)).limit(1);
  return rows[0];
}

export interface OvertimeFilter {
  month?: string | undefined;
  status?: string | undefined;
  userId?: number | undefined;
}
export async function listOvertimeRecords(
  f: OvertimeFilter,
  ex: DBX = getDb(),
): Promise<OvertimeRecord[]> {
  const conds: SQL[] = [];
  if (f.month) conds.push(eq(overtimeRecords.periodMonth, f.month));
  if (f.status) conds.push(eq(overtimeRecords.status, f.status as never));
  if (f.userId != null) conds.push(eq(overtimeRecords.userId, f.userId));
  return ex
    .select()
    .from(overtimeRecords)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(overtimeRecords.workDate))
    .limit(2000);
}

/** total APPROVED overtime minutes for one user + month. */
export async function sumApprovedOvertimeMinutes(
  userId: number,
  periodMonth: string,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`coalesce(sum(${overtimeRecords.overtimeMinutes}), 0)` })
    .from(overtimeRecords)
    .where(
      and(
        eq(overtimeRecords.userId, userId),
        eq(overtimeRecords.periodMonth, periodMonth),
        eq(overtimeRecords.status, "APPROVED"),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

/* ------------------------- payroll_adjustments ---------------- */

export async function insertPayrollAdjustment(
  v: NewPayrollAdjustment,
  ex: DBX = getDb(),
): Promise<number> {
  const res = await ex.insert(payrollAdjustments).values(v);
  return Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
}

export async function updatePayrollAdjustment(
  id: number,
  patch: Partial<NewPayrollAdjustment>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(payrollAdjustments).set(patch).where(eq(payrollAdjustments.id, id));
}

export async function getPayrollAdjustmentById(
  id: number,
  ex: DBX = getDb(),
): Promise<PayrollAdjustment | undefined> {
  const rows = await ex
    .select()
    .from(payrollAdjustments)
    .where(eq(payrollAdjustments.id, id))
    .limit(1);
  return rows[0];
}

export async function listPayrollAdjustments(
  userId: number,
  periodMonth: string,
  ex: DBX = getDb(),
): Promise<PayrollAdjustment[]> {
  return ex
    .select()
    .from(payrollAdjustments)
    .where(
      and(eq(payrollAdjustments.userId, userId), eq(payrollAdjustments.periodMonth, periodMonth)),
    )
    .orderBy(desc(payrollAdjustments.id))
    .limit(500);
}

/** signed rupee total of ACTIVE adjustments (EARNING +, DEDUCTION −). */
export async function activeAdjustmentsTotal(
  userId: number,
  periodMonth: string,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await listPayrollAdjustments(userId, periodMonth, ex);
  let total = 0;
  for (const a of rows) {
    if (a.status !== "ACTIVE") continue;
    const mag = Math.abs(Number(a.amount) || 0);
    total += a.kind === "DEDUCTION" ? -mag : mag;
  }
  return Math.round(total * 100) / 100;
}
