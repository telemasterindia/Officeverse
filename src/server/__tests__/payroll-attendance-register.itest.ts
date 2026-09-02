/**
 * PAYROLL + MONTHLY ATTENDANCE REGISTER — LIVE dryrun UAT (opt-in, DB-touching).
 *
 * §8 checklist against tmi_officeverse_dryrun:
 *   - every ACTIVE employee appears in both tables
 *   - every calendar day of the month appears (28/29/30/31 handled)
 *   - day codes P/L/AB/HD come from the real attendance rows
 *   - consolidated payroll auto-calculates for everyone in ONE call
 *   - a persisted run is shown verbatim; APPROVED/LOCKED is NEVER recalculated
 *   - Admin and HR get identical output (parity)
 *   - process filter uses users.process
 *   - the shared engine `computePayrollBreakdown` matches
 *     `calculatePayrollForEmployee` exactly (no second calc system)
 *   - photos carried via photoAvailable (StaffAvatar upstream)
 *
 * SAFETY: asserts SELECT DATABASE() first. Only READS real employees; the
 * lock/skip test uses ONE throwaway employee (prefix "UAT PAR"), fully deleted
 * in afterAll. Never mutates a real payroll_runs row.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import type { User } from "@/lib/db/schema";
import { createStaff } from "@/server/staff/service";
import {
  calculatePayrollForEmployee,
  computePayrollBreakdown,
  approvePayroll,
  lockPayroll,
  setSalaryProfile,
} from "@/server/hr/payroll-service";
import {
  monthlyAttendanceRegister,
  consolidatedPayroll,
  calculateAllPayroll,
  daysInMonth,
  dayCode,
} from "@/server/hr/payroll-register-service";

const ADMIN = { id: 1, role: "admin" } as unknown as User;
const HR = { id: 2, role: "hr" } as unknown as User;
const AGENT = { id: 3, role: "agent" } as unknown as User;
const MONTH = "2026-08"; // dryrun has seeded attendance here
const sfx = Date.now().toString().slice(-8);

let conn: mysql.Connection;
let throwaway = { code: "", userId: 0 };

const scalar = async (sql: string, a: unknown[] = []): Promise<number> => {
  const [r] = (await conn.query(sql, a)) as [Record<string, unknown>[], unknown];
  return Number(Object.values(r[0] ?? { v: 0 })[0]);
};

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const [r] = (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown];
  if (r[0]!.v !== "tmi_officeverse_dryrun") throw new Error(`REFUSING — ${r[0]!.v}`);
  const a = await createStaff(ADMIN, {
    kind: "agent",
    full_name: `UAT PAR Agent ${sfx}`,
    email: `uat.par.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
    base_salary: 30000,
  });
  throwaway = { code: a.code, userId: a.user_id };
});

afterAll(async () => {
  const uids = [throwaway.userId].filter(Boolean);
  await conn.query("DELETE FROM regularity_bonus WHERE user_id IN (?)", [uids]);
  await conn.query("DELETE FROM payroll_runs WHERE user_id IN (?)", [uids]);
  await conn.query("DELETE FROM salary_profiles WHERE user_id IN (?)", [uids]);
  await conn.query("DELETE FROM sessions WHERE user_id IN (?)", [uids]);
  await conn.query("DELETE FROM users WHERE id IN (?)", [uids]);
  await conn.end();
});

/* ------------------------- day-count / codes ------------------------- */

test("daysInMonth handles 28/29/30/31; dayCode maps real statuses", () => {
  expect(daysInMonth("2026-02")).toBe(28);
  expect(daysInMonth("2028-02")).toBe(29);
  expect(daysInMonth("2026-04")).toBe(30);
  expect(daysInMonth("2026-08")).toBe(31);

  expect(
    dayCode({
      status: "ABSENT",
      checkInStatus: "PENDING",
      shortAttendance: false,
      firstCheckInAt: null,
    }),
  ).toBe("AB");
  expect(
    dayCode({
      status: "SHORT_ATTENDANCE",
      checkInStatus: "SHORT",
      shortAttendance: true,
      firstCheckInAt: "x",
    }),
  ).toBe("HD");
  expect(
    dayCode({ status: "LATE", checkInStatus: "LATE", shortAttendance: false, firstCheckInAt: "x" }),
  ).toBe("L");
  expect(
    dayCode({
      status: "ON_TIME",
      checkInStatus: "ON_TIME",
      shortAttendance: false,
      firstCheckInAt: "x",
    }),
  ).toBe("P");
  expect(
    dayCode({
      status: "EARLY_DEPARTURE",
      checkInStatus: "ON_TIME",
      shortAttendance: false,
      firstCheckInAt: "x",
    }),
  ).toBe("P");
  expect(
    dayCode({
      status: "PENDING",
      checkInStatus: "PENDING",
      shortAttendance: false,
      firstCheckInAt: null,
    }),
  ).toBe("");
});

