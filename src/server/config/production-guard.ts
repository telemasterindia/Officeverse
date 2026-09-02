/**
 * Officeverse — production configuration guard.
 *
 * A single place that answers: "is this process safe to serve production
 * traffic?". It validates ONLY what is genuinely mandatory for a secure
 * production deployment. Local development and the local dryrun DB continue to
 * work untouched — the guard is a no-op unless `NODE_ENV=production`.
 *
 * SECRET-SAFE: this module only ever reports the NAMES of missing variables. It
 * never reads, returns, logs or interpolates a value (no DSN, no password, no
 * cron secret, no API key). `env()` is used purely for presence checks.
 *
 * Expected production configuration (GoDaddy / cPanel) — see `.env.example`:
 *   NODE_ENV=production
 *   APP_URL=https://your-officeverse-domain
 *   DATABASE_URL=mysql://USER:PASS@HOST:3306/DB     (or DB_HOST + DB_NAME + DB_USER)
 *   CRON_SECRET + OFFICEVERSE_CRON_SECRET           (same long random value)
 *   TRUSTED_PROXY_IPS=127.0.0.1/32,::1/128          (loopback Passenger/Apache hop)
 */
import { env, isProd } from "../env";

export interface ConfigRequirement {
  /** the primary variable name shown to an operator */
  name: string;
  /** why it is mandatory (non-secret, safe to surface) */
  why: string;
  /** true when the requirement is satisfied by the current environment */
  present: () => boolean;
}

function dbConfigured(): boolean {
  if (env("DATABASE_URL")) return true;
  return Boolean(env("DB_HOST") && env("DB_NAME") && env("DB_USER"));
}

/** The MANDATORY production requirements. Missing any of these = refuse to serve. */
export const PRODUCTION_REQUIREMENTS: readonly ConfigRequirement[] = [
  {
    name: "APP_URL",
    why: "absolute origin for links, cookies and CSRF validation",
    present: () => Boolean(env("APP_URL")) && !/localhost|127\.0\.0\.1/.test(env("APP_URL") ?? ""),
  },
  {
    name: "DATABASE_URL (or DB_HOST + DB_NAME + DB_USER)",
    why: "the application database connection",
    present: dbConfigured,
  },
  {
    name: "CRON_SECRET / OFFICEVERSE_CRON_SECRET",
    why: "shared secret protecting every /internal/* automation endpoint",
    present: () => Boolean(env("CRON_SECRET") || env("OFFICEVERSE_CRON_SECRET")),
  },
];

/** Advisory (not fatal) — a misconfiguration that degrades a control but does
 *  not open a hole. Surfaced in the health report; never blocks startup. */
export const PRODUCTION_ADVISORIES: readonly ConfigRequirement[] = [
  {
    name: "TRUSTED_PROXY_IPS",
    why: "attendance / office-IP gate: which reverse proxies may set X-Forwarded-For. Empty is fail-closed (safe) but the office gate then never matches, so no one is attendance-eligible.",
    present: () => Boolean(env("TRUSTED_PROXY_IPS")),
  },
  {
    name: "OFFICEVERSE_DOCUMENT_ROOT",
    why: "durable salary-slip storage path outside the web root (DOCUMENT_STORAGE_PROVIDER=filesystem)",
    present: () =>
      (env("DOCUMENT_STORAGE_PROVIDER") ?? "memory") !== "filesystem" ||
      Boolean(env("OFFICEVERSE_DOCUMENT_ROOT")),
  },
];

/** Names of the MANDATORY requirements that are not satisfied. Empty in dev. */
export function missingProductionConfig(): string[] {
  if (!isProd()) return [];
  return PRODUCTION_REQUIREMENTS.filter((r) => !safe(r.present)).map((r) => r.name);
}

/** Names of the ADVISORY requirements that are not satisfied. Empty in dev. */
export function productionConfigAdvisories(): string[] {
  if (!isProd()) return [];
  return PRODUCTION_ADVISORIES.filter((r) => !safe(r.present)).map((r) => r.name);
}

function safe(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

/**
 * Throw if this is a production process missing mandatory configuration.
 * The message contains only variable NAMES — never a value. No-op in dev.
 */
export function assertProductionConfig(): void {
  const missing = missingProductionConfig();
  if (missing.length === 0) return;
  throw new Error(
    `Production configuration incomplete — refusing to start. Missing / invalid: ${missing.join(
      ", ",
    )}. Set these in the cPanel environment (values only — see .env.example). No secret values are printed.`,
  );
}
