/**
 * Remediation M-1 — production boot configuration guard.
 *
 * Dev / local dryrun must be entirely unaffected (no NODE_ENV=production → the
 * guard is a no-op). Production must fail clearly, naming ONLY the missing
 * variables — never a value.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertProductionConfig,
  missingProductionConfig,
  productionConfigAdvisories,
} from "../config/production-guard";

const KEYS = [
  "NODE_ENV",
  "APP_URL",
  "DATABASE_URL",
  "DB_HOST",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "CRON_SECRET",
  "OFFICEVERSE_CRON_SECRET",
  "TRUSTED_PROXY_IPS",
  "DOCUMENT_STORAGE_PROVIDER",
  "OFFICEVERSE_DOCUMENT_ROOT",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("development / dryrun — the guard is inert", () => {
  it("no NODE_ENV → nothing missing, assert does not throw", () => {
    expect(missingProductionConfig()).toEqual([]);
    expect(productionConfigAdvisories()).toEqual([]);
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("NODE_ENV=development → still inert even with nothing else set", () => {
    process.env["NODE_ENV"] = "development";
    expect(missingProductionConfig()).toEqual([]);
    expect(() => assertProductionConfig()).not.toThrow();
  });
});

describe("production — mandatory config is enforced", () => {
  beforeEach(() => {
    process.env["NODE_ENV"] = "production";
  });

  it("bare production → every mandatory requirement is reported by NAME", () => {
    const missing = missingProductionConfig();
    expect(missing).toContain("APP_URL");
    expect(missing.some((m) => m.startsWith("DATABASE_URL"))).toBe(true);
    expect(missing.some((m) => m.includes("CRON_SECRET"))).toBe(true);
  });

  it("assertProductionConfig throws, and the message leaks no value", () => {
    process.env["DATABASE_URL"] = "mysql://u:SUPERSECRETPW@db.internal:3306/app";
    process.env["CRON_SECRET"] = "cron-SUPER-SECRET-value";
    // APP_URL still missing → still throws
    let err: unknown;
    try {
      assertProductionConfig();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toMatch(/APP_URL/);
    expect(msg).not.toContain("SUPERSECRETPW");
    expect(msg).not.toContain("cron-SUPER-SECRET-value");
  });

  it("a localhost APP_URL is rejected as not a production origin", () => {
    process.env["APP_URL"] = "http://localhost:8080";
    expect(missingProductionConfig()).toContain("APP_URL");
  });

  it("fully configured production → nothing missing, no throw", () => {
    process.env["APP_URL"] = "https://officeverse.example.com";
    process.env["DATABASE_URL"] = "mysql://u:p@db:3306/app";
    process.env["OFFICEVERSE_CRON_SECRET"] = "x".repeat(40);
    expect(missingProductionConfig()).toEqual([]);
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("discrete DB_* vars satisfy the database requirement", () => {
    process.env["APP_URL"] = "https://officeverse.example.com";
    process.env["DB_HOST"] = "127.0.0.1";
    process.env["DB_NAME"] = "app";
    process.env["DB_USER"] = "app";
    process.env["CRON_SECRET"] = "y".repeat(40);
    expect(missingProductionConfig()).toEqual([]);
  });

  it("TRUSTED_PROXY_IPS unset is an ADVISORY, not a fatal — startup still allowed", () => {
    process.env["APP_URL"] = "https://officeverse.example.com";
    process.env["DATABASE_URL"] = "mysql://u:p@db:3306/app";
    process.env["CRON_SECRET"] = "z".repeat(40);
    expect(missingProductionConfig()).toEqual([]); // not fatal
    expect(productionConfigAdvisories()).toContain("TRUSTED_PROXY_IPS");
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("filesystem document storage without a root is an advisory", () => {
    process.env["APP_URL"] = "https://officeverse.example.com";
    process.env["DATABASE_URL"] = "mysql://u:p@db:3306/app";
    process.env["CRON_SECRET"] = "z".repeat(40);
    process.env["DOCUMENT_STORAGE_PROVIDER"] = "filesystem";
    expect(productionConfigAdvisories()).toContain("OFFICEVERSE_DOCUMENT_ROOT");
  });
});
