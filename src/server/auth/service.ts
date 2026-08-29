/**
 * Officeverse — authentication service (Phase 14).
 *
 * Pure-ish business logic on top of the repos. No HTTP concerns here — the
 * server functions in ../api/auth.ts own cookies and request context.
 */
import { recordAudit } from "../audit";
import { hashPassword, needsRehash, verifyPassword } from "../password";
import { devAuthEnabled, devLogin, devRevoke } from "./dev-auth";
import { checkLoginRate, clearLoginRate, recordLoginFail } from "./rate-limit";
import {
  findUserByEmail,
  getUserById,
  getUserPhotoUrl,
  setPasswordHash,
  toPublicUser,
  touchLogin,
  type PublicUser,
} from "../db/repos/users";
import { createSession, revokeAllForUser, revokeSession } from "../session";
import { listActiveNetworks } from "../db/repos/office-networks";
import { matchOfficeNetwork, normalizeIp } from "../net/cidr";
import { evaluateAccess } from "../net/access";
import type { User } from "@/lib/db/schema";

export type LoginResult =
  | {
      ok: true;
      user: PublicUser;
      token: string;
      expiresAt: string;
      /** office-network context resolved SERVER-SIDE from the request IP */
      attendanceEligible: boolean;
      officeNetworkId: number | null;
    }
  | {
      ok: false;
      code: "invalid_credentials" | "rate_limited" | "inactive" | "remote_denied";
      retryAfterSec?: number;
    };

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Authenticate + open a session. Uniform "invalid_credentials" for unknown
 * email and wrong password (no user enumeration). Rehashes bcrypt→argon2 on a
 * successful login when possible.
 */
export async function login(
  email: string,
  password: string,
  meta: RequestMeta = {},
): Promise<LoginResult> {
  // Local dev fallback — active only when NODE_ENV!=production AND no DB.
  if (devAuthEnabled()) {
    const dev = devLogin(email, password);
    if (dev) {
      // Dev Mode has no DB and therefore no office_networks — the IP gate is
      // inert here (no bypass added; there is simply no policy to enforce).
      return {
        ok: true,
        user: toPublicUser(dev.user, null),
        token: dev.token,
        expiresAt: dev.expiresAt,
        attendanceEligible: false,
        officeNetworkId: null,
      };
    }
    // dev mode, no user store to consult → uniform rejection, never a 500
    return { ok: false, code: "invalid_credentials" };
  }

  const rateKey = `${meta.ip ?? "?"}|${email}`;
  const rate = checkLoginRate(rateKey);
  if (!rate.ok) return { ok: false, code: "rate_limited", retryAfterSec: rate.retryAfterSec };

  const user = await findUserByEmail(email);
  const ok = user ? await verifyPassword(user.passwordHash, password) : false;

  if (!user || !ok) {
    recordLoginFail(rateKey);
    return { ok: false, code: "invalid_credentials" };
  }
  if (user.status !== "active") {
    return { ok: false, code: "inactive" };
  }

  // ---- Phase 23: office-network access gate (server-observed IP only) -------
  const originIp = normalizeIp(meta.ip);
  const activeNetworks = await listActiveNetworks();
  const matched = originIp
    ? matchOfficeNetwork(
        originIp,
        activeNetworks.map((n) => ({
          id: n.id,
          name: n.name,
          cidr: n.cidr,
          process: n.process ?? null,
          enabled: n.enabled,
        })),
        user.process,
      )
    : null;
  const access = evaluateAccess({
    role: user.role,
    officeMatch: matched != null,
    policyConfigured: activeNetworks.length > 0,
  });
  if (!access.crmAllowed) {
    // no rate-count bump — the credentials were valid; the network was not
    return { ok: false, code: "remote_denied" };
  }

  clearLoginRate(rateKey);

  if (await needsRehash(user.passwordHash)) {
    try {
      await setPasswordHash(user.id, await hashPassword(password));
    } catch {
      /* non-fatal — keep the working bcrypt hash */
    }
  }

  await touchLogin(user.id);
  const { token, expiresAt } = await createSession(user.id, meta, {
    originIp,
    officeNetworkId: matched?.id ?? null,
    attendanceEligible: access.attendanceEligible,
  });
  const photoUrl = await getUserPhotoUrl(user);

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return {
    ok: true,
    user: toPublicUser(user, photoUrl),
    token,
    expiresAt,
    attendanceEligible: access.attendanceEligible,
    officeNetworkId: matched?.id ?? null,
  };
}

export async function logout(token: string | undefined, actor?: User): Promise<void> {
  if (devRevoke(token)) return; // dev session — nothing in the DB
  await revokeSession(token);
  if (actor) {
    await recordAudit({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: "auth.logout",
      entityType: "user",
      entityId: actor.id,
    });
  }
}

export async function currentPublicUser(user: User): Promise<PublicUser> {
  return toPublicUser(user, await getUserPhotoUrl(user));
}

/** Self-service password change. */
export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
  meta: RequestMeta = {},
): Promise<{ ok: true } | { ok: false; code: "invalid_current" }> {
  const user = await getUserById(userId);
  if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
    return { ok: false, code: "invalid_current" };
  }
  await setPasswordHash(userId, await hashPassword(newPassword));
  await revokeAllForUser(userId); // force re-login everywhere else
  await recordAudit({
    actorUserId: userId,
    actorRole: user.role,
    action: "password.change",
    entityType: "user",
    entityId: userId,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}
