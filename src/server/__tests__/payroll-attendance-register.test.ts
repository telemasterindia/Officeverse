/**
 * PAYROLL + MONTHLY ATTENDANCE REGISTER (PURE / structural).
 *
 * The consolidated Attendance + Payroll system is a READ-ONLY view over the
 * existing canonical data + the SINGLE shared calc engine. It never invents
 * rules and never persists / recalculates an APPROVED / LOCKED run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dayCode, daysInMonth } from "../hr/payroll-register-service";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const svc = stripComments(read("server/hr/payroll-register-service.ts"));
const paySvc = stripComments(read("server/hr/payroll-service.ts"));
const fns = read("lib/officeverse/payroll-fns.ts");
const route = read("routes/_shell.payroll.tsx");

describe("day handling + code mapping (pure)", () => {
  it("daysInMonth returns 28 / 29 / 30 / 31 correctly", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2024-02")).toBe(29);
    expect(daysInMonth("2026-06")).toBe(30);
    expect(daysInMonth("2026-01")).toBe(31);
  });

  it("dayCode maps ONLY from the stored classification — P / L / AB / HD", () => {
    const base = { checkInStatus: "ON_TIME", shortAttendance: false, firstCheckInAt: "x" };
    expect(dayCode({ ...base, status: "ABSENT", firstCheckInAt: null })).toBe("AB");
    expect(dayCode({ ...base, status: "SHORT_ATTENDANCE" })).toBe("HD");
    expect(dayCode({ ...base, status: "LATE", checkInStatus: "LATE" })).toBe("L");
    expect(dayCode({ ...base, status: "LATE", checkInStatus: "SHORT" })).toBe("L");
    expect(dayCode({ ...base, status: "ON_TIME" })).toBe("P");
    expect(dayCode({ ...base, status: "EARLY_DEPARTURE" })).toBe("P");
    expect(dayCode({ ...base, status: "PENDING", firstCheckInAt: null })).toBe("");
  });
});

describe("one calculation path — no second system", () => {
  it("payroll-service exposes the shared computePayrollBreakdown and calculatePayrollForEmployee calls it", () => {
    expect(paySvc).toMatch(/export async function computePayrollBreakdown\(/);
    const calc = paySvc.slice(paySvc.indexOf("export async function calculatePayrollForEmployee"));
    expect(calc).toMatch(/const computed = await computePayrollBreakdown\(targetUserId, month\)/);
    // the calc engine invocation moved into the shared fn — not duplicated here
    expect(calc).not.toMatch(/calculateMonthlyPayroll\(\{/);
  });

  it("computePayrollBreakdown still uses the canonical primitives in order", () => {
    const fn = paySvc.slice(
      paySvc.indexOf("export async function computePayrollBreakdown"),
      paySvc.indexOf("export async function calculatePayrollForEmployee"),
    );
    expect(fn).toMatch(/pickEffectiveProfile\(/);
    expect(fn).toMatch(/recomputeBonus\(/);
    expect(fn).toMatch(/computeLateDeduction\(/);
    expect(fn).toMatch(/calculateMonthlyPayroll\(\{/);
    // it must NOT persist / audit
    expect(fn).not.toMatch(/insertPayrollRun|updatePayrollRun|recordAudit/);
  });

  it("the register service reuses computePayrollBreakdown for leave/late-units + calculatePayrollForEmployee for calc-all", () => {
    expect(svc).toMatch(
      /import \{ calculatePayrollForEmployee, computePayrollBreakdown \} from "\.\/payroll-service"/,
    );
    // no re-implementation of the salary formula
    expect(svc).not.toMatch(/calculateMonthlyPayroll|regularityBonus\s*=\s*1000|SHORT_LATE_UNITS/);
  });
});

describe("read-only + lifecycle-safe", () => {
  it("register/consolidated services never write payroll_runs; calc-all skips APPROVED/LOCKED", () => {
    expect(svc).not.toMatch(/insertPayrollRun|updatePayrollRun/);
    const reg = svc.slice(svc.indexOf("export async function monthlyAttendanceRegister"));
    expect(reg).not.toMatch(/insertPayrollRun|updatePayrollRun|recordAudit/);
    const all = svc.slice(svc.indexOf("export async function calculateAllPayroll"));
    expect(all).toMatch(/status === "APPROVED" \|\| .*status === "LOCKED"/);
    expect(all).toMatch(/skipped \+= 1/);
    expect(all).toMatch(/calculatePayrollForEmployee\(actor, s\.userId, f\.month/);
  });

  it("a persisted run is shown verbatim (its own status), previews are DRAFT", () => {
    const cons = svc.slice(svc.indexOf("export async function consolidatedPayroll"));
    expect(cons).toMatch(/payrollStatus: run\.status as PayrollStatusValue/);
    expect(cons).toMatch(/persisted: true/);
    expect(cons).toMatch(/payrollStatus: "DRAFT"/);
    expect(cons).toMatch(/persisted: false/);
  });
});

describe("Admin + HR gate; filters; identity", () => {
  it("every register service asserts the shared payroll gate (Admin + HR)", () => {
    for (const f of ["monthlyAttendanceRegister", "consolidatedPayroll", "calculateAllPayroll"]) {
      const fn = svc.slice(svc.indexOf(`export async function ${f}`));
      expect(fn.slice(0, 400)).toMatch(/assertCanManagePayroll\(actor\.role as HrRole\)/);
    }
  });

  it("process filter flows to users.process via listStaffRows; month/process/q are the only inputs", () => {
    expect(svc).toMatch(/listStaffRows\("agent", opts\)/);
    expect(svc).toMatch(/listStaffRows\("closer", opts\)/);
    expect(fns).toMatch(
      /registerInput = z\s*\.object\(\{\s*month,\s*process: processCode\.optional\(\),\s*q:/,
    );
    expect(fns).toMatch(/attendanceRegisterFn = createServerFn\(\{ method: "GET" \}\)/);
    expect(fns).toMatch(/consolidatedPayrollFn = createServerFn\(\{ method: "GET" \}\)/);
    expect(fns).toMatch(/calculateAllPayrollFn = createServerFn\(\{ method: "POST" \}\)/);
  });

  it("identity comes from the session (requireUser) — role never from the client", () => {
    const block = fns.slice(fns.indexOf("attendanceRegisterFn"));
    expect(block).toMatch(/attendanceRegisterFn[\s\S]{0,200}requireUser\(\)/);
    expect(block).toMatch(/consolidatedPayrollFn[\s\S]{0,200}requireUser\(\)/);
    expect(block).toMatch(/calculateAllPayrollFn[\s\S]{0,200}requireUser\(\)/);
  });
});

describe("UI — photos, canonical ID, Excel-ready export", () => {
  it("both new sections render for the manager view with StaffAvatar + canonical Employee ID", () => {
    expect(route).toMatch(/<ConsolidatedPayrollSection \/>/);
    expect(route).toMatch(/<AttendanceRegisterSection \/>/);
    const reg = route.slice(route.indexOf("function AttendanceRegisterSection"));
    expect(reg).toMatch(/<EmployeeCell/); // reuses the shared StaffAvatar cell
    expect(reg).toMatch(/\{r\.employeeCode\}/);
    expect(reg).toMatch(/<ProcessFilter value=\{proc\} onChange=\{setProc\}/);
    const cons = route.slice(
      route.indexOf("function ConsolidatedPayrollSection"),
      route.indexOf("function SalaryProfiles"),
    );
    expect(cons).toMatch(/<EmployeeCell/);
    expect(cons).toMatch(/useConsolidatedPayroll\(query\)/);
    expect(cons).toMatch(/useCalculateAllPayroll\(\)/);
  });

  it("Excel-ready: a client-side CSV (Blob) — NOT the server Data Export centre", () => {
    expect(route).toMatch(/function downloadCsv\(/);
    expect(route).toMatch(/new Blob\(\["\\uFEFF"|new Blob\(\["\uFEFF"/); // BOM for Excel
    expect(route).not.toMatch(/exportDownloadFn|from "@\/lib\/officeverse\/export-fns"/);
    // attendance export preserves the required columns
    const reg = route.slice(route.indexOf("function AttendanceRegisterSection"));
    expect(reg).toMatch(/"Employee ID"[\s\S]{0,120}"Process"[\s\S]{0,400}"Late Units"/);
  });
});
