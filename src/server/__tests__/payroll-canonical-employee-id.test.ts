/**
 * PAYROLL & SALARY — process filter + canonical Employee ID handling
 * (PURE / structural).
 *
 * Only the four things this task touches: (A) process/shift filtering,
 * (B) canonical Employee ID handling, (C) salary-table Employee ID display,
 * (D) payroll employee lookup. The per-day calc / effective-dating / Regularity
 * Bonus / lifecycle logic is asserted to be untouched.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROCESS_FILTER_OPTIONS } from "@/components/officeverse/process-filter";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const route = read("routes/_shell.payroll.tsx");
const fns = read("lib/officeverse/payroll-fns.ts");
const svc = stripComments(read("server/hr/payroll-service.ts"));
const repo = read("server/db/repos/payroll.ts");

/* ------------------------------ A. filter ------------------------------ */

describe("A — process/shift filter", () => {
  it("the shared ProcessFilter offers ALL | US | UK | INDIA | AU, default ALL", () => {
    expect(PROCESS_FILTER_OPTIONS.map((o) => o.id)).toEqual(["ALL", "US", "UK", "IN", "AU"]);
    expect(PROCESS_FILTER_OPTIONS.map((o) => o.label)).toEqual(["ALL", "US", "UK", "INDIA", "AU"]);
    // the Base-salary list wires the pill straight into the query, ALL = no filter
    expect(route).toMatch(/useSalaryProfiles\(employee \|\| undefined, filterToProcess\(proc\)\)/);
    expect(route).toMatch(
      /function filterToProcess\(v: ProcessFilterValue\)[\s\S]{0,90}v === "ALL" \? undefined/,
    );
    expect(route).toMatch(/<ProcessFilter value=\{proc\} onChange=\{setProc\}/);
  });

  it("the filter resolves against the authoritative users.process — never a snapshot column", () => {
    expect(repo).toMatch(
      /if \(filter\.process\) conds\.push\(eq\(users\.process, filter\.process as never\)\)/,
    );
    // the per-run snapshot column is not what payroll/salary filtering keys off
    expect(repo).not.toMatch(/conds\.push\(eq\(payrollRuns\.process,/);
    const listFn = repo.slice(
      repo.indexOf("export async function listSalaryProfiles"),
      repo.indexOf("/* ---------------------------- payroll_runs"),
    );
    expect(listFn).not.toMatch(/timezone|PROCESS_BY_|processFor\(|\.flag/i);
  });
});

/* --------------------- B/D. canonical Employee ID --------------------- */

describe("B/D — Employee ID is the full canonical string, resolved before users.id", () => {
  it("the fn validators take a canonical Employee ID string — NOT a coerced number", () => {
    const idSchema = fns.slice(
      fns.indexOf("const employeeId = z"),
      fns.indexOf("const setSalaryInput"),
    );
    expect(idSchema).toMatch(/z\s*\.string\(\)/);
    expect(idSchema).toMatch(/\^\(TMI_CC_\\d\{3,\}\|TMI_CL_\\d\{3,\}\)\$/);
    expect(idSchema).not.toMatch(/z\.coerce\.number|parseInt|Number\(/);

    expect(fns).toMatch(/setSalaryInput = z\.object\(\{\s*employee_id: employeeId/);
    expect(fns).toMatch(/calcInput = z\.object\(\{ employee_id: employeeId, month \}\)/);
    // the two employee-selection inputs no longer accept a bare numeric userId
    const setBody = fns.slice(fns.indexOf("setSalaryInput = z.object({")).split("})")[0]!;
    const calcBody = fns.slice(fns.indexOf("calcInput = z.object({")).split("})")[0]!;
    expect(setBody).not.toMatch(/\buserId\b/);
    expect(calcBody).not.toMatch(/\buserId\b/);
  });

  it("the handlers resolve the canonical ID → users.id BEFORE calling the service", () => {
    const setH = fns.slice(
      fns.indexOf("export const setSalaryProfileFn"),
      fns.indexOf("export const salaryProfilesFn"),
    );
    expect(setH).toMatch(/const target = await svc\.resolveEmployeeUserId\(employee_id\)/);
    expect(setH).toMatch(/svc\.setSalaryProfile\(user, target,/);
    expect(setH.indexOf("resolveEmployeeUserId")).toBeLessThan(
      setH.indexOf("svc.setSalaryProfile"),
    );

    const calcH = fns.slice(
      fns.indexOf("export const calculatePayrollFn"),
      fns.indexOf("export const approvePayrollFn"),
    );
    expect(calcH).toMatch(/const target = await svc\.resolveEmployeeUserId\(data\.employee_id\)/);
    expect(calcH).toMatch(/svc\.calculatePayrollForEmployee\(user, target,/);
    expect(calcH.indexOf("resolveEmployeeUserId")).toBeLessThan(
      calcH.indexOf("calculatePayrollForEmployee"),
    );
  });

  it("resolveEmployeeUserId prefix-routes an EXACT string match — TMI_CC_ vs TMI_CL_ can never collide", () => {
    const start = svc.indexOf("export async function resolveEmployeeUserId");
    const fn = svc.slice(start, svc.indexOf("\n}\n", start) + 2);
    expect(fn).toMatch(/isCanonicalAgentCode\(code\)/);
    expect(fn).toMatch(/isCanonicalCloserCode\(code\)/);
    expect(fn).toMatch(/getAgentByCode\(code\)/); // exact eq(agents.agent_code, code) in the repo
    expect(fn).toMatch(/getCloserByCode\(code\)/);
    expect(fn).toMatch(/return a\.userId/);
    expect(fn).toMatch(/return c\.userId/);
    // never coerces to a number / strips the prefix / strips leading zeros
    expect(fn).not.toMatch(/Number\(|parseInt|numericPart|replace\(\/\\D|\.replace\(/);
    expect(fn).toMatch(/"bad_employee_id"/); // a bare "010" → 422, not silently accepted
    expect(fn).toMatch(/"employee_not_found"/); // an unknown canonical ID → 404, never invented
  });
});

/* ----------------------- C. salary-table display --------------------- */

describe("C — salary table shows the canonical Employee ID in its own column", () => {
  it("dedicated Employee ID column, canonical code shown alone (not merged with process)", () => {
    expect(route).toMatch(/<th className="px-3 py-2">Employee<\/th>/);
    expect(route).toMatch(/<th className="px-3 py-2">Employee ID<\/th>/);
    expect(route).toMatch(
      /<td className="px-3 py-2 font-mono text-xs">\{p\.employeeCode \?\? "—"\}<\/td>/,
    );
    // the identity cell no longer concatenates code + " · " + process
    const cell = route.slice(
      route.indexOf("function EmployeeCell"),
      route.indexOf("function PayrollPage"),
    );
    expect(cell).not.toMatch(/\$\{process\}|code \?\? "—"/);
  });

  it("photos use the existing StaffAvatar", () => {
    expect(route).toMatch(
      /import \{ StaffAvatar \} from "@\/components\/officeverse\/staff-avatar"/,
    );
    expect(route).toMatch(/<StaffAvatar/);
  });

  it("the two in-scope forms use a canonical 'Employee ID' field — not 'user ID', not numeric", () => {
    const salaryForm = route.slice(
      route.indexOf("function SalaryProfiles"),
      route.indexOf("function CalculateForm"),
    );
    const calcForm = route.slice(
      route.indexOf("function CalculateForm"),
      route.indexOf("function ManagerPayroll"),
    );
    for (const form of [salaryForm, calcForm]) {
      expect(form).not.toMatch(/Employee user ID/);
      expect(form).toMatch(/<span className="mb-1 block font-semibold">Employee ID<\/span>/);
      expect(form).toMatch(/placeholder="TMI_CC_010"/);
      // plain opaque string field — no numeric stripping / inputMode / Number()
      expect(form).not.toMatch(/replace\(\/\\D\/g|inputMode="numeric"|Number\(form\.employee/);
      expect(form).toMatch(/EMPLOYEE_ID_RE\.test\(id\)/);
    }
  });
});

/* --------------- payroll calc / lifecycle left untouched -------------- */

describe("existing payroll rules are untouched", () => {
  it("calculatePayrollForEmployee still takes a numeric targetUserId and is unchanged in shape", () => {
    expect(svc).toMatch(
      /export async function calculatePayrollForEmployee\(\s*actor:[\s\S]{0,120}targetUserId: number/,
    );
    expect(svc).toMatch(
      /export async function setSalaryProfile\(\s*actor:[\s\S]{0,120}targetUserId: number/,
    );
  });

  it("approve / lock / reopen still key off userId (lifecycle transitions, not employee search)", () => {
    expect(fns).toMatch(/approveInput = z\.object\(\{ userId, month \}\)/);
    expect(fns).toMatch(/lockInput = z\.object\(\{ userId, month \}\)/);
    expect(fns).toMatch(/reopenInput = z\.object\(\{ userId, month, reason:/);
  });

  it("no change to the per-day calc / effective-dating / Regularity Bonus wiring", () => {
    expect(svc).toMatch(/recomputeBonus\(/); // Phase-12 bonus engine consumed, not recomputed
    expect(svc).toMatch(/pickEffectiveProfile\(/); // effective-dated base salary
    expect(svc).toMatch(/calculateMonthlyPayroll\(/); // the pure per-day engine
    expect(svc).toMatch(/assertPayrollTransition\(/); // DRAFT→CALCULATED→APPROVED→LOCKED guard
  });
});
