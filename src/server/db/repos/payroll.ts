/**
 * Officeverse — salary_profiles + payroll_runs repository (Phase 13).
 * DATA ACCESS ONLY. Authorization lives in ../../authz/hr.ts; the money maths
 * lives in ../../hr/payroll.ts (pure). Nothing here recomputes the regularity
 * bonus — that is the Phase-12 engine's job.
 */
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  agents,
  closers,
  payrollRuns,
  salaryProfiles,
  users,
  type NewPayrollRun,
  type NewSalaryProfile,
  type PayrollRun,
  type SalaryProfile,
} from "@/lib/db/schema";

/** current canonical Employee ID (agents.agent_code / closers.closer_code) */
const EMPLOYEE_CODE_SQL = sql<string | null>`coalesce(${agents.agentCode}, ${closers.closerCode})`;

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
  employeeCode: string | null;
  employeeRole: string;
  photoAvailable: boolean;
}

export async function listSalaryProfiles(
  filter: { employee?: string | undefined; process?: string | undefined },
  ex: DBX = getDb(),
): Promise<SalaryProfileListRow[]> {
  // Authoritative process is `users.process` (never a snapshot / shift text).
  const conds: SQL[] = [];
  if (filter.process) conds.push(eq(users.process, filter.process as never));
  const rows = await ex
    .select({
      row: salaryProfiles,
      employeeName: users.fullName,
      employeeEmail: users.email,
      employeeProcess: users.process,
      employeeRole: users.role,
      photoAssetId: users.photoAssetId,
      employeeCode: EMPLOYEE_CODE_SQL,
    })
    .from(salaryProfiles)
    .innerJoin(users, eq(users.id, salaryProfiles.userId))
    .leftJoin(agents, eq(agents.userId, users.id))
    .leftJoin(closers, eq(closers.userId, users.id))
    .where(conds.length ? and(...conds) : undefined)
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
      employeeCode: r.employeeCode ?? null,
      employeeRole: r.employeeRole,
      photoAvailable: r.photoAssetId != null,
    }));
}

/* ---------------------------- payroll_runs --------------------- */

export async function getPayrollRunById(
  id: number,
  ex: DBX = getDb(),
): Promise<PayrollRun | undefined> {
  const rows = await ex.select().from(payrollRuns).where(eq(payrollRuns.id, id)).limit(1);
  return rows[0];
}

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
  employeeProcess: string;
  employeeCode: string | null;
  photoAvailable: boolean;
}

export async function listPayrollRuns(
  f: PayrollFilter,
  ex: DBX = getDb(),
): Promise<PayrollListRow[]> {
  const conds: SQL[] = [];
  if (f.month) conds.push(eq(payrollRuns.periodMonth, f.month));
  if (f.status) conds.push(eq(payrollRuns.status, f.status as never));
  // Authoritative process filter — the employee's CURRENT `users.process`, not
  // the per-run snapshot column.
  if (f.process) conds.push(eq(users.process, f.process as never));
  const rows = await ex
    .select({
      row: payrollRuns,
      employeeName: users.fullName,
      employeeEmail: users.email,
      employeeProcess: users.process,
      photoAssetId: users.photoAssetId,
      employeeCode: EMPLOYEE_CODE_SQL,
    })
    .from(payrollRuns)
    .innerJoin(users, eq(users.id, payrollRuns.userId))
    .leftJoin(agents, eq(agents.userId, users.id))
    .leftJoin(closers, eq(closers.userId, users.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(payrollRuns.periodMonth), asc(users.fullName))
    .limit(3000);
  const q = f.employee?.trim().toLowerCase();
  return rows
    .filter(
      (r) =>
        !q || r.employeeName.toLowerCase().includes(q) || r.employeeEmail.toLowerCase().includes(q),
    )
    .map((r) => ({
      ...r.row,
      employeeName: r.employeeName,
      employeeProcess: r.employeeProcess,
      employeeCode: r.employeeCode ?? null,
      photoAvailable: r.photoAssetId != null,
    }));
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
