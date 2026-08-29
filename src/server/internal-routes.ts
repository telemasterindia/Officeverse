/**
 * Officeverse — plain HTTP endpoints that are NOT server functions.
 *
 *   GET  /api/health          → liveness + config presence (no secrets)
 *   POST /internal/tick       → scheduler pass          (CRON_SECRET)
 *   POST /internal/drain-email→ email worker pass       (CRON_SECRET)
 *
 * cPanel cron calls the /internal/* routes with:
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://APP/internal/tick
 *
 * `handleInternal` returns a Response for these paths, or `null` to let the
 * request fall through to the normal SSR handler.
 */
import { env } from "./env";
import { safeEqual } from "./session";
import { nowIST } from "./time";
import { isDbConfigured } from "@/lib/db";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function cronAuthorized(request: Request): boolean {
  const secret = env("CRON_SECRET");
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
    return json({
      ok: true,
      service: "officeverse",
      time: nowIST(),
      db: isDbConfigured() ? "configured" : "not-configured",
    });
  }

  if (path === "/internal/tick" || path === "/internal/drain-email") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!cronAuthorized(request)) return json({ error: "unauthorized" }, 401);

    // Real implementations land in Phase 15 (scheduler) and Phase 16 (email worker).
    return json(
      {
        ok: false,
        endpoint: path,
        status: "not_implemented",
        note: "Scheduler / email worker are implemented in a later phase.",
      },
      501,
    );
  }

  return null;
}
