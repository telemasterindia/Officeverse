/**
 * Officeverse — salary_slips + salary_slip_sends repository (Phase 14).
 * DATA ACCESS ONLY. Authorization lives in ../../authz/hr.ts; the document
 * bytes + rules live in ../../hr/salary-slip*.ts (pure). Nothing here
 * recalculates salary — a slip is a frozen view of a payroll_run.
 */
import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  salarySlipSends,
  salarySlips,
  users,
  type NewSalarySlip,
  type NewSalarySlipSend,
  type SalarySlip,
  type SalarySlipSend,
} from "@/lib/db/schema";

/* ----------------------------- salary_slips -------------------- */

export async function insertSalarySlip(v: NewSalarySlip, ex: DBX = getDb()): Promise<number> {
  const res = await ex.insert(salarySlips).values(v);
  return Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
}

export async function updateSalarySlip(
  id: number,
  patch: Partial<NewSalarySlip>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(salarySlips).set(patch).where(eq(salarySlips.id, id));
}

export async function getSalarySlipById(
  id: number,
  ex: DBX = getDb(),
): Promise<SalarySlip | undefined> {
  const rows = await ex.select().from(salarySlips).where(eq(salarySlips.id, id)).limit(1);
  return rows[0];
}

/** every slip version for a payroll run, newest version first */
export async function listSalarySlipsForRun(
  payrollRunId: number,
  ex: DBX = getDb(),
): Promise<SalarySlip[]> {
  return ex
    .select()
    .from(salarySlips)
    .where(eq(salarySlips.payrollRunId, payrollRunId))
    .orderBy(desc(salarySlips.version))
    .limit(50);
}

export async function latestSalarySlipForRun(
  payrollRunId: number,
  ex: DBX = getDb(),
): Promise<SalarySlip | undefined> {
  const rows = await listSalarySlipsForRun(payrollRunId, ex);
  return rows[0];
}

export interface SalarySlipFilter {
  month?: string | undefined;
  employee?: string | undefined;
  status?: string | undefined;
}
export interface SalarySlipListRow extends SalarySlip {
  employeeNameResolved: string;
}

export async function listSalarySlips(
  f: SalarySlipFilter,
  ex: DBX = getDb(),
): Promise<SalarySlipListRow[]> {
  const conds: SQL[] = [];
  if (f.month) conds.push(eq(salarySlips.periodMonth, f.month));
  if (f.status) conds.push(eq(salarySlips.status, f.status as never));
  const rows = await ex
    .select({ row: salarySlips, name: users.fullName, email: users.email })
    .from(salarySlips)
    .innerJoin(users, eq(users.id, salarySlips.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(salarySlips.periodMonth), desc(salarySlips.id))
    .limit(3000);
  const q = f.employee?.trim().toLowerCase();
  return rows
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
    .map((r) => ({ ...r.row, employeeNameResolved: r.name }));
}

export async function listSalarySlipsForUser(
  userId: number,
  from?: string,
  to?: string,
  ex: DBX = getDb(),
): Promise<SalarySlip[]> {
  const conds: SQL[] = [eq(salarySlips.userId, userId)];
  if (from) conds.push(gte(salarySlips.periodMonth, from));
  if (to) conds.push(lte(salarySlips.periodMonth, to));
  return ex
    .select()
    .from(salarySlips)
    .where(and(...conds))
    .orderBy(desc(salarySlips.periodMonth), desc(salarySlips.version))
    .limit(240);
}

/* -------------------------- salary_slip_sends ------------------ */

export async function insertSalarySlipSend(
  v: NewSalarySlipSend,
  ex: DBX = getDb(),
): Promise<number> {
  const res = await ex.insert(salarySlipSends).values(v);
  return Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
}

export async function listSalarySlipSends(
  salarySlipId: number,
  ex: DBX = getDb(),
): Promise<SalarySlipSend[]> {
  return ex
    .select()
    .from(salarySlipSends)
    .where(eq(salarySlipSends.salarySlipId, salarySlipId))
    .orderBy(desc(salarySlipSends.id))
    .limit(100);
}
