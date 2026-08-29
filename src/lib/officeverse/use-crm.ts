import { useSyncExternalStore } from "react";
import { getOutbox, subscribeOutbox, type OutboxEmail } from "./alerts";
import { loadClients, subscribeClients, type ClientRecord } from "./clients";
import { loadFollowUps, subscribeFollowUps, type FollowUpRecord } from "./followups";
import { loadLeads, subscribeLeads } from "./leads";
import { loadPeople, subscribePeople, type PersonKind, type PersonRecord } from "./people";
import type { Lead } from "./types";

/** Live view of the follow-up store (localStorage-backed). */
export function useFollowUps(): FollowUpRecord[] {
  return useSyncExternalStore(subscribeFollowUps, loadFollowUps, loadFollowUps);
}

/** Live view of the lead store (localStorage-backed). */
export function useLeads(): Lead[] {
  return useSyncExternalStore(subscribeLeads, loadLeads, loadLeads);
}

/**
 * Live email outbox (what the workflow would send).
 *
 * NOTE (Phase 6): the in-CRM notification feed hooks that used to live here
 * (`useNotifications` / `useUnreadCount`, localStorage-backed) were removed. The
 * DB-backed notification system is the source of truth — see
 * `src/lib/officeverse/use-notifications.ts`. The legacy localStorage
 * notification store in `./alerts` is now unused by the UI and kept only for
 * the isolated email-outbox demo below.
 */
export function useOutbox(): OutboxEmail[] {
  return useSyncExternalStore(subscribeOutbox, getOutbox, getOutbox);
}

/** Live view of the Agents/Closers store, optionally filtered by kind. */
export function usePeople(kind?: PersonKind): PersonRecord[] {
  const all = useSyncExternalStore(subscribePeople, loadPeople, loadPeople);
  return kind ? all.filter((p) => p.kind === kind) : all;
}

/** Live view of the Clients store. */
export function useClients(): ClientRecord[] {
  return useSyncExternalStore(subscribeClients, loadClients, loadClients);
}
