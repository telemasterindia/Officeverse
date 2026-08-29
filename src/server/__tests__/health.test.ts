import { afterEach, describe, expect, it } from "vitest";
import { collectHealth, publicLiveness, LOCAL_MIGRATION_COUNT } from "../health";

const ENVK = [
  "NODE_ENV",
  "OFFICEVERSE_EMAIL_PROVIDER",
  "RESEND_API_KEY",
  "DOCUMENT_STORAGE_PROVIDER",
  "OFFICEVERSE_DOCUMENT_ROOT",
  "OFFICEVERSE_CRON_SECRET",
  "CRON_SECRET",
  "SESSION_COOKIE_NAME",
];
afterEach(() => {
  for (const k of ENVK) delete process.env[k];
});

describe("collectHealth — status only, never a secret", () => {
  it("bundles the local migration count from the drizzle journal", () => {
    expect(LOCAL_MIGRATION_COUNT).toBeGreaterThanOrEqual(11);
  });

  it("reports config presence without leaking any value", async () => {
    process.env["OFFICEVERSE_EMAIL_PROVIDER"] = "resend";
    process.env["RESEND_API_KEY"] = "re_SUPER_SECRET_value";
    process.env["OFFICEVERSE_CRON_SECRET"] = "cron-SUPER-SECRET";
    process.env["DOCUMENT_STORAGE_PROVIDER"] = "filesystem";
    process.env["OFFICEVERSE_DOCUMENT_ROOT"] = "/srv/docs";

    const r = await collectHealth();
    const blob = JSON.stringify(r);
    expect(blob).not.toContain("re_SUPER_SECRET_value");
    expect(blob).not.toContain("cron-SUPER-SECRET");

    expect(r.email).toEqual({ configured: true, provider: "resend", reason: null });
    expect(r.storage).toEqual({ provider: "filesystem", rootConfigured: true, durable: true });
    expect(r.automation.cronSecretConfigured).toBe(true);
    expect(r.session.httpOnly).toBe(true);
    expect(r.session.sameSite).toBe("lax");
  });

  it("resend without a key → not configured, secret-free reason", async () => {
    process.env["OFFICEVERSE_EMAIL_PROVIDER"] = "resend";
    const r = await collectHealth();
    expect(r.email.configured).toBe(false);
    expect(r.email.reason).toMatch(/RESEND_API_KEY/);
  });

  it("secure cookies only in production", async () => {
    process.env["NODE_ENV"] = "production";
    expect((await collectHealth()).session.secureCookies).toBe(true);
    process.env["NODE_ENV"] = "development";
    expect((await collectHealth()).session.secureCookies).toBe(false);
  });

  it("no deep DB fields unless deep-checked (and no DB is configured here)", async () => {
    const r = await collectHealth();
    expect(r.database.configured).toBe(false);
    expect(r.database.reachable).toBeUndefined();
    expect(r.migrations.appliedCount).toBeUndefined();
  });
});

describe("publicLiveness — compact strings, still no secret", () => {
  it("maps status to configured / not-configured", async () => {
    process.env["OFFICEVERSE_EMAIL_PROVIDER"] = "none";
    const view = publicLiveness(await collectHealth());
    expect(view).toMatchObject({
      ok: true,
      service: "officeverse",
      database: "not-configured",
      migrations: "present",
      email_provider: "not-configured",
      storage: "not-configured",
      automation: "not-configured",
    });
    expect(Object.keys(view)).not.toContain("nodeEnv");
  });
});
