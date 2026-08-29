import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const fnsSrc = readFileSync(join(root, "lib", "officeverse", "salary-batch-fns.ts"), "utf8");
const batchSrc = readFileSync(join(root, "server", "hr", "salary-slip-batch.ts"), "utf8");
const cronSrc = readFileSync(join(root, "server", "hr", "salary-slip-cron.ts"), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const batchCode = strip(batchSrc);
const cronCode = strip(cronSrc);

describe("Phase 15 — monthly delivery placement & trust boundary", () => {
  it("no batch / cron module under src/server/api", () => {
    const files = readdirSync(join(root, "server", "api"));
    expect(files.some((f) => /batch|cron|delivery/i.test(f))).toBe(false);
  });

  it("Admin/HR batch endpoints derive identity via requireUser() + payroll gate", () => {
    const fns = [...fnsSrc.matchAll(/export const (\w+Fn)\b/g)].map((m) => m[1]);
    expect(fns.sort()).toEqual(
      ["cronRunMonthlyDeliveryFn", "monthlyDeliveryPreviewFn", "runMonthlyDeliveryFn"].sort(),
    );
    for (const name of ["monthlyDeliveryPreviewFn", "runMonthlyDeliveryFn"]) {
      const body = fnsSrc.slice(fnsSrc.indexOf(`export const ${name}`)).split("});")[0]!;
      expect(body).toMatch(/requireUser\(\)/);
      expect(body).toMatch(/assertCanManagePayroll\(user\.role as HrRole\)/);
    }
  });

  it("the cron endpoint is secret-authenticated and does NOT use requireUser", () => {
    const body = fnsSrc
      .slice(fnsSrc.indexOf("export const cronRunMonthlyDeliveryFn"))
      .split("});")[0]!;
    expect(body).not.toMatch(/requireUser/);
    expect(body).toMatch(/runSalarySlipCron\(/);
    expect(body).toMatch(/cronSecret: data\.secret/);
    expect(fnsSrc).toMatch(/secret: z\.string\(\)/);
  });

  it("the client submits only { month, process? } / { secret, month? } — no money or recipient", () => {
    expect(fnsSrc).not.toMatch(/baseSalary|calculatedSalary|regularityBonus|leaveCount|offCount/);
    expect(fnsSrc).not.toMatch(/recipient|toEmail|employeeEmail|storageKey|apiKey/i);
    const runObj = fnsSrc.slice(fnsSrc.indexOf("runInput = z.object({")).split("})")[0]!;
    expect(runObj).toMatch(/month/);
    expect(runObj).toMatch(/process:/);
    expect(runObj).not.toMatch(/salary|bonus|status|amount|email/i);
  });

  it("the cron service compares the secret with a constant-time check", () => {
    expect(cronCode).toMatch(/timingSafeEqual/);
    expect(cronCode).toMatch(/env\("OFFICEVERSE_CRON_SECRET"\)/);
    expect(cronCode).toMatch(/cron_not_configured/);
    expect(cronCode).toMatch(/cron_forbidden/);
    // the system principal, not a client-supplied identity
    expect(cronCode).toMatch(/role: "system"/);
  });

  it("the batch never recalculates salary / bonus and only processes LOCKED runs", () => {
    expect(batchCode).not.toMatch(/calculatePayroll\(|recomputeBonus|computeRegularityBonus/);
    expect(batchCode).not.toMatch(/countAttendanceStatus|planLeaveDays|expandSandwich/);
    expect(batchCode).toMatch(/r\.status === "LOCKED"/);
    expect(batchCode).toMatch(/status === "SENT"/); // ALREADY_SENT guard
    expect(batchCode).toMatch(/auto: true/); // uses the auto_send audit path
  });

  it("one employee failure does not abort the batch (per-row try/catch, no wrapping txn)", () => {
    expect(batchCode).toMatch(/for \(const run of chunk\)/);
    expect(batchCode).toMatch(/try \{[\s\S]*?processOneRun[\s\S]*?\} catch/);
    expect(batchCode).not.toMatch(/\.transaction\(/);
  });

  it("no Closer incentive / commission / sales vocabulary", () => {
    for (const src of [fnsSrc, batchSrc, cronSrc]) {
      expect(src).not.toMatch(/incentive/i);
      expect(src).not.toMatch(/commission/i);
      expect(src).not.toMatch(/\bsales\b/i);
    }
  });

  it("batch + cron audit events are recorded", () => {
    expect(batchCode).toMatch(/"salary_slip\.batch_preview"/);
    expect(batchCode).toMatch(/"salary_slip\.batch_process"/);
  });
});
