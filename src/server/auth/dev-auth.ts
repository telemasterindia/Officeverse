/**
 * Officeverse — DEVELOPMENT-ONLY authentication fallback (Phase 9).
 *
 * Real authentication is the DB `users` table + DB `sessions` (see
 * ../auth/service.ts + ../session.ts). This module lets a developer log in
 * LOCALLY, through the exact same cookie/session/`requireUser` path, when no
 * MySQL database is configured yet.
 *
 * It is STRUCTURALLY impossible to use in production:
 *   - `isProd()` (NODE_ENV === "production")            → disabled
 *   - a real DB is configured (`isDbConfigured()`)      → disabled
 *   - `OFFICEVERSE_DEV_LOGIN=0`                          → disabled
 *
 * The dev "session store" is an in-memory Map on the server. The browser still
 * holds only an opaque httpOnly cookie token — it cannot forge identity, cannot
 * change role, and logout still invalidates the session server-side.
 *
 * No real/production passwords are hard-coded. The shared dev password is
 * `OFFICEVERSE_DEV_PASSWORD` or the obvious default below.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isDbConfigured } from "@/lib/db";
import { isProd } from "../env";
import { epochMsToIstWallClock } from "../time";
import type { User } from "@/lib/db/schema";

export function devAuthEnabled(): boolean {
  if (isProd()) return false;
  if (isDbConfigured()) return false;
  return process.env["OFFICEVERSE_DEV_LOGIN"] !== "0";
}

function devPassword(): string {
  return process.env["OFFICEVERSE_DEV_PASSWORD"]?.trim() || "officeverse-dev";
}

interface DevSeed {
  email: string;
  fullName: string;
  role: User["role"];
  process: User["process"];
}

/** Development identities — mirror the four Officeverse roles. */
export const DEV_USERS: readonly DevSeed[] = [
  { email: "admin@officeverse.dev", fullName: "Dev Admin", role: "admin", process: "US" },
  { email: "agent@officeverse.dev", fullName: "Dev Agent", role: "agent", process: "US" },
  { email: "closer@officeverse.dev", fullName: "Dev Closer", role: "closer", process: "US" },
  { email: "hr@officeverse.dev", fullName: "Dev HR", role: "hr", process: "IN" },
];

/** synthetic negative id — can never collide with a real `users.id` (unsigned) */
const idForIndex = (idx: number): number => -1000 - idx;
const indexForId = (id: number): number => -1000 - id;

function buildUser(idx: number): User {
  const seed = DEV_USERS[idx]!;
  return {
    id: idForIndex(idx),
    email: seed.email,
    passwordHash: "",
    fullName: seed.fullName,
    role: seed.role,
    process: seed.process,
    status: "active",
    phone: null,
    photoAssetId: null,
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: "2020-01-01 00:00:00",
    updatedAt: "2020-01-01 00:00:00",
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const store = new Map<string, { idx: number; expiresAtMs: number }>();
const DEV_TTL_MS = 12 * 3_600_000;

export interface DevLoginResult {
  token: string;
  user: User;
  expiresAt: string;
}

/** Returns a session for a valid dev credential, else null. No-op unless enabled. */
export function devLogin(email: string, password: string): DevLoginResult | null {
  if (!devAuthEnabled()) return null;
  const e = email.trim().toLowerCase();
  const idx = DEV_USERS.findIndex((u) => u.email === e);
  if (idx < 0) return null;
  if (!constantTimeEqual(password, devPassword())) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAtMs = Date.now() + DEV_TTL_MS;
  store.set(hashToken(token), { idx, expiresAtMs });
  // The session cookie stack (setSessionCookie → istWallClockToEpochMs) expects
  // the Officeverse IST wall-clock format "YYYY-MM-DD HH:MM:SS", exactly as the
  // real DB path's createSession() produces. A UTC ISO string (…Z) would throw
  // in the strict parser. Same instant, correct representation.
  return { token, user: buildUser(idx), expiresAt: epochMsToIstWallClock(expiresAtMs) };
}

export interface DevSessionContext {
  user: User;
  sessionId: string;
  expiresAt: string;
}

/** Resolve a dev session token, or null (expired / unknown / disabled). */
export function devResolve(
  token: string | undefined,
  nowMs: number = Date.now(),
): DevSessionContext | null {
  if (!token || !devAuthEnabled()) return null;
  const id = hashToken(token);
  const rec = store.get(id);
  if (!rec) return null;
  if (rec.expiresAtMs <= nowMs) {
    store.delete(id);
    return null;
  }
  return {
    user: buildUser(rec.idx),
    sessionId: id,
    expiresAt: new Date(rec.expiresAtMs).toISOString(),
  };
}

/** Invalidate a dev session. Returns true if one was removed. */
export function devRevoke(token: string | undefined): boolean {
  if (!token) return false;
  return store.delete(hashToken(token));
}

/** test helper — clears every dev session */
export function __resetDevSessions(): void {
  store.clear();
}

export { indexForId as __indexForId };
