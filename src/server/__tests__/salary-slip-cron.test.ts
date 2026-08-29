import { afterEach, describe, expect, it } from "vitest";
import {
  previousPayrollMonthIST,
  runSalarySlipCron,
  safeSecretEqual,
} from "../hr/salary-slip-cron";
import { deliveryDisposition } from "../hr/salary-slip-batch";

afterEach(() => {
  delete process.env["OFFICEVERSE_CRON_SECRET"];
});

async function captureError(fn: () => Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await fn();
  } catch (e) {
    return e as Error & { code?: string };
  }
  throw new Error("expected the call to throw");
}

describe("safeSecretEqual — constant-time comparison", () => {
  it("true only for an exact match", () => {
    expect(safeSecretEqual("s3cr3t-value", "s3cr3t-value")).toBe(true);
    expect(safeSecretEqual("s3cr3t-value", "s3cr3t-valuE")).toBe(false);
  });
  it("false for a length mismatch without throwing", () => {
    expect(safeSecretEqual("short", "a-much-longer-secret")).toBe(false);
    expect(safeSecretEqual("", "x")).toBe(false);
  });
});

describe("previousPayrollMonthIST", () => {
  it("returns the prior calendar month", () => {
    expect(previousPayrollMonthIST("2026-03-15")).toBe("2026-02");
    expect(previousPayrollMonthIST("2026-01-05")).toBe("2025-12");
    expect(previousPayrollMonthIST("2026-12-31")).toBe("2026-11");
  });
});

describe("runSalarySlipCron — authentication", () => {
  it("refuses when OFFICEVERSE_CRON_SECRET is not configured", async () => {
    await expect(runSalarySlipCron({ cronSecret: "anything" })).rejects.toMatchObject({
      code: "cron_not_configured",
    });
  });

  it("rejects a missing / wrong secret with a generic error (no detail)", async () => {
    process.env["OFFICEVERSE_CRON_SECRET"] = "the-real-secret";
    await expect(runSalarySlipCron({ cronSecret: "" })).rejects.toMatchObject({
      code: "cron_forbidden",
    });
    const err = await captureError(() => runSalarySlipCron({ cronSecret: "wrong" }));
    expect(err.message).not.toContain("the-real-secret");
  });

  it("with a valid secret it proceeds past auth (DB not configured here → db error, not auth error)", async () => {
    process.env["OFFICEVERSE_CRON_SECRET"] = "the-real-secret";
    const err = await captureError(() =>
      runSalarySlipCron({ cronSecret: "the-real-secret", month: "2026-08" }),
    );
    // it got past the secret check; the batch then refuses because no DB is wired
    expect(err.code).toBe("db_unavailable");
  });
});

describe("deliveryDisposition — monthly batch decision matrix (PURE)", () => {
  const run = {
    process: "US",
    status: "LOCKED",
    baseSalary: "30000.00",
    regularityBonus: 1000,
    calculatedSalary: "31000.00",
    leaveCount: 0,
    offCount: 0,
    calculationVersion: "v1",
  };
  const slip = (over: Partial<Record<string, unknown>> = {}) => ({
    process: "US",
    baseSalary: "30000.00",
    regularityBonus: 1000,
    calculatedSalary: "31000.00",
    leaveCount: 0,
    offCount: 0,
    calculationVersion: "v1",
    payrollStatusAtGeneration: "LOCKED",
    isPreview: false,
    status: "GENERATED",
    ...over,
  });

  it("no existing slip → generate and send", () => {
    expect(deliveryDisposition(null, run, true)).toBe("GENERATE_AND_SEND");
  });
  it("unchanged slip already SENT → ALREADY_SENT (never auto-resend)", () => {
    expect(deliveryDisposition(slip({ status: "SENT" }), run, true)).toBe("ALREADY_SENT");
  });
  it("unchanged slip that FAILED → reuse the same document and retry", () => {
    expect(deliveryDisposition(slip({ status: "FAILED" }), run, true)).toBe("REUSE_AND_SEND");
  });
  it("changed figures after reopen+recalc → regenerate", () => {
    expect(
      deliveryDisposition(slip({ status: "SENT", calculatedSalary: "36000.00" }), run, true),
    ).toBe("GENERATE_AND_SEND");
  });
  it("a preview slip is never treated as the final document", () => {
    expect(deliveryDisposition(slip({ isPreview: true, status: "SENT" }), run, true)).toBe(
      "GENERATE_AND_SEND",
    );
  });
  it("missing employee email → generate/reuse only, no send", () => {
    expect(deliveryDisposition(null, run, false)).toBe("GENERATE_NO_EMAIL");
    expect(deliveryDisposition(slip({ status: "SENT" }), run, false)).toBe("REUSE_NO_EMAIL");
  });
});
