/**
 * Officeverse — TEMPORARY production login diagnostic (admin-login incident).
 *
 * ⚠️ DELETE THIS FILE AND `src/server/diagnostics/login-diagnostic.ts` ONCE
 * THE INCIDENT IS RESOLVED. See login-diagnostic.ts for full rationale and
 * exactly what this does and does not reveal.
 *
 *   GET /api/diag/login
 *     Header:  X-Diag-Token: <OFFICEVERSE_DIAG_SECRET>   (the ONLY way to
 *       pass it — deliberately no query-string fallback: a secret in the URL
 *       ends up in Vercel/browser access logs and history. Call it from the
 *       browser DevTools console (no terminal needed):
 *         fetch('/api/diag/login', { headers: { 'x-diag-token': '...' } })
 *           .then(r => r.json()).then(console.log)
 *
 * 503 until OFFICEVERSE_DIAG_SECRET is set in Vercel Production — inert by
 * default. 401 on a missing/wrong secret, with no other detail. Every
 * response carries `Cache-Control: no-store` so nothing here is ever cached
 * (CDN, browser, or otherwise).
 */
import { createFileRoute } from "@tanstack/react-router";
import { runLoginDiagnostic } from "@/server/diagnostics/login-diagnostic";
import { HttpError } from "@/server/http-error";

const NO_STORE = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/diag/login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = request.headers.get("x-diag-token") ?? "";
        try {
          const result = await runLoginDiagnostic({ secret });
          return Response.json(result, { headers: NO_STORE });
        } catch (err) {
          if (err instanceof HttpError) {
            return Response.json({ error: err.message }, { status: err.status, headers: NO_STORE });
          }
          return Response.json({ error: "internal error" }, { status: 500, headers: NO_STORE });
        }
      },
    },
  },
});