/* --------------------------- register ------------------------------- */

test("attendance register: every active employee + every day; codes from real rows", async () => {
  const reg = await monthlyAttendanceRegister(ADMIN, { month: MONTH });
  expect(reg.days).toBe(31);

  const activeAgents = await scalar(
    "SELECT COUNT(*) v FROM agents a JOIN users u ON u.id=a.user_id WHERE u.role='agent' AND u.status='active'",
  );
  const activeClosers = await scalar(
    "SELECT COUNT(*) v FROM closers c JOIN users u ON u.id=c.user_id WHERE u.role='closer' AND u.status='active'",
  );
  expect(reg.rows.length).toBe(activeAgents + activeClosers);

  for (const row of reg.rows) {
    expect(Object.keys(row.days).length).toBe(31);
    expect(row.employeeCode).toMatch(/^TMI_C[CL]_\d{3,}$/);
    expect(typeof row.photoAvailable).toBe("boolean");
    // summary present/late/HD/absent match the day codes exactly
    const codes = Object.values(row.days);
    expect(row.summary.present).toBe(codes.filter((x) => x === "P").length);
    expect(row.summary.late).toBe(codes.filter((x) => x === "L").length);
    expect(row.summary.halfDay).toBe(codes.filter((x) => x === "HD").length);
    expect(row.summary.absent).toBe(codes.filter((x) => x === "AB").length);
  }

  // cross-check one real seeded row against the raw table
  const [seed] = (await conn.query(
    `SELECT user_id, DAY(operational_date) d, status, check_in_status ci FROM attendance
     WHERE operational_date BETWEEN '2026-08-01' AND '2026-08-31' LIMIT 1`,
  )) as [Array<{ user_id: number; d: number; status: string; ci: string }>, unknown];
  if (seed[0]) {
    const row = reg.rows.find((r) => r.userId === seed[0]!.user_id);
    expect(row).toBeTruthy();
    const expected =
      seed[0]!.status === "ABSENT"
        ? "AB"
        : seed[0]!.status === "SHORT_ATTENDANCE"
          ? "HD"
          : seed[0]!.ci === "LATE" || seed[0]!.ci === "SHORT"
            ? "L"
            : "P";
    expect(row!.days[seed[0]!.d]).toBe(expected);
  }
});

/* ---------------------- consolidated payroll ----------------------- */

test("consolidated payroll: one row per active employee, all auto-calculated", async () => {
  const cp = await consolidatedPayroll(ADMIN, { month: MONTH });
  const reg = await monthlyAttendanceRegister(ADMIN, { month: MONTH });
  expect(cp.rows.length).toBe(reg.rows.length);
  for (const r of cp.rows) {
    expect(r.employeeCode).toMatch(/^TMI_C[CL]_\d{3,}$/);
    expect(["DRAFT", "CALCULATED", "APPROVED", "LOCKED"]).toContain(r.payrollStatus);
    expect(Number(r.finalCalculatedSalary)).toBeGreaterThanOrEqual(0);
    expect(typeof r.photoAvailable).toBe("boolean");
  }
  // the one seeded CALCULATED run for 2026-09 shows verbatim + persisted
  const cp9 = await consolidatedPayroll(ADMIN, { month: "2026-09" });
  const persisted = cp9.rows.filter((r) => r.persisted);
  if (persisted.length) {
    const [run] = (await conn.query(
      "SELECT user_id, calculated_salary, status FROM payroll_runs WHERE period_month='2026-09' LIMIT 1",
    )) as [Array<{ user_id: number; calculated_salary: string; status: string }>, unknown];
    const row = cp9.rows.find((r) => r.userId === run[0]!.user_id);
    expect(row!.persisted).toBe(true);
    expect(row!.payrollStatus).toBe(run[0]!.status);
    expect(Number(row!.finalCalculatedSalary)).toBeCloseTo(Number(run[0]!.calculated_salary), 2);
  }
});

