/**
 * Officeverse — client-callable authentication server functions (Phase 9).
 *
 * Relocated out of `src/server/**` (import-protected from the client bundle).
 * The `.handler()` bodies + their `@/server/*` imports are stripped from the
 * client build by the TanStack Start compiler; only the RPC stub ships.
 *
 *   POST  loginFn           → { user } + sets the httpOnly session cookie
 *   POST  logoutFn          → { ok }   + clears cookie, revokes the session
 *   GET   meFn              → { user | null, devMode }
 *   POST  changePasswordFn  → { ok }   (revokes every session)
 *
 * The session cookie is the ONLY auth state in the browser. Identity, role and
 * validity are decided entirely server-side.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { changePassword, currentPublicUser, login, logout } from "@/server/auth/service";
import { devAuthEnabled } from "@/server/auth/dev-auth";
import { HttpError, getAuth, requireUser, requestInfo } from "@/server/context";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/server/session";
import type { PublicUser } from "@/server/db/repos/users";

const loginInput = z.object({
  email: z.string().trim().toLowerCase().email().max(191),
  password: z.string().min(1).max(200),
});

const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

export const loginFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => loginInput.parse(d))
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
  async (): Promise<{ user: PublicUser | null; devMode: boolean }> => {
    const auth = await getAuth();
    return {
      user: auth ? await currentPublicUser(auth.user) : null,
      devMode: devAuthEnabled(),
    };
  },
);

export const changePasswordFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => changePasswordInput.parse(d))
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
