import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleInternal } from "./server/internal-routes";
import { assertProductionConfig } from "./server/config/production-guard";

/**
 * One-time production configuration gate. Runs on the first request (not at
 * module load, so `vite build` / SSR route-tree generation stay unaffected).
 * In development / the local dryrun this is a no-op. In production it throws
 * once — naming only the missing variables, never a value — and every request
 * then gets a clean 500 until the environment is fixed.
 */
let bootConfigError: Error | null = null;
let bootConfigChecked = false;
function checkBootConfigOnce(): void {
  if (bootConfigChecked) return;
  bootConfigChecked = true;
  try {
    assertProductionConfig();
  } catch (error) {
    bootConfigError = error instanceof Error ? error : new Error(String(error));
    console.error(bootConfigError.message);
  }
}

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      checkBootConfigOnce();
      if (bootConfigError) {
        return new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      // Plain HTTP endpoints (health + cron) that are not SSR routes or
      // server functions. Returns null to fall through to the SSR handler.
      const internal = await handleInternal(request);
      if (internal) return internal;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
