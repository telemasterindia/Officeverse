import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const payrollFns = readFileSync(join(root, "lib", "officeverse", "payroll-fns.ts"), "utf8");
const payrollSvc = readFileSync(join(root, "server", "hr", "payroll-service.ts"), "utf8");
const payrollPure = readFileSync(join(root, "server", "hr", "payroll.ts"), "utf8");
const svcCode = payrollSvc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const pureCode = payrollPure.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("payroll endpoints — placement & trust boundary", () => {
  it("no payroll / salary module under src/server/api (client import-protection)", () => {
    const files = readdirSync(join(root, "server", "api"));
    expect(files.some((f) => /payroll|salary/i.test(f))).toBe(false);
  });

  it("every exported payroll server fn derives identity via requireUser()", () => {
    const fns = [...payrollFns.matchAll(/export const (\w+Fn)\b/g)].map((m) => m[1]);
    expect(fns.sort()).toEqual(
      [
        // Phase 13
        "adminPayrollFn",
        "approvePayrollFn",
        "calculatePayrollFn",
        "lockPayrollFn",
        "myPayrollFn",
        "reopenPayrollFn",
        "salaryProfilesFn",
        "setSalaryProfileFn",
        // Phase 16 breakdown inputs
        "addAdjustmentFn",
        "adminOvertimeFn",
        "decideOvertimeFn",
        "employmentPeriodsFn",
        "myOvertimeFn",
        "payrollBreakdownFn",
        "recordOvertimeFn",
        "setEmploymentPeriodFn",
        "voidAdjustmentFn",
        // Monthly Attendance Register + Consolidated Payroll (read-only, all employees)
        "attendanceRegisterFn",
        "consolidatedPayrollFn",
        "calculateAllPayrollFn",
      ].sort(),
    );
    const handlers = payrollFns.split(/export const \w+Fn/).slice(1);
    for (const h of handlers) expect(h).toMatch(/requireUser\(\)/);
  });

  it("the client cannot submit a calculated salary / bonus / counts / status / approver", () => {
    // no engine-computed value is ever a request-validator field
    expect(payrollFns).not.toMatch(/calculatedSalary|grossSalary/);
    expect(payrollFns).not.toMatch(/regularityBonus/);
    expect(payrollFns).not.toMatch(/leaveCount|offCount|unpaidLeaveDeduction|offDeduction/);
    expect(payrollFns).not.toMatch(/payableBase|prorationNumerator|prorationDenominator/);
    expect(payrollFns).not.toMatch(/approvedBy|lockedBy|calculatedBy/);
    // `status:` only ever appears as an OPTIONAL read filter
    for (const m of payrollFns.matchAll(/\bstatus:\s*z\.[^\n]*/g)) {
      expect(m[0]).toMatch(/\.optional\(\)/);
    }
    // calculate / approve / lock inputs carry only a target-employee identifier
    // + month. `calcInput` identifies the employee by the canonical Employee ID
    // (TMI_CC_### / TMI_CL_###); approve/lock act on an existing run by userId.
    for (const name of ["calcInput", "approveInput", "lockInput"]) {
      const body = payrollFns.slice(payrollFns.indexOf(`${name} = z.object({`)).split("})")[0]!;
      expect(body).toMatch(/userId|employee_id/);
      expect(body).toMatch(/month/);
      expect(body).not.toMatch(/salary|bonus|status|amount/i);
    }
    // the ONLY client-supplied money is HR configuration: a base salary, or an
    // explicit labelled adjustment magnitude — both bounded & non-negative.
    const adj = payrollFns
      .slice(payrollFns.indexOf("adjustmentInput = z.object({"))
      .split("})")[0]!;
    expect(adj).toMatch(/amount: z\.coerce\.number\(\)\.finite\(\)\.min\(0\)/);
  });

  it("payroll consumes the Phase-12 bonus engine — it does NOT recompute eligibility", () => {
    expect(svcCode).toMatch(/recomputeBonus\(/);
    expect(svcCode).not.toMatch(/computeRegularityBonus/);
    expect(svcCode).not.toMatch(/attendance\.status|countAttendanceStatus/);
    // no second leave/off counting for the bonus
    expect(svcCode).not.toMatch(/countLeaveDaysInMonth|countActiveOffInMonth/);
  });

  it("the gross comes from the pure engine; no statutory term; no invented rate", () => {
    // the service composes the snapshot via the pure Phase-16 engine
    expect(svcCode).toMatch(/calculateMonthlyPayroll\(\{/);
    expect(pureCode).toMatch(/export function calculateMonthlyPayroll/);
    // Phase-13 back-compat engine is still base + bonus only
    expect(pureCode).toMatch(/addMoney\(baseSalary, regularityBonus\)/);
    // NO statutory / tax term anywhere in the pure engine
    expect(pureCode).not.toMatch(/\b(tax|pf|esi|tds|professional[_ -]?tax|statutory)\b/i);
    // the service NEVER invents an undefined rate — it passes ₹0 for the
    // unpaid-leave / Off / overtime money until a business rate exists
    expect(svcCode).toMatch(/unpaidLeaveDeduction: 0/);
    expect(svcCode).toMatch(/offDeduction: 0/);
    expect(svcCode).toMatch(/overtimeAmount: 0/);
    // regularity bonus is still consumed, not recomputed
    expect(svcCode).toMatch(/recomputeBonus\(/);
    expect(svcCode).not.toMatch(/computeRegularityBonus/);
  });

  it("no Closer incentive / commission / sales vocabulary in any payroll file", () => {
    for (const src of [payrollFns, payrollSvc, payrollPure]) {
      expect(src).not.toMatch(/incentive/i);
      expect(src).not.toMatch(/commission/i);
      expect(src).not.toMatch(/\bsales\b/i);
    }
  });

  it("mutations are Admin/HR gated and go through the lifecycle guard", () => {
    expect(svcCode).toMatch(/assertCanManagePayroll\(actor\.role as HrRole\)/);
    expect(svcCode).toMatch(/assertPayrollTransition\(/);
  });

  it("APPROVED / LOCKED runs are only changed via an explicit audited reopen", () => {
    expect(svcCode).toMatch(/export async function reopenPayroll/);
    expect(svcCode).toMatch(/action: "payroll\.reopen"/);
    // reopen requires a reason
    expect(svcCode).toMatch(/reason_required/);
  });
});
