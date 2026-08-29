/**
 * Officeverse — per-request auth context for server functions (Phase 14 / 18).
 *
 * `getAuth()` resolves the DB-backed session for the current request.
 * `requireUser()` / `requireRole()` are the SECURITY BOUNDARY — every server
 * function that touches data calls one of them. RoleGate on the client is a UX
 * convenience only.
 */
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { HttpError } from "./http-error";
import { devResolve } from "./auth/dev-auth";
import { touchAttendanceSafe } from "./attendance/service";
import { readSessionToken, resolveSession, type SessionContext } from "./session";
import type { User } from "@/lib/db/schema";

export { HttpError };

export type Role = User["role"];

export interface RequestInfo {
  ip: string | null;
  userAgent: string | null;
}

export function requestInfo(): RequestInfo {
  let ip: string | null = null;
  try {
    ip = getRequestIP({ xForwardedFor: true }) ?? null;
  } catch {
    ip = null;
  }
  let ua: string | null = null;
  try {
    ua = getRequestHeader("user-agent") ?? null;
  } catch {
    ua = null;
  }
  return { ip, userAgent: ua };
}

/** Current session or null. Never throws. */
export async function getAuth(): Promise<SessionContext | null> {
  const token = readSessionToken();
  // Local dev fallback (no-op unless NODE_ENV!=production AND no DB configured).
  try {
    const dev = devResolve(token);
    if (dev) return dev;
  } catch {
    /* ignore */
  }
  try {
    const ctx = await resolveSession(token);
    if (ctx) {
      // Phase 10: recompute this employee's attendance from the session facts.
      // Throttled + best-effort; never blocks or breaks the request.
      void touchAttendanceSafe(ctx.user);
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Require an authenticated, active user. Throws HttpError(401). */
export async function requireUser(): Promise<User> {
  const auth = await getAuth();
  if (!auth) throw new HttpError(401, "Authentication required", "unauthenticated");
  return auth.user;
}

/** Require one of `roles`. Throws HttpError(401|403). */
export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new HttpError(403, "Not authorized for this action", "forbidden");
  }
  return user;
}

export const requireAdmin = () => requireRole("admin");
