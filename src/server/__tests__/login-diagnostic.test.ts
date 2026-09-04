import { afterEach, describe, expect, it } from "vitest";
import { runLoginDiagnostic } from "../diagnostics/login-diagnostic";

afterEach(() => {
  delete process.env["OFFICEVERSE_DIAG_SECRET"];
});

async function captureError(fn: () => Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await fn();
  } catch (e) {
    return e as Error & { code?: string };
  }
  throw new Error("expected the call to throw");
}

describe("runLoginDiagnostic — authentication (mirrors runSalarySlipCron)", () => {
  it("refuses when OFFICEVERSE_DIAG_SECRET is not configured (inert by default)", async () => {
    await expect(runLoginDiagnostic({ secret: "anything" })).rejects.toMatchObject({
      code: "diag_not_configured",
    });
  });

  it("rejects a missing / wrong secret with a generic error (no detail)", async () => {
    process.env["OFFICEVERSE_DIAG_SECRET"] = "the-real-secret";
    await expect(runLoginDiagnostic({ secret: "" })).rejects.toMatchObject({
      code: "diag_forbidden",
    });
    const err = await captureError(() => runLoginDiagnostic({ secret: "wrong" }));
    expect(err.message).not.toContain("the-real-secret");
  });

  it("with a valid secret, a DB failure is surfaced as `dbError` — never an opaque throw", async () => {
    // Regression: earlier revision let a DB/driver error propagate as an
    // unlabeled exception, which the route's catch-all turned into a bare
    // 500 "internal error" — indistinguishable from any other bug and
    // useless for diagnosing an actual DB connectivity problem. It must
    // resolve, not reject, with the failure labeled.
    process.env["OFFICEVERSE_DIAG_SECRET"] = "the-real-secret";
    const result = await runLoginDiagnostic({ secret: "the-real-secret" });
    expect(result.dbError).toBeTruthy();
    expect(result.adminRowExists).toBe(false);
    expect(result.verifyReached).toBe(false);
    expect(result.verifyResult).toBe(false);
    // never leaks a connection string / credential fragment
    expect(result.dbError).not.toMatch(/:\/\//);
  });
});
