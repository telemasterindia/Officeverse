/**
 * Officeverse — production health / readiness snapshot (Phase 17).
 *
 * Reports STATUS ONLY. It never returns a password, API key, session secret,
 * cron secret, connection string or any credential value — only booleans and
 * short non-secret labels ("configured" / "not-configured" / "reachable" …).
 *
 * Two consumers:
 *   - GET /api/health   (public liveness; internal-routes.ts)
 *   - systemStatusFn    (Admin-only; richer, still secret-free)
 */
import { getPool, isDbConfigured } from "@/lib/db";
import { env, isProd } from "./env";
import { describeEmailProvider } from "./email/provider";
import { describeDocumentStorage } from "./hr/salary-slip-storage";
import journal from "../../drizzle/meta/_journal.json";

/** number of migrations bundled with this build (the canonical schema history). */
export const LOCAL_MIGRATION_COUNT: number = Array.isArray(
  (journal as { entries?: unknown[] }).entries,
)
  ? (journal as { entries: unknown[] }).entries.length
  : 0;

export interface HealthReport {
  service: "officeverse";
  time: string;
  nodeEnv: string;
  /** cloudflare-module (default) vs node-server (GoDaddy) — build-time only */
  runtimeHint: "unknown";
  database: {
    configured: boolean;
    /** only populated when `deep` + a pool exists; never contains the DSN */
    reachable?: boolean | null;
    error?: string | null;
  };
  migrations: {
    /** number of local migration files bundled with this build */
    localCount: number;
    /** applied count from `__drizzle_migrations`, when deep-checked */
    appliedCount?: number | null;
    upToDate?: boolean | null;
  };
  session: {
    cookieName: string;
    /** `secure` cookies are on iff NODE_ENV=production */
    secureCookies: boolean;
    httpOnly: true;
    sameSite: "lax";
  };
  email: { configured: boolean; provider: string | null; reason: string | null };
  storage: { provider: string; rootConfigured: boolean; durable: boolean };
  automation: { cronSecretConfigured: boolean };
}

export interface HealthOptions {
  /** also touch the DB pool (SELECT 1 + migration table). Off by default. */
  deep?: boolean;
}

export async function collectHealth(opts: HealthOptions = {}): Promise<HealthReport> {
  const emailStatus = describeEmailProvider();
  const storageStatus = describeDocumentStorage();
  const dbConfigured = isDbConfigured();

  const report: HealthReport = {
    service: "officeverse",
    time: new Date().toISOString(),
    nodeEnv: env("NODE_ENV") ?? "development",
    runtimeHint: "unknown",
    database: { configured: dbConfigured },
    migrations: { localCount: LOCAL_MIGRATION_COUNT },
    session: {
      cookieName: env("SESSION_COOKIE_NAME") ?? "ov_session",
      secureCookies: isProd(),
      httpOnly: true,
      sameSite: "lax",
    },
    email: {
      configured: emailStatus.configured,
      provider: emailStatus.name,
      reason: emailStatus.reason,
    },
    storage: {
      provider: storageStatus.provider,
      rootConfigured: storageStatus.rootConfigured,
      durable: storageStatus.provider === "filesystem" && storageStatus.rootConfigured,
    },
    automation: {
      cronSecretConfigured: Boolean(env("OFFICEVERSE_CRON_SECRET") || env("CRON_SECRET")),
    },
  };

  if (opts.deep && dbConfigured) {
    try {
      const pool = getPool();
      await pool.query("SELECT 1");
      report.database.reachable = true;
      try {
        const [rows] = (await pool.query(
          "SELECT COUNT(*) AS n FROM `__drizzle_migrations`",
        )) as unknown as [Array<{ n: number }>];
        const appliedCount = Number(rows?.[0]?.n ?? 0);
        report.migrations.appliedCount = appliedCount;
        report.migrations.upToDate = appliedCount >= report.migrations.localCount;
      } catch {
        // table missing → nothing applied yet
        report.migrations.appliedCount = 0;
        report.migrations.upToDate = report.migrations.localCount === 0;
      }
    } catch (err) {
      report.database.reachable = false;
      report.database.error =
        err instanceof Error ? err.message.replace(/password[^,)]*/gi, "password=***") : "unknown";
    }
  }

  return report;
}

/** Compact public liveness view — no counts that could aid fingerprinting. */
export function publicLiveness(report: HealthReport) {
  return {
    ok: true,
    service: report.service,
    time: report.time,
    database: report.database.configured ? "configured" : "not-configured",
    migrations: report.migrations.localCount > 0 ? "present" : "unknown",
    email_provider: report.email.configured ? "configured" : "not-configured",
    storage: report.storage.durable ? "configured" : "not-configured",
    automation: report.automation.cronSecretConfigured ? "configured" : "not-configured",
  };
}
