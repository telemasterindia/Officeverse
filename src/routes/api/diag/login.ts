/**
 * Officeverse — TEMPORARY production login diagnostic (admin-login incident).
 *
 * ⚠️ DELETE THIS FILE AND `src/server/diagnostics/login-diagnostic.ts` ONCE
 * THE INCIDENT IS RESOLVED. See login-diagnostic.ts for full rationale and
 * exactly what this does and does not reveal.
 *
 *   GET /api/diag/login
 *     Header:  X-Diag-Token: <OFFICEVERSE_DIAG_SECRET>   (preferred)
 *     or query ?secret=<OFFICEVERSE_DIAG_SECRET>          (simpler to trigger
 *       from a browser address bar; the secret then lands in the URL, so
 *       treat it as single-use and rotate/remove it right after this
 *       incident — see the instructions this endpoint ships with).
 *
 * 503 until OFFICEVERSE_DIAG_SECRET is set in Vercel Production — inert by
 * default. 401 on a missing/wrong secret, with no other detail.
 */
import { createFileRoute } from "@tanstack/react-router";
import { runLoginDiagnostic } from "@/server/diagnostics/login-diagnostic";
import { HttpError } from "@/server/http-error";

export const Route = createFileRoute("/api/diag/login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const secret = request.headers.get("x-diag-token") ?? url.searchParams.get("secret") ?? "";
        try {
          const result = await runLoginDiagnostic({ secret });
          return Response.json(result);
        } catch (err) {
          if (err instanceof HttpError) {
            return Response.json({ error: err.message }, { status: err.status });
          }
          return Response.json({ error: "internal error" }, { status: 500 });
        }
      },
    },
  },
});
