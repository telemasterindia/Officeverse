/**
 * Officeverse — TEMPORARY production login diagnostic (admin-login incident).
 *
 * ⚠️ DELETE THIS FILE AND `src/routes/api/diag/login.ts` ONCE THE PRODUCTION
 * ADMIN LOGIN ISSUE IS RESOLVED. This is not meant to be permanent surface
 * area — it exists only to answer, from inside the actual deployed runtime,
 * one narrow question that could not be answered locally or by the read-only
 * phpMyAdmin check: "does THIS deployment, against THIS database, actually
 * reach verifyPassword() and get the expected result?"
 *
 * Gated by a dedicated shared secret (OFFICEVERSE_DIAG_SECRET) — NOT a user
 * session. That's deliberate: the whole point is to work when normal login
 * (and therefore a session) is unavailable, mirroring the existing
 * shared-secret pattern already accepted in this codebase for the same
 * reason (see ../hr/salary-slip-cron.ts). The endpoint does nothing (503)
 * until OFFICEVERSE_DIAG_SECRET is explicitly set in Vercel; unset it (or
 * delete these two files) to fully disable.
 *
 * Deliberately hardcodes the ONE email and ONE candidate password already
 * circulating in this incident, rather than accepting either as a request
 * parameter. Accepting them as input would turn a "temporary diagnostic"
 * into a standing user-enumeration / password-verification oracle — exactly
 * the kind of new attack surface this must not introduce, even behind a
 * secret.
 *
 * NEVER returns or logs: the password, the stored hash (full or partial),
 * or any DB credential. Only non-secret metadata (commit SHA, DB host/name,
 * row existence, booleans).
 */
import { env } from "../env";
import { HttpError } from "../http-error";
import { findUserByEmail } from "../db/repos/users";
import { verifyPassword } from "../password";
import { safeSecretEqual } from "../hr/salary-slip-cron";

const DIAG_EMAIL = "admin@officeverse.local";
const DIAG_PASSWORD_CANDIDATE = "Officeverse#UAT1";

export interface LoginDiagnosticResult {
  /** process.env.VERCEL_GIT_COMMIT_SHA — the commit this running instance was built from */
  commit: string | null;
  /** process.env.VERCEL_ENV — "production" | "preview" | "development" */
  vercelEnv: string | null;
  /** DB host + database name only — never user/password */
  db: { host: string | null; database: string | null };
  adminRowExists: boolean;
  adminRowRole: string | null;
  adminRowStatus: string | null;
  /** true once verifyPassword() was actually invoked (false only if no row was found to check) */
  verifyReached: boolean;
  /** verifyPassword(storedHash, "Officeverse#UAT1") — true/false only */
  verifyResult: boolean;
}

function dbTarget(): { host: string | null; database: string | null } {
  const url = env("DATABASE_URL");
  if (url) {
    try {
      const u = new URL(url);
      return { host: u.hostname || null, database: u.pathname.replace(/^\//, "") || null };
    } catch {
      return { host: null, database: null }; // never fall through to printing the raw string
    }
  }
  return { host: env("DB_HOST") ?? null, database: env("DB_NAME") ?? null };
}

export async function runLoginDiagnostic(input: {
  secret: string;
}): Promise<LoginDiagnosticResult> {
  const expected = env("OFFICEVERSE_DIAG_SECRET");
  if (!expected) {
    throw new HttpError(503, "Diagnostic is not configured", "diag_not_configured");
  }
  if (typeof input.secret !== "string" || !safeSecretEqual(input.secret, expected)) {
    throw new HttpError(401, "Invalid diagnostic credentials", "diag_forbidden");
  }

  const user = await findUserByEmail(DIAG_EMAIL);
  const verifyReached = !!user;
  const verifyResult = user
    ? await verifyPassword(user.passwordHash, DIAG_PASSWORD_CANDIDATE)
    : false;

  return {
    commit: env("VERCEL_GIT_COMMIT_SHA") ?? null,
    vercelEnv: env("VERCEL_ENV") ?? null,
    db: dbTarget(),
    adminRowExists: !!user,
    adminRowRole: user?.role ?? null,
    adminRowStatus: user?.status ?? null,
    verifyReached,
    verifyResult,
  };
}
