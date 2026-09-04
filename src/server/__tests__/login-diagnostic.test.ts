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

  it("with a valid secret it proceeds past auth (DB not configured here → db error, not auth error)", async () => {
    process.env["OFFICEVERSE_DIAG_SECRET"] = "the-real-secret";
    const err = await captureError(() => runLoginDiagnostic({ secret: "the-real-secret" }));
    expect(err.code).not.toBe("diag_forbidden");
    expect(err.code).not.toBe("diag_not_configured");
  });
});
