/**
 * Officeverse — Admin agent-presence hook (Phase 9A). Polls a bounded,
 * admin-only endpoint. Polling (not WebSockets) keeps this GoDaddy-portable.
 */
import { useQuery } from "@tanstack/react-query";
import { agentPresenceFn } from "./presence-fns";

/** conservative poll — one small query, admin page only */
const POLL_MS = 30_000;

export function useAgentPresence() {
  return useQuery({
    queryKey: ["presence", "agents"],
    queryFn: () => agentPresenceFn(),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}
