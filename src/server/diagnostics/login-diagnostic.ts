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
 * row existence, booleans, and — for a DB failure only — the driver's short
 * error code, e.g. "ETIMEDOUT" / "ER_ACCESS_DENIED_ERROR", never its message
 * text, which can itself embed a host or username).
 *
 * Deliberately dependency-free beyond the core auth/db modules the real
 * login path already uses. An earlier revision imported `safeSecretEqual`
 * from ../hr/salary-slip-cron.ts to avoid duplicating ~10 lines — but that
 * module transitively pulls in the entire payroll/email/PDF/storage/
 * branding subsystem. For a "temporary, minimal-footprint" diagnostic that
 * MUST work even when something else in production is broken, taking on
 * that whole graph (and every failure mode in it) just to reuse one
 * constant-time comparison was the wrong trade. Inlined below instead.
 */
import { timingSafeEqual } from "node:crypto";
import { env } from "../env";
import { HttpError } from "../http-error";
import { findUserByEmail } from "../db/repos/users";
import { verifyPassword } from "../password";

const DIAG_EMAIL = "admin@officeverse.local";
const DIAG_PASSWORD_CANDIDATE = "Officeverse#UAT1";

/** Constant-time secret comparison (same logic as salary-slip-cron.ts's safeSecretEqual). */
function safeSecretEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b); // still run a compare to avoid an early-exit timing signal
    return false;
  }
  return timingSafeEqual(a, b);
}

export interface LoginDiagnosticResult {
  /** process.env.VERCEL_GIT_COMMIT_SHA — the commit this running instance was built from */
  commit: string | null;
  /** process.env.VERCEL_ENV — "production" | "preview" | "development" */
  vercelEnv: string | null;
  /** DB host + database name only — never user/password */
  db: { host: string | null; database: string | null };
  /** short driver error code (e.g. "ETIMEDOUT") if the DB lookup itself failed; null otherwise */
  dbError: string | null;
  adminRowExists: boolean;
  adminRowRole: string | null;
  adminRowStatus: string | null;
  /** true once verifyPassword() was actually invoked (false if no row was found, or the DB lookup failed) */
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

  // The DB lookup is the one part of this diagnostic that can genuinely fail
  // at runtime (bad/missing credentials, network, wrong host) — which is
  // exactly the kind of thing this diagnostic exists to surface. Isolate it
  // so a DB failure comes back as a labeled `dbError`, not an opaque 500.
  let user: Awaited<ReturnType<typeof findUserByEmail>>;
  let dbError: string | null = null;
  try {
    user = await findUserByEmail(DIAG_EMAIL);
  } catch (err) {
    // Log ONLY the driver's short error code/class — never `.message`,
    // which for connection errors can embed a host, port, or username.
    const code =
      (err && typeof err === "object" && "code" in err && typeof err.code === "string"
        ? err.code
        : undefined) ?? (err instanceof Error ? err.name : "unknown_error");
    console.error("[login-diagnostic] DB lookup failed:", code);
    dbError = code;
    user = undefined;
  }

  const verifyReached = !!user;
  const verifyResult = user
    ? await verifyPassword(user.passwordHash, DIAG_PASSWORD_CANDIDATE)
    : false;

  return {
    commit: env("VERCEL_GIT_COMMIT_SHA") ?? null,
    vercelEnv: env("VERCEL_ENV") ?? null,
    db: dbTarget(),
    dbError,
    adminRowExists: !!user,
    adminRowRole: user?.role ?? null,
    adminRowStatus: user?.status ?? null,
    verifyReached,
    verifyResult,
  };
}
