import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEV_USERS,
  __resetDevSessions,
  devAuthEnabled,
  devLogin,
  devResolve,
  devRevoke,
} from "../auth/dev-auth";
import { istWallClockToEpochMs } from "../time";

beforeEach(() => {
  __resetDevSessions();
  vi.unstubAllEnvs();
});
afterEach(() => {
  __resetDevSessions();
  vi.unstubAllEnvs();
});

describe("devAuthEnabled — structurally impossible in production / with a DB", () => {
  it("enabled by default in a non-prod, no-DB environment", () => {
    expect(devAuthEnabled()).toBe(true);
  });
  it("disabled when NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(devAuthEnabled()).toBe(false);
  });
  it("disabled when a database is configured", () => {
    vi.stubEnv("DATABASE_URL", "mysql://user:pass@localhost:3306/officeverse");
    expect(devAuthEnabled()).toBe(false);
  });
  it("disabled by OFFICEVERSE_DEV_LOGIN=0", () => {
    vi.stubEnv("OFFICEVERSE_DEV_LOGIN", "0");
    expect(devAuthEnabled()).toBe(false);
  });
});

describe("devLogin", () => {
  it("valid dev credential → token + user with the seed's role/process", () => {
    const r = devLogin("agent@officeverse.dev", "officeverse-dev");
    expect(r).not.toBeNull();
    expect(r!.user.role).toBe("agent");
    expect(r!.user.process).toBe("US");
    expect(r!.token.length).toBeGreaterThan(20);
    // synthetic negative id — cannot collide with a real users.id
    expect(r!.user.id).toBeLessThan(0);
    // no password material on the returned user
    expect(r!.user.passwordHash).toBe("");
  });

  it("wrong password → null", () => {
    expect(devLogin("admin@officeverse.dev", "nope")).toBeNull();
  });
  it("unknown email → null", () => {
    expect(devLogin("stranger@example.com", "officeverse-dev")).toBeNull();
  });
  it("honours a custom OFFICEVERSE_DEV_PASSWORD", () => {
    vi.stubEnv("OFFICEVERSE_DEV_PASSWORD", "s3cret");
    expect(devLogin("hr@officeverse.dev", "officeverse-dev")).toBeNull();
    expect(devLogin("hr@officeverse.dev", "s3cret")?.user.role).toBe("hr");
  });
  it("returns null (no-op) when dev auth is disabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(devLogin("admin@officeverse.dev", "officeverse-dev")).toBeNull();
  });

  // Regression: the session cookie stack (setSessionCookie → cookieOpts →
  // istWallClockToEpochMs) requires the Officeverse IST wall-clock format. A
  // UTC ISO string ("…Z") threw "Not an IST wall-clock string", so loginFn
  // aborted before Set-Cookie and no ov_session was ever issued in Dev Mode.
  it("expiresAt is in the IST wall-clock format the session cookie path parses", () => {
    const before = Date.now();
    const r = devLogin("admin@officeverse.dev", "officeverse-dev")!;

    expect(r.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(r.expiresAt).not.toContain("T");
    expect(r.expiresAt).not.toContain("Z");

    // the exact call cookieOpts() makes — must not throw
    let ms = 0;
    expect(() => {
      ms = istWallClockToEpochMs(r.expiresAt);
    }).not.toThrow();
    expect(new Date(ms).toString()).not.toBe("Invalid Date");

    // same instant preserved: ~12h out (DEV_TTL_MS), within a minute of rounding
    const hoursOut = (ms - before) / 3_600_000;
    expect(hoursOut).toBeGreaterThan(11.9);
    expect(hoursOut).toBeLessThan(12.1);
  });
});

describe("devResolve / devRevoke", () => {
  it("resolves a live token back to the same identity", () => {
    const { token } = devLogin("closer@officeverse.dev", "officeverse-dev")!;
    const ctx = devResolve(token);
    expect(ctx?.user.role).toBe("closer");
    expect(ctx?.user.email).toBe("closer@officeverse.dev");
  });

  it("an unknown token → null", () => {
    expect(devResolve("not-a-real-token")).toBeNull();
    expect(devResolve(undefined)).toBeNull();
  });

  it("an EXPIRED session → null and is dropped", () => {
    const { token } = devLogin("admin@officeverse.dev", "officeverse-dev")!;
    const later = Date.now() + 13 * 3_600_000;
    expect(devResolve(token, later)).toBeNull();
    expect(devResolve(token)).toBeNull(); // dropped
  });

  it("logout (devRevoke) invalidates the session immediately", () => {
    const { token } = devLogin("agent@officeverse.dev", "officeverse-dev")!;
    expect(devResolve(token)).not.toBeNull();
    expect(devRevoke(token)).toBe(true);
    expect(devResolve(token)).toBeNull();
    expect(devRevoke(token)).toBe(false); // already gone
  });

  it("covers all four Officeverse roles", () => {
    expect(DEV_USERS.map((u) => u.role).sort()).toEqual(["admin", "agent", "closer", "hr"]);
    for (const seed of DEV_USERS) {
      const { user } = devLogin(seed.email, "officeverse-dev")!;
      expect(user.role).toBe(seed.role);
    }
  });
});
