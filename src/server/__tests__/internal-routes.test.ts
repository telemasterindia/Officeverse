import { afterEach, describe, expect, it } from "vitest";
import { handleInternal } from "../internal-routes";

const ENVK = ["CRON_SECRET", "OFFICEVERSE_CRON_SECRET"];
afterEach(() => {
  for (const k of ENVK) delete process.env[k];
});

const req = (path: string, init: RequestInit = {}) =>
  new Request(`https://app.example${path}`, init);

describe("GET /api/health — public liveness (status only)", () => {
  it("returns a compact status object with no secret", async () => {
    process.env["CRON_SECRET"] = "top-secret-value";
    const res = await handleInternal(req("/api/health"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("officeverse");
    expect(body.automation).toBe("configured");
    expect(JSON.stringify(body)).not.toContain("top-secret-value");
    // the deep-only fields are not in the public view
    expect(body).not.toHaveProperty("migrations.appliedCount");
    expect(body).not.toHaveProperty("session");
  });

  it("?deep=1 requires the cron secret", async () => {
    process.env["CRON_SECRET"] = "abc123";
    const unauth = await handleInternal(req("/api/health?deep=1"));
    expect(unauth!.status).toBe(401);
    const ok = await handleInternal(
      req("/api/health?deep=1", { headers: { "x-cron-secret": "abc123" } }),
    );
    expect(ok!.status).toBe(200);
    const body = await ok!.json();
    expect(body.session.httpOnly).toBe(true); // full report shape
  });
});

describe("POST /internal/monthly-salary-slips — cron-secret gated, dry by default", () => {
  it("401 without a secret", async () => {
    process.env["CRON_SECRET"] = "s3cr3t";
    const res = await handleInternal(req("/internal/monthly-salary-slips", { method: "POST" }));
    expect(res!.status).toBe(401);
  });

  it("401 with a wrong secret (constant-time compare, no detail)", async () => {
    process.env["CRON_SECRET"] = "s3cr3t";
    const res = await handleInternal(
      req("/internal/monthly-salary-slips", {
        method: "POST",
        headers: { "x-cron-secret": "WRONG" },
      }),
    );
    expect(res!.status).toBe(401);
    expect(await res!.text()).not.toContain("s3cr3t");
  });

  it("accepts OFFICEVERSE_CRON_SECRET as an alternative; then 503 (no DB wired here)", async () => {
    process.env["OFFICEVERSE_CRON_SECRET"] = "alt-secret";
    const res = await handleInternal(
      req("/internal/monthly-salary-slips", {
        method: "POST",
        headers: { "x-cron-secret": "alt-secret" },
      }),
    );
    // got past auth; the batch needs a DB which is not configured in tests
    expect(res!.status).toBe(503);
    expect((await res!.json()).error).toBe("db_unavailable");
  });

  it("GET is not allowed", async () => {
    process.env["CRON_SECRET"] = "s3cr3t";
    const res = await handleInternal(
      req("/internal/monthly-salary-slips", { headers: { "x-cron-secret": "s3cr3t" } }),
    );
    expect(res!.status).toBe(405);
  });
});

describe("legacy /internal/* stubs stay gated + unimplemented", () => {
  it("/internal/tick → 401 then 501", async () => {
    process.env["CRON_SECRET"] = "x";
    expect((await handleInternal(req("/internal/tick", { method: "POST" })))!.status).toBe(401);
    const ok = await handleInternal(
      req("/internal/tick", { method: "POST", headers: { "x-cron-secret": "x" } }),
    );
    expect(ok!.status).toBe(501);
  });
});

describe("unknown paths fall through", () => {
  it("returns null for a normal route", async () => {
    expect(await handleInternal(req("/dashboard"))).toBeNull();
  });
});
