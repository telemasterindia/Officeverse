import { useSyncExternalStore } from "react";
import {
  getNotifications,
  getOutbox,
  subscribeNotifications,
  subscribeOutbox,
  unreadCount,
  type OutboxEmail,
} from "./alerts";
import { loadClients, subscribeClients, type ClientRecord } from "./clients";
import { loadFollowUps, subscribeFollowUps, type FollowUpRecord } from "./followups";
import { loadLeads, subscribeLeads } from "./leads";
import { loadPeople, subscribePeople, type PersonKind, type PersonRecord } from "./people";
import type { AppNotification, Lead } from "./types";

/** Live view of the follow-up store (localStorage-backed). */
export function useFollowUps(): FollowUpRecord[] {
  return useSyncExternalStore(subscribeFollowUps, loadFollowUps, loadFollowUps);
}

/** Live view of the lead store (localStorage-backed). */
export function useLeads(): Lead[] {
  return useSyncExternalStore(subscribeLeads, loadLeads, loadLeads);
}

/** Live in-CRM notification feed. */
export function useNotifications(): AppNotification[] {
  return useSyncExternalStore(subscribeNotifications, getNotifications, getNotifications);
}

export function useUnreadCount(): number {
  return useSyncExternalStore(subscribeNotifications, unreadCount, unreadCount);
}

/** Live email outbox (what the workflow would send). */
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
