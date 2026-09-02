import { useSyncExternalStore } from "react";
import { getOutbox, subscribeOutbox, type OutboxEmail } from "./alerts";

/**
 * Remaining non-authoritative client view.
 *
 * The lead / follow-up / staff (agents & closers) / client directories are now
 * served entirely by the server (`use-lead-lifecycle.ts`, `use-staff.ts`,
 * `use-clients.ts`) — the old localStorage `useLeads` / `useFollowUps` /
 * `usePeople` / `useClients` hooks and their stores were removed.
 *
 * What's left:
 *   - `useOutbox` — the isolated email-outbox PREVIEW, clearly labelled
 *     "legacy / non-authoritative" in the Notifications UI. Real delivery is the
 *     server email queue (`src/server/email/service.ts`) drained by the
 *     `/internal/tick` cron (a future phase).
 */
export function useOutbox(): OutboxEmail[] {
  return useSyncExternalStore(subscribeOutbox, getOutbox, getOutbox);
}
