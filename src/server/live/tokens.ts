/**
 * Officeverse — Live Experience: display-token crypto (Phase 21).
 *
 * A TV NEVER uses an Admin account. It carries a bearer "display token" that is:
 *   - random (32 bytes, base64url) and shown to the Admin exactly ONCE
 *   - stored only as a sha-256 hash (never the raw value)
 *   - read-only scope ("tv_read") — no CRM mutation, no payroll, no HR, no
 *     user-management, no points mutation
 *   - revocable + rotatable (see displays-service.ts)
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const DISPLAY_SCOPES = ["tv_read"] as const;
export type DisplayScope = (typeof DISPLAY_SCOPES)[number];

export const DISPLAY_TOKEN_PREFIX = "ovtv_";

/** Actions a display token may perform. Deliberately tiny. */
export const DISPLAY_ALLOWED_ACTIONS = ["tv.read_state", "tv.read_photo"] as const;
export type DisplayAction = (typeof DISPLAY_ALLOWED_ACTIONS)[number];

export function scopeAllows(scope: string, action: string): boolean {
  if (scope !== "tv_read") return false;
  return (DISPLAY_ALLOWED_ACTIONS as readonly string[]).includes(action);
}

export interface GeneratedDisplayToken {
  /** the raw bearer token — returned to the Admin ONCE, never persisted */
  token: string;
  tokenHash: string;
  tokenPrefix: string;
}

export function hashDisplayToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateDisplayToken(): GeneratedDisplayToken {
  const token = DISPLAY_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashDisplayToken(token),
    tokenPrefix: token.slice(0, 12),
  };
}

/** Constant-time compare of a candidate raw token against a stored hash. */
export function tokenMatchesHash(candidate: string, storedHash: string): boolean {
  const a = Buffer.from(hashDisplayToken(candidate), "hex");
  const b = Buffer.from(storedHash ?? "", "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
