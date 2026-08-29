/**
 * Officeverse — server-side sessions (Phase 14).
 *
 * DB-backed opaque sessions: the httpOnly cookie carries a random token; the
 * authoritative record lives in `sessions`. Logout deletes/revokes the row, so
 * revocation is immediate. The token is stored hashed (SHA-256) so a DB leak
 * does not hand out live sessions.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { CookieSerializeOptions } from "cookie-es";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { getDb } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";
import { config, isProd } from "./env";
import { nowIST, istWallClockToEpochMs } from "./time";

const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function expiryWallClock(hoursFromNow = config.sessionTtlHours()): string {
  return nowIST(Date.now() + hoursFromNow * 3_600_000);
}

export interface SessionContext {
  user: User;
  sessionId: string; // hashed token (PK)
  expiresAt: string;
}

/* -------------------------------- cookie -------------------------------- */

function cookieOpts(expiresWall?: string): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    ...(expiresWall ? { expires: new Date(istWallClockToEpochMs(expiresWall)) } : {}),
  };
}

export function setSessionCookie(token: string, expiresWall: string): void {
  setCookie(config.sessionCookieName(), token, cookieOpts(expiresWall));
}

export function clearSessionCookie(): void {
  deleteCookie(config.sessionCookieName(), cookieOpts());
}

export function readSessionToken(): string | undefined {
  return getCookie(config.sessionCookieName());
}

/* ------------------------------ lifecycle ------------------------------ */

export interface SessionOfficeContext {
  /** server-observed public request IP at login (already normalized) */
  originIp?: string | null;
  /** matched office_networks.id, or null when the login was remote */
  officeNetworkId?: number | null;
  /** true only for an office-network login of an attendance-tracked role */
  attendanceEligible?: boolean;
}

export async function createSession(
  userId: number,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  office: SessionOfficeContext = {},
): Promise<{ token: string; expiresAt: string }> {
  const token = newToken();
  const id = hashToken(token);
  const now = nowIST();
  const expiresAt = expiryWallClock();
  await getDb()
    .insert(sessions)
    .values({
      id,
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      ip: meta.ip?.slice(0, 45) ?? null,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
      revokedAt: null,
      originIp: (office.originIp ?? meta.ip ?? null)?.slice(0, 45) ?? null,
      officeNetworkId: office.officeNetworkId ?? null,
      attendanceEligible: office.attendanceEligible === true,
    });
  return { token, expiresAt };
}

/** Resolve the session for a raw cookie token, or null. Bumps last_seen_at. */
export async function resolveSession(token: string | undefined): Promise<SessionContext | null> {
  if (!token) return null;
  const id = hashToken(token);
  const now = nowIST();
  const rows = await getDb()
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (istWallClockToEpochMs(row.session.expiresAt) <= istWallClockToEpochMs(now)) return null;
  if (row.user.status !== "active") return null;

  // throttled last-seen bump (once per ~5 min)
  if (istWallClockToEpochMs(now) - istWallClockToEpochMs(row.session.lastSeenAt) > 5 * 60_000) {
    await getDb().update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
  }
  return { user: row.user, sessionId: id, expiresAt: row.session.expiresAt };
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await getDb()
    .update(sessions)
    .set({ revokedAt: nowIST() })
    .where(eq(sessions.id, hashToken(token)));
}

export async function revokeAllForUser(userId: number): Promise<void> {
  await getDb().update(sessions).set({ revokedAt: nowIST() }).where(eq(sessions.userId, userId));
}

/** Housekeeping: drop expired / long-revoked rows (called from the scheduler). */
export async function purgeExpiredSessions(): Promise<number> {
  const cutoff = nowIST(Date.now() - 7 * 86_400_000);
  const res = await getDb()
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, nowIST()), lt(sessions.revokedAt, cutoff)));
  // mysql2 returns [ResultSetHeader]; affectedRows is best-effort
  return (res as unknown as { affectedRows?: number }).affectedRows ?? 0;
}

/** Constant-time string compare (for CRON_SECRET etc.). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
