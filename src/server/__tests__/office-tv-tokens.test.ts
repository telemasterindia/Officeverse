import { describe, expect, it } from "vitest";
import {
  DISPLAY_TOKEN_PREFIX,
  generateDisplayToken,
  hashDisplayToken,
  scopeAllows,
  tokenMatchesHash,
} from "../live/tokens";

describe("display tokens", () => {
  it("generates a prefixed random token and a matching sha-256 hash", () => {
    const a = generateDisplayToken();
    const b = generateDisplayToken();
    expect(a.token.startsWith(DISPLAY_TOKEN_PREFIX)).toBe(true);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashDisplayToken(a.token));
    expect(a.tokenHash).toHaveLength(64);
    expect(a.tokenPrefix).toBe(a.token.slice(0, 12));
  });

  it("tokenMatchesHash is true only for the exact token (constant-time compare)", () => {
    const t = generateDisplayToken();
    expect(tokenMatchesHash(t.token, t.tokenHash)).toBe(true);
    expect(tokenMatchesHash(t.token + "x", t.tokenHash)).toBe(false);
    expect(tokenMatchesHash("", t.tokenHash)).toBe(false);
    expect(tokenMatchesHash(t.token, "")).toBe(false);
    expect(tokenMatchesHash(t.token, "deadbeef")).toBe(false);
  });

  it("scope is read-only: only tv.read_* actions, and only for the tv_read scope", () => {
    expect(scopeAllows("tv_read", "tv.read_state")).toBe(true);
    expect(scopeAllows("tv_read", "tv.read_photo")).toBe(true);
    expect(scopeAllows("tv_read", "lead.update")).toBe(false);
    expect(scopeAllows("tv_read", "payroll.read")).toBe(false);
    expect(scopeAllows("admin", "tv.read_state")).toBe(false);
  });
});
