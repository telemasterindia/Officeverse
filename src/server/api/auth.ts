/**
 * Officeverse — authentication server functions (Phase 14 / 17).
 *
 *   POST  loginFn           → { user } + sets httpOnly session cookie
 *   POST  logoutFn          → { ok }   + clears cookie, revokes DB session
 *   GET   meFn              → { user } | { user: null }
 *   POST  changePasswordFn  → { ok }
 *
 * These are TanStack Start server functions (this repo's chosen API style —
 * there is no file-based server-route support in this version). The internal
 * cron endpoints (/internal/tick, /internal/drain-email) are plain HTTP and are
 * handled in src/server.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { changePassword, currentPublicUser, login, logout } from "../auth/service";
import { HttpError, getAuth, requireUser, requestInfo } from "../context";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "../session";
import { changePasswordSchema, loginSchema } from "../validation";
import type { PublicUser } from "../db/repos/users";

export const loginFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => loginSchema.parse(d))
  .handler(async ({ data }): Promise<{ user: PublicUser }> => {
    const meta = requestInfo();
    const res = await login(data.email, data.password, meta);
    if (!res.ok) {
      if (res.code === "rate_limited") {
        throw new HttpError(429, "Too many attempts. Try again later.", "rate_limited");
      }
      if (res.code === "inactive") {
        throw new HttpError(403, "This account is not active.", "inactive");
      }
      throw new HttpError(401, "Invalid email or password.", "invalid_credentials");
    }
    setSessionCookie(res.token, res.expiresAt);
    return { user: res.user };
  });

export const logoutFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const token = readSessionToken();
    const auth = await getAuth();
    await logout(token, auth?.user);
    clearSessionCookie();
    return { ok: true };
  },
);

export const meFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ user: PublicUser | null }> => {
    const auth = await getAuth();
    if (!auth) return { user: null };
    return { user: await currentPublicUser(auth.user) };
  },
);

export const changePasswordFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => changePasswordSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const user = await requireUser();
    const res = await changePassword(
      user.id,
      data.currentPassword,
      data.newPassword,
      requestInfo(),
    );
    if (!res.ok) throw new HttpError(400, "Current password is incorrect.", "invalid_current");
    clearSessionCookie(); // this session was revoked with the rest
    return { ok: true };
  });
