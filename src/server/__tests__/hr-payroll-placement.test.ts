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
        "adminPayrollFn",
        "approvePayrollFn",
        "calculatePayrollFn",
        "lockPayrollFn",
        "myPayrollFn",
        "reopenPayrollFn",
        "salaryProfilesFn",
        "setSalaryProfileFn",
      ].sort(),
    );
    const handlers = payrollFns.split(/export const \w+Fn/).slice(1);
    for (const h of handlers) expect(h).toMatch(/requireUser\(\)/);
  });

  it("the client cannot submit a calculated salary / bonus / counts / status / approver", () => {
    // none of these appear as request-validator fields
    expect(payrollFns).not.toMatch(/calculatedSalary/);
    expect(payrollFns).not.toMatch(/regularityBonus/);
    expect(payrollFns).not.toMatch(/leaveCount|offCount/);
    expect(payrollFns).not.toMatch(/approvedBy|lockedBy|calculatedBy/);
    // `status:` only ever appears as an optional read filter on the admin list
    for (const m of payrollFns.matchAll(/\bstatus:\s*[^,\n]*/g)) {
      expect(m[0]).toMatch(/\.optional\(\)/);
    }
    // calculate / approve / lock inputs carry only a target user + month
    for (const name of ["calcInput", "approveInput", "lockInput"]) {
      const body = payrollFns.slice(payrollFns.indexOf(`${name} = z.object({`)).split("})")[0]!;
      expect(body).toMatch(/userId/);
      expect(body).toMatch(/month/);
      expect(body).not.toMatch(/salary|bonus|status|amount/i);
    }
  });

  it("payroll consumes the Phase-12 bonus engine — it does NOT recompute eligibility", () => {
    expect(svcCode).toMatch(/recomputeBonus\(/);
    expect(svcCode).not.toMatch(/computeRegularityBonus/);
    expect(svcCode).not.toMatch(/attendance\.status|countAttendanceStatus/);
    // no second leave/off counting for the bonus
    expect(svcCode).not.toMatch(/countLeaveDaysInMonth|countActiveOffInMonth/);
  });

  it("calculatedSalary comes from the pure engine, base + bonus only", () => {
    expect(svcCode).toMatch(/calculatePayroll\(\{/);
    expect(pureCode).toMatch(/addMoney\(baseSalary, regularityBonus\)/);
    // no speculative money terms anywhere in the pure engine
    expect(pureCode).not.toMatch(/\b(tax|pf|esi|tds|deduction|proration|overtime)\b/i);
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
