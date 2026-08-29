/**
 * Officeverse — Admin agent-presence server function (Phase 9A).
 *
 * Outside `src/server/**` (client import-protection). The handler calls
 * `requireRole("admin")` — the role comes from the authenticated session, never
 * the client. The response carries NO session token, cookie, or IP.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireRole } from "@/server/context";
import { listAgentPresence, type AgentPresenceResult } from "@/server/presence/service";

export const agentPresenceFn = createServerFn({ method: "GET" })
  .inputValidator(() => null)
  .handler(async (): Promise<AgentPresenceResult> => {
    await requireRole("admin");
    return listAgentPresence();
  });
