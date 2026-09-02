/**
 * Officeverse — plain HTTP endpoints that are NOT server functions.
 *
 *   GET  /api/health                    → liveness + readiness status (no secrets)
 *   GET  /api/health?deep=1             → + live DB / migration check (cron secret)
 *   POST /internal/monthly-salary-slips → monthly salary-slip delivery batch
 *                                         (cron secret; dryRun=true by default)
 *   POST /internal/tick                 → reminder scheduler pass   (not built yet)
 *   POST /internal/drain-email          → email-job outbox drain    (not built yet)
 *
 * cPanel / GoDaddy cron calls the /internal/* routes with a shared secret:
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" \
 *     "https://APP/internal/monthly-salary-slips?month=2026-08&run=1"
 *
 * The secret is compared in constant time. There is NO unauthenticated trigger.
 * `handleInternal` returns a Response for these paths, or `null` to fall through
 * to the normal SSR handler.
 */
import { env } from "./env";
import { safeEqual } from "./session";
import { nowIST } from "./time";
import { collectHealth, publicLiveness } from "./health";
import { processMonthlySalarySlips } from "./hr/salary-slip-batch";
import { previousPayrollMonthIST } from "./hr/salary-slip-cron";
import { runDailyTick } from "./notifications/daily-jobs";
import { tvState, tvAssetBytes } from "./live/tv-service";
import { getCompanyLogo } from "./branding/service";
import { HttpError } from "./http-error";
import { isDbConfigured } from "@/lib/db";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Accepts the Phase-4/6 `CRON_SECRET` or the Phase-15 `OFFICEVERSE_CRON_SECRET`
 *  (set them to the same value in production). */
function cronAuthorized(request: Request): boolean {
  const secret = env("CRON_SECRET") ?? env("OFFICEVERSE_CRON_SECRET");
  if (!secret) return false;
  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("secret") ??
    "";
  return provided.length > 0 && safeEqual(provided, secret);
}

export async function handleInternal(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/api/health") {
    const deep = url.searchParams.get("deep") === "1";
    if (deep && !cronAuthorized(request)) return json({ error: "unauthorized" }, 401);
    try {
      const report = await collectHealth({ deep });
      return json(deep ? report : publicLiveness(report));
    } catch {
      return json({ ok: false, service: "officeverse", time: nowIST(), database: "error" }, 503);
    }
  }

  // ---- Office TV (Phase 21): read-only, display-token authenticated --------
  if (path === "/api/office-tv/state") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    const token =
      request.headers.get("x-display-token") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      url.searchParams.get("token") ??
      "";
    const kindParam = url.searchParams.get("kind") ?? undefined;
    const sinceParam = Number(url.searchParams.get("since") ?? "0") || 0;
    try {
      const state = await tvState(token, { kind: kindParam, sinceSeq: sinceParam });
      return json(state);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.code ?? "error", message: err.message }, err.status);
      }
      return json({ error: "tv_state_failed" }, 500);
    }
  }

  if (path === "/api/office-tv/asset") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    const token =
      request.headers.get("x-display-token") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      url.searchParams.get("token") ??
      "";
    const id = Number(url.searchParams.get("id") ?? "0") || 0;
    try {
      const asset = id > 0 ? await tvAssetBytes(token, id) : null;
      if (!asset) return json({ error: "not_found" }, 404);
      return new Response(Buffer.from(asset.bytes), {
        status: 200,
        headers: {
          "content-type": asset.mime,
          "cache-control": "private, max-age=300",
          "content-length": String(asset.bytes.byteLength),
        },
      });
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.code ?? "error" }, err.status);
      }
      return json({ error: "asset_failed" }, 500);
    }
  }

  // Admin UAT §7 — the ONE official company logo, referenced by salary slips,
  // branded emails and printable HR/payroll documents. Public GET (a logo is
  // not sensitive); returns 404 until an Admin uploads one.
  if (path === "/api/branding/logo") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    try {
      const logo = await getCompanyLogo();
      if (!logo) return json({ error: "not_found" }, 404);
      return new Response(new Uint8Array(logo.bytes), {
        status: 200,
        headers: {
          "content-type": logo.mime,
          "cache-control": "public, max-age=300",
          "content-length": String(logo.bytes.byteLength),
        },
      });
    } catch {
      return json({ error: "logo_failed" }, 500);
    }
  }

  if (path === "/internal/monthly-salary-slips") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!cronAuthorized(request)) return json({ error: "unauthorized" }, 401);
    if (!isDbConfigured()) return json({ error: "db_unavailable" }, 503);

    const monthParam = url.searchParams.get("month");
    const month =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : previousPayrollMonthIST();
    // SAFE BY DEFAULT: a preview unless the caller explicitly opts in with run=1
    const dryRun = url.searchParams.get("run") !== "1";

    try {
      const summary = await processMonthlySalarySlips(
        { id: null, role: "system" },
        { month, dryRun },
        { source: "internal_http_cron" },
      );
      return json({ ok: true, dryRun, summary });
    } catch (err) {
      return json(
        {
          ok: false,
          error: "batch_failed",
          message: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        },
        502,
      );
    }
  }

  if (path === "/internal/tick") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!cronAuthorized(request)) return json({ error: "unauthorized" }, 401);
    if (!isDbConfigured()) return json({ error: "db_unavailable" }, 503);
    // SAFE BY DEFAULT: a dry-run count unless the caller opts in with run=1.
    const dryRun = url.searchParams.get("run") !== "1";
    try {
      const result = await runDailyTick({ dryRun });
      return json(result);
    } catch (err) {
      return json(
        {
          ok: false,
          error: "tick_failed",
          message: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        },
        502,
      );
    }
  }

  if (path === "/internal/drain-email") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!cronAuthorized(request)) return json({ error: "unauthorized" }, 401);
    // The email-job outbox drain worker is a future phase (no provider wired).
    return json(
      {
        ok: false,
        endpoint: path,
        status: "not_implemented",
        note: "Email jobs are enqueued (see /internal/tick). The delivery worker + provider are a future phase.",
      },
      501,
    );
  }

  return null;
}
