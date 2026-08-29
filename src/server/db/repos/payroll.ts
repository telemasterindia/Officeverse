/**
 * Officeverse — salary_profiles + payroll_runs repository (Phase 13).
 * DATA ACCESS ONLY. Authorization lives in ../../authz/hr.ts; the money maths
 * lives in ../../hr/payroll.ts (pure). Nothing here recomputes the regularity
 * bonus — that is the Phase-12 engine's job.
 */
import { and, asc, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  payrollRuns,
  salaryProfiles,
  users,
  type NewPayrollRun,
  type NewSalaryProfile,
  type PayrollRun,
  type SalaryProfile,
} from "@/lib/db/schema";

/* --------------------------- salary_profiles -------------------- */

export async function insertSalaryProfile(v: NewSalaryProfile, ex: DBX = getDb()): Promise<number> {
  const res = await ex.insert(salaryProfiles).values(v);
  return Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
}

export async function getSalaryProfileById(
  id: number,
  ex: DBX = getDb(),
): Promise<SalaryProfile | undefined> {
  const rows = await ex.select().from(salaryProfiles).where(eq(salaryProfiles.id, id)).limit(1);
  return rows[0];
}

export async function updateSalaryProfile(
  id: number,
  patch: Partial<NewSalaryProfile>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(salaryProfiles).set(patch).where(eq(salaryProfiles.id, id));
}

export async function listSalaryProfilesForUser(
  userId: number,
  ex: DBX = getDb(),
): Promise<SalaryProfile[]> {
  return ex
    .select()
    .from(salaryProfiles)
    .where(eq(salaryProfiles.userId, userId))
    .orderBy(desc(salaryProfiles.effectiveFrom))
    .limit(200);
}

/** open-ended profiles (effectiveTo IS NULL) that start strictly before a new
 *  effectiveFrom — used to auto-close the previous salary when a raise is added. */
export async function listOpenSalaryProfilesBefore(
  userId: number,
  beforeDate: string,
  ex: DBX = getDb(),
): Promise<SalaryProfile[]> {
  const rows = await ex
    .select()
    .from(salaryProfiles)
    .where(and(eq(salaryProfiles.userId, userId), lte(salaryProfiles.effectiveFrom, beforeDate)));
  return rows.filter((r) => r.effectiveTo == null && r.effectiveFrom < beforeDate);
}

export interface SalaryProfileListRow extends SalaryProfile {
  employeeName: string;
  employeeProcess: string;
}

export async function listSalaryProfiles(
  filter: { employee?: string | undefined },
  ex: DBX = getDb(),
): Promise<SalaryProfileListRow[]> {
  const rows = await ex
    .select({
      row: salaryProfiles,
      employeeName: users.fullName,
      employeeEmail: users.email,
      employeeProcess: users.process,
    })
    .from(salaryProfiles)
    .innerJoin(users, eq(users.id, salaryProfiles.userId))
    .orderBy(desc(salaryProfiles.effectiveFrom))
    .limit(1000);
  const q = filter.employee?.trim().toLowerCase();
  return rows
    .filter(
      (r) =>
        !q || r.employeeName.toLowerCase().includes(q) || r.employeeEmail.toLowerCase().includes(q),
    )
    .map((r) => ({
      ...r.row,
      employeeName: r.employeeName,
      employeeProcess: r.employeeProcess,
    }));
}

/* ---------------------------- payroll_runs --------------------- */

export async function getPayrollRun(
  userId: number,
  periodMonth: string,
  ex: DBX = getDb(),
): Promise<PayrollRun | undefined> {
  const rows = await ex
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.userId, userId), eq(payrollRuns.periodMonth, periodMonth)))
    .limit(1);
  return rows[0];
}

export async function insertPayrollRun(v: NewPayrollRun, ex: DBX = getDb()): Promise<number> {
  const res = await ex.insert(payrollRuns).values(v);
  return Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
}

export async function updatePayrollRun(
  id: number,
  patch: Partial<NewPayrollRun>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(payrollRuns).set(patch).where(eq(payrollRuns.id, id));
}

export interface PayrollFilter {
  month?: string | undefined;
  employee?: string | undefined;
  process?: string | undefined;
  status?: string | undefined;
}
export interface PayrollListRow extends PayrollRun {
  employeeName: string;
}

export async function listPayrollRuns(
  f: PayrollFilter,
  ex: DBX = getDb(),
): Promise<PayrollListRow[]> {
  const conds: SQL[] = [];
  if (f.month) conds.push(eq(payrollRuns.periodMonth, f.month));
  if (f.status) conds.push(eq(payrollRuns.status, f.status as never));
  if (f.process) conds.push(eq(payrollRuns.process, f.process as never));
  const rows = await ex
    .select({ row: payrollRuns, employeeName: users.fullName, employeeEmail: users.email })
    .from(payrollRuns)
    .innerJoin(users, eq(users.id, payrollRuns.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(payrollRuns.periodMonth), asc(users.fullName))
    .limit(3000);
  const q = f.employee?.trim().toLowerCase();
  return rows
    .filter(
      (r) =>
        !q || r.employeeName.toLowerCase().includes(q) || r.employeeEmail.toLowerCase().includes(q),
    )
    .map((r) => ({ ...r.row, employeeName: r.employeeName }));
}

export async function listPayrollRunsForUser(
  userId: number,
  from?: string,
  to?: string,
  ex: DBX = getDb(),
): Promise<PayrollRun[]> {
  const conds: SQL[] = [eq(payrollRuns.userId, userId)];
  if (from) conds.push(gte(payrollRuns.periodMonth, from));
  if (to) conds.push(lte(payrollRuns.periodMonth, to));
  return ex
    .select()
    .from(payrollRuns)
    .where(and(...conds))
    .orderBy(desc(payrollRuns.periodMonth))
    .limit(240);
}
