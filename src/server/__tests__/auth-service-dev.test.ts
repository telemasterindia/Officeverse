import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { login, logout } from "../auth/service";
import { __resetDevSessions, devResolve } from "../auth/dev-auth";
import { istWallClockToEpochMs } from "../time";

beforeEach(() => {
  __resetDevSessions();
  vi.unstubAllEnvs();
});
afterEach(() => {
  __resetDevSessions();
  vi.unstubAllEnvs();
});

describe("auth/service login() — dev-auth branch (no DB)", () => {
  it("valid dev credential → { ok, user } with the right role, no hash leaked", async () => {
    const res = await login("admin@officeverse.dev", "officeverse-dev");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.user.role).toBe("admin");
    expect(Object.keys(res.user)).not.toContain("passwordHash");
    expect(res.token.length).toBeGreaterThan(20);
    // the issued token resolves back to the same identity
    expect(devResolve(res.token)?.user.role).toBe("admin");
  });

  it("the login result's expiresAt is accepted by setSessionCookie's parser (no throw → ov_session is issued)", async () => {
    const res = await login("hr@officeverse.dev", "officeverse-dev");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // loginFn does: setSessionCookie(res.token, res.expiresAt) → cookieOpts →
    // new Date(istWallClockToEpochMs(res.expiresAt)). Before the fix this threw.
    expect(() => istWallClockToEpochMs(res.expiresAt)).not.toThrow();
    expect(new Date(istWallClockToEpochMs(res.expiresAt)).toString()).not.toBe("Invalid Date");
  });

  it("wrong password → invalid_credentials (no enumeration)", async () => {
    const res = await login("agent@officeverse.dev", "wrong");
    expect(res).toEqual({ ok: false, code: "invalid_credentials" });
  });

  it("unknown user → invalid_credentials (same shape as wrong password)", async () => {
    const res = await login("ghost@example.com", "officeverse-dev");
    expect(res).toEqual({ ok: false, code: "invalid_credentials" });
  });

  it("logout() invalidates the dev session server-side", async () => {
    const res = await login("closer@officeverse.dev", "officeverse-dev");
    if (!res.ok) throw new Error("login failed");
    expect(devResolve(res.token)).not.toBeNull();
    await logout(res.token);
    expect(devResolve(res.token)).toBeNull();
  });
});
