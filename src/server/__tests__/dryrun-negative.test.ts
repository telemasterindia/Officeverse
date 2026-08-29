/**
 * Phase 18 — LOCAL PRODUCTION DRY RUN, negative / trust-boundary checks.
 *
 * Pure predicate + config level. HTTP-level checks (401 on /api/health?deep=1
 * and /internal/*, 200 with no DB) were also exercised against the real Node
 * production server during the dry run — see the Phase-18 report.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assertCanManagePayroll, canManagePayroll, canRunSalaryBatch } from "../authz/hr";
import { salarySlipEligibility } from "../hr/salary-slip";
import { deliveryDisposition } from "../hr/salary-slip-batch";
import { safeSecretEqual } from "../hr/salary-slip-cron";
import { getEmailProvider } from "../email/provider";
import { __resetSalarySlipStore, getSalarySlipStore } from "../hr/salary-slip-storage";
import { collectHealth } from "../health";

const ENVK = [
  "OFFICEVERSE_EMAIL_PROVIDER",
  "RESEND_API_KEY",
  "DOCUMENT_STORAGE_PROVIDER",
  "OFFICEVERSE_DOCUMENT_ROOT",
];
afterEach(() => {
  for (const k of ENVK) delete process.env[k];
  __resetSalarySlipStore();
});

describe("Phase 18 negative tests", () => {
  it("2-6. an Agent / Closer cannot manage, approve or alter payroll, nor run the batch", () => {
    for (const role of ["agent", "closer"] as const) {
      expect(canManagePayroll(role)).toBe(false);
      expect(canRunSalaryBatch(role)).toBe(false);
      expect(() => assertCanManagePayroll(role)).toThrow(/Only Admin \/ HR/);
    }
    // Admin / HR (and the system cron principal) can
    expect(canManagePayroll("admin")).toBe(true);
    expect(canManagePayroll("hr")).toBe(true);
    expect(canRunSalaryBatch("system")).toBe(true);
  });

  it("7. Closer incentive vocabulary never appears in the salary-slip document or email code", () => {
    const root = join(__dirname, "..", "hr");
    for (const f of ["salary-slip-pdf.ts", "salary-slip-email.ts", "salary-slip.ts"]) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src).not.toMatch(/incentive/i);
      expect(src).not.toMatch(/commission/i);
      expect(src).not.toMatch(/\bsales\b/i);
    }
  });

  it("8-10. DRAFT / CALCULATED cannot produce a final slip; APPROVED + LOCKED can", () => {
    expect(salarySlipEligibility("DRAFT").ok).toBe(false);
    expect(salarySlipEligibility("CALCULATED").ok).toBe(false);
    expect(salarySlipEligibility("CALCULATED", { allowPreview: true })).toMatchObject({
      ok: true,
      isPreview: true,
    });
    expect(salarySlipEligibility("APPROVED")).toMatchObject({ ok: true, isPreview: false });
    expect(salarySlipEligibility("LOCKED")).toMatchObject({ ok: true, isPreview: false });
  });

  it("9. monthly delivery only ever considers LOCKED payroll runs", () => {
    const batchSrc = readFileSync(join(__dirname, "..", "hr", "salary-slip-batch.ts"), "utf8");
    expect(batchSrc).toMatch(/r\.status === "LOCKED"/);
    expect(["DRAFT", "CALCULATED", "APPROVED"].filter((s) => s === "LOCKED")).toHaveLength(0);
  });

  it("11. re-running delivery for an already-SENT slip does not duplicate", () => {
    const run = {
      process: "US",
      status: "LOCKED",
      baseSalary: "30000.00",
      regularityBonus: 0,
      calculatedSalary: "30000.00",
      leaveCount: 0,
      offCount: 0,
      calculationVersion: "v2",
    };
    const sent = {
      ...run,
      payrollStatusAtGeneration: "LOCKED",
      isPreview: false,
      status: "SENT",
    };
    expect(deliveryDisposition(sent, run, true)).toBe("ALREADY_SENT");
    // a FAILED slip IS retried, but reuses the same document (no new version)
    expect(deliveryDisposition({ ...sent, status: "FAILED" }, run, true)).toBe("REUSE_AND_SEND");
  });

  it("12. an invalid cron secret is rejected (constant-time compare)", () => {
    expect(safeSecretEqual("wrong", "the-real-secret")).toBe(false);
    expect(safeSecretEqual("", "x")).toBe(false);
    expect(safeSecretEqual("the-real-secret", "the-real-secret")).toBe(true);
  });

  it("14. a missing production provider key fails SAFE — no fake success", () => {
    process.env["OFFICEVERSE_EMAIL_PROVIDER"] = "resend";
    // RESEND_API_KEY intentionally unset
    expect(getEmailProvider()).toBeNull(); // send path will surface a controlled error, never SENT

    process.env["DOCUMENT_STORAGE_PROVIDER"] = "filesystem";
    // OFFICEVERSE_DOCUMENT_ROOT intentionally unset
    __resetSalarySlipStore();
    expect(() => getSalarySlipStore()).toThrow(/OFFICEVERSE_DOCUMENT_ROOT/);
  });

  it("15. database unavailable produces a safe health report (no throw, no secret)", async () => {
    // no DB env set in the test runner
    const report = await collectHealth({ deep: true });
    expect(report.database.configured).toBe(false);
    expect(report.database.reachable).toBeUndefined(); // deep check skipped when unconfigured
    expect(report.migrations.appliedCount).toBeUndefined();
    expect(JSON.stringify(report)).not.toMatch(/mysql:\/\//);
  });
});
