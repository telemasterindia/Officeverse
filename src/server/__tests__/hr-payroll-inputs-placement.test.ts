import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const fnsSrc = readFileSync(join(root, "lib", "officeverse", "payroll-fns.ts"), "utf8");
const svcSrc = readFileSync(join(root, "server", "hr", "payroll-service.ts"), "utf8");
const moneySrc = readFileSync(join(root, "server", "hr", "payroll-money.ts"), "utf8");
const prorationSrc = readFileSync(join(root, "server", "hr", "payroll-proration.ts"), "utf8");
const pureSrc = readFileSync(join(root, "server", "hr", "payroll.ts"), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const svcCode = strip(svcSrc);

describe("Phase 16 — payroll breakdown inputs: placement & trust boundary", () => {
  it("no payroll-input module under src/server/api", () => {
    expect(
      readdirSync(join(root, "server", "api")).some((f) => /payroll|overtime|adjust/i.test(f)),
    ).toBe(false);
  });

  it("every new fn authenticates via requireUser()", () => {
    for (const h of fnsSrc.split(/export const \w+Fn/).slice(1)) {
      expect(h).toMatch(/requireUser\(\)/);
    }
  });

  it("employment / overtime-decide / adjustment mutations are Admin/HR gated in the service", () => {
    for (const fn of [
      "setEmploymentPeriod",
      "recordOvertime",
      "decideOvertime",
      "addPayrollAdjustment",
      "voidPayrollAdjustment",
      "listOvertime",
    ]) {
      const body = svcCode.slice(svcCode.indexOf(`export async function ${fn}`)).split("\n}\n")[0]!;
      expect(body).toMatch(/assertCanManagePayroll\(actor\.role as HrRole\)/);
    }
    // breakdown is allowed for the employee's OWN month only, else Admin/HR
    const bd = svcCode.slice(svcCode.indexOf("export async function payrollBreakdown"));
    expect(bd).toMatch(/isSelf/);
    expect(bd).toMatch(/assertCanManagePayroll/);
  });

  it("the client submits only identifiers + HR-typed config — never a computed figure", () => {
    expect(fnsSrc).not.toMatch(/calculatedSalary|payableBaseSalary|grossSalary/);
    expect(fnsSrc).not.toMatch(/regularityBonus|prorationNumerator|prorationDenominator/);
    expect(fnsSrc).not.toMatch(/unpaidLeaveDeduction|offDeduction|overtimeAmount/);
    // overtime input carries raw minutes + a work date, not an amount
    const ot = fnsSrc.slice(fnsSrc.indexOf("overtimeInput = z.object({")).split("})")[0]!;
    expect(ot).toMatch(/overtimeMinutes: z\.coerce\.number\(\)\.int\(\)\.min\(0\)/);
    expect(ot).not.toMatch(/amount|salary|deduction/i);
  });

  it("the service passes ₹0 for every undefined monetary rate — nothing invented", () => {
    expect(svcCode).toMatch(/unpaidLeaveDeduction: 0/);
    expect(svcCode).toMatch(/offDeduction: 0/);
    expect(svcCode).toMatch(/overtimeAmount: 0/);
    // the overtime DTO hard-codes ₹0 with a "no rate" note
    expect(svcCode).toMatch(/overtimeAmount: "0\.00"/);
  });

  it("proration never uses the current date and only implements the defined basis", () => {
    const p = strip(prorationSrc);
    expect(p).not.toMatch(/Date\.now\(\)|new Date\(\)(?!\.)/);
    expect(p).toMatch(/PRORATION_BASES = \["CALENDAR_DAYS"\]/);
    expect(p).toMatch(/is not implemented/); // other bases throw, never guessed
  });

  it("one money policy — integer paise, half-up", () => {
    expect(moneySrc).toMatch(/PAYROLL_ROUNDING_POLICY/);
    expect(strip(moneySrc)).toMatch(/integer/i);
  });

  it("no incentive / commission / sales / statutory vocabulary anywhere in Phase-16 payroll code", () => {
    for (const src of [fnsSrc, svcSrc, pureSrc, moneySrc, prorationSrc]) {
      expect(src).not.toMatch(/incentive/i);
      expect(src).not.toMatch(/commission/i);
      expect(src).not.toMatch(/\bsales\b/i);
      expect(strip(src)).not.toMatch(/\b(pf|esi|tds|professional[_ -]?tax)\b/i);
    }
  });

  it("the pure engines are server-only (under src/server/**) and not imported by the client fns", () => {
    expect(fnsSrc).not.toMatch(/payroll-money|payroll-proration|payroll-inputs/);
    expect(fnsSrc).toMatch(/from "@\/server\/hr\/payroll-service"/);
  });
});
