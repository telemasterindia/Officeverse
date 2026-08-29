import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const fnsSrc = readFileSync(join(root, "lib", "officeverse", "salary-slip-fns.ts"), "utf8");
const svcSrc = readFileSync(join(root, "server", "hr", "salary-slip-service.ts"), "utf8");
const pureFiles = [
  "salary-slip.ts",
  "salary-slip-pdf.ts",
  "salary-slip-email.ts",
  "salary-slip-storage.ts",
].map((f) => readFileSync(join(root, "server", "hr", f), "utf8"));
const providerSrc = readFileSync(join(root, "server", "email", "provider.ts"), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const svcCode = stripComments(svcSrc);
const providerCode = stripComments(providerSrc);

describe("salary-slip endpoints — placement & trust boundary", () => {
  it("no salary-slip module under src/server/api (client import-protection)", () => {
    const files = readdirSync(join(root, "server", "api"));
    expect(files.some((f) => /salary|slip/i.test(f))).toBe(false);
  });

  it("every exported salary-slip fn derives identity via requireUser()", () => {
    const fns = [...fnsSrc.matchAll(/export const (\w+Fn)\b/g)].map((m) => m[1]);
    expect(fns.sort()).toEqual(
      [
        "adminSalarySlipsFn",
        "downloadSalarySlipFn",
        "generateSalarySlipFn",
        "mySalarySlipsFn",
        "salarySlipHistoryFn",
        "sendSalarySlipFn",
      ].sort(),
    );
    for (const h of fnsSrc.split(/export const \w+Fn/).slice(1)) {
      expect(h).toMatch(/requireUser\(\)/);
    }
  });

  it("the client submits only identifiers — never money, identity, status or recipient", () => {
    expect(fnsSrc).not.toMatch(/baseSalary|calculatedSalary|regularityBonus/);
    expect(fnsSrc).not.toMatch(/leaveCount|offCount/);
    expect(fnsSrc).not.toMatch(/employeeName|employeeEmail|recipient|toEmail/i);
    // `status:` only ever appears as an optional read filter
    for (const m of fnsSrc.matchAll(/\bstatus:\s*[^,\n]*/g)) {
      expect(m[0]).toMatch(/\.optional\(\)/);
    }
    // generate takes payrollRunId (+ optional preview); the rest take salarySlipId
    const gen = fnsSrc.slice(fnsSrc.indexOf("generateInput = z.object({")).split("})")[0]!;
    expect(gen).toMatch(/payrollRunId/);
    expect(gen).not.toMatch(/salary|bonus|amount|email|name/i);
    for (const name of ["sendInput", "downloadInput", "historyInput"]) {
      const body = fnsSrc.slice(fnsSrc.indexOf(`${name} = z.object({`)).split("})")[0]!;
      expect(body).toMatch(/salarySlipId/);
      expect(body).not.toMatch(/salary:|bonus|amount|email|name|status/i);
    }
  });

  it("the slip layer consumes the payroll snapshot — it never recalculates salary", () => {
    expect(svcCode).toMatch(/getPayrollRunById\(/);
    expect(svcCode).not.toMatch(/calculatePayroll\(/);
    expect(svcCode).not.toMatch(/recomputeBonus|computeRegularityBonus/);
    expect(svcCode).not.toMatch(/attendance|planLeaveDays|expandSandwich|leave_days|off_records/);
  });

  it("the recipient is resolved from the authoritative user record, not the client", () => {
    expect(svcCode).toMatch(/getUserById\(slip\.userId\)/);
    expect(svcCode).toMatch(/recipient = emp\?\.email/);
    expect(svcCode).not.toMatch(/input\.email|data\.email|input\.recipient|data\.recipient/);
  });

  it("a send is only marked SENT after the provider resolves; failure is recorded", () => {
    const iSend = svcCode.indexOf("provider.send(");
    const iSent = svcCode.indexOf('status: "SENT"');
    const iCatch = svcCode.indexOf("} catch (err)");
    const iFailed = svcCode.indexOf('status: "FAILED"');
    expect(iSend).toBeGreaterThan(0);
    expect(iSent).toBeGreaterThan(iSend);
    expect(iFailed).toBeGreaterThan(iCatch);
    expect(iCatch).toBeGreaterThan(iSend);
  });

  it("no Closer incentive / commission / sales vocabulary in any salary-slip file", () => {
    for (const src of [fnsSrc, svcSrc, ...pureFiles]) {
      expect(src).not.toMatch(/incentive/i);
      expect(src).not.toMatch(/commission/i);
      expect(src).not.toMatch(/\bsales\b/i);
    }
  });

  it("PDF / email-provider / storage logic lives under src/server/** only", () => {
    // the pure engines define these; the client fns file only imports the service
    expect(pureFiles[1]).toMatch(/export function renderSalarySlipPdf/);
    expect(providerSrc).toMatch(/export function getEmailProvider/);
    expect(readFileSync(join(root, "server", "hr", "salary-slip-storage.ts"), "utf8")).toMatch(
      /export function getSalarySlipStore/,
    );
    expect(fnsSrc).not.toMatch(/salary-slip-pdf|salary-slip-storage|email\/provider/);
    expect(fnsSrc).toMatch(/from "@\/server\/hr\/salary-slip-service"/);
  });

  it("the email provider never hard-codes or leaks a secret", () => {
    // Phase 15: the provider MAY do network I/O (that is its job now), but the
    // API key is only ever read through env() and never assigned a literal or
    // returned to a caller.
    expect(providerCode).not.toMatch(/RESEND_API_KEY\s*[:=]\s*["'][A-Za-z0-9_-]{8,}["']/);
    expect(providerCode).toMatch(/env\("RESEND_API_KEY"\)/);
    expect(providerCode).not.toMatch(/console\.(log|info|warn|error)\([^)]*apiKey/i);
    // the diagnostics helper never carries the key
    expect(providerCode).toMatch(/describeEmailProvider/);
    expect(providerCode).not.toMatch(/reason:\s*[^,\n}]*apiKey/);
  });

  it("generate + send are Admin/HR gated and audited", () => {
    expect(svcCode).toMatch(/assertCanManagePayroll\(actor\.role as HrRole\)/);
    expect(svcCode).toMatch(/action: "salary_slip\.generate"/);
    // Phase 15 routes the action name through sentAction/failedAction; the
    // literals still appear and the auto_* variants are added
    expect(svcCode).toMatch(/"salary_slip\.send"/);
    expect(svcCode).toMatch(/"salary_slip\.send_failed"/);
    expect(svcCode).toMatch(/"salary_slip\.auto_send"/);
  });
});