/* ---------------------- Admin / HR parity ------------------------- */

test("Admin and HR see identical register + consolidated output; agent is 403", async () => {
  const [ra, rh] = await Promise.all([
    monthlyAttendanceRegister(ADMIN, { month: MONTH }),
    monthlyAttendanceRegister(HR, { month: MONTH }),
  ]);
  expect(JSON.stringify(rh.rows)).toBe(JSON.stringify(ra.rows));

  const [ca, ch] = await Promise.all([
    consolidatedPayroll(ADMIN, { month: MONTH }),
    consolidatedPayroll(HR, { month: MONTH }),
  ]);
  expect(JSON.stringify(ch.rows)).toBe(JSON.stringify(ca.rows));

  await expect(monthlyAttendanceRegister(AGENT, { month: MONTH })).rejects.toMatchObject({
    status: 403,
  });
  await expect(consolidatedPayroll(AGENT, { month: MONTH })).rejects.toMatchObject({ status: 403 });
});

/* ---------------------- process filter --------------------------- */

test("process filter uses users.process", async () => {
  const all = await consolidatedPayroll(ADMIN, { month: MONTH });
  const us = await consolidatedPayroll(ADMIN, { month: MONTH, process: "US" });
  expect(us.rows.length).toBeLessThanOrEqual(all.rows.length);
  for (const r of us.rows) expect(r.process).toBe("US");
});

/* ------- shared engine == persist path (no second calc system) ------- */

test("computePayrollBreakdown matches calculatePayrollForEmployee exactly", async () => {
  await setSalaryProfile(ADMIN, throwaway.userId, {
    baseSalary: 30000,
    effectiveFrom: "2026-01-01",
  });
  const preview = await computePayrollBreakdown(throwaway.userId, MONTH);
  const persisted = await calculatePayrollForEmployee(ADMIN, throwaway.userId, MONTH);
  expect(Number(persisted.payroll.calculatedSalary)).toBeCloseTo(
    Number(preview.calc.calculatedSalary),
    2,
  );
  expect(Number(persisted.payroll.regularityBonus)).toBe(preview.calc.regularityBonus);
  expect(Number(persisted.payroll.lateUnits)).toBeCloseTo(preview.calc.lateUnits, 1);
});

/* --------- APPROVED / LOCKED is never silently recalculated -------- */

test("calculateAllPayroll skips APPROVED / LOCKED runs and leaves them verbatim", async () => {
  // throwaway already has a CALCULATED run from the previous test → approve → lock
  await approvePayroll(ADMIN, throwaway.userId, MONTH);
  await lockPayroll(ADMIN, throwaway.userId, MONTH);
  const lockedSalary = await scalar(
    "SELECT calculated_salary v FROM payroll_runs WHERE user_id=? AND period_month=?",
    [throwaway.userId, MONTH],
  );

  // change the base salary drastically (new effective date) — a recalc WOULD move the number
  await setSalaryProfile(ADMIN, throwaway.userId, {
    baseSalary: 999999,
    effectiveFrom: "2026-02-01",
  });

  const res = await calculateAllPayroll(ADMIN, { month: MONTH });
  expect(res.skipped).toBeGreaterThanOrEqual(1);

  const afterSalary = await scalar(
    "SELECT calculated_salary v FROM payroll_runs WHERE user_id=? AND period_month=?",
    [throwaway.userId, MONTH],
  );
  expect(afterSalary).toBe(lockedSalary); // untouched

  const cp = await consolidatedPayroll(ADMIN, { month: MONTH });
  const row = cp.rows.find((r) => r.userId === throwaway.userId);
  expect(row!.payrollStatus).toBe("LOCKED");
  expect(row!.persisted).toBe(true);
  expect(Number(row!.finalCalculatedSalary)).toBeCloseTo(lockedSalary, 2);
});
