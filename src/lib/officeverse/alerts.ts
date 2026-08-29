/**
 * TeleMaster India — in-CRM notifications + the email outbox.
 *
 * NOTIFICATIONS are the in-app alert feed (bell badge + /notifications page).
 * Seeded from the demo list, then appended to by the follow-up reminder engine.
 * Persisted to localStorage.
 *
 * EMAIL OUTBOX: this build has no mail server. Every email the workflow WOULD
 * send (closer follow-up reminder, 4h-before-shift summary) is fully rendered
 * — real recipient, subject and body — deduplicated, and written here so it is
 * inspectable in the UI. To go live, forward `queueEmail` payloads to a
 * transactional provider (Resend / SES / Postmark) from a backend job.
 */
import { NOTIFICATIONS as SEED_NOTIFICATIONS } from "./data";
import type { AppNotification } from "./types";

/* ------------------------------ notifications ---------------------------- */

const NOTIF_KEY = "officeverse.notifications";
const notifListeners = new Set<() => void>();
let notifCache: AppNotification[] | null = null;

function loadNotifs(): AppNotification[] {
  if (notifCache) return notifCache;
  if (typeof window === "undefined") {
    notifCache = [...SEED_NOTIFICATIONS];
    return notifCache;
  }
  try {
    const raw = window.localStorage.getItem(NOTIF_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        notifCache = parsed as AppNotification[];
        return notifCache;
      }
    }
  } catch {
    /* ignore */
  }
  notifCache = [...SEED_NOTIFICATIONS];
  persistNotifs();
  return notifCache;
}

function persistNotifs() {
  if (typeof window === "undefined" || !notifCache) return;
  try {
    window.localStorage.setItem(NOTIF_KEY, JSON.stringify(notifCache.slice(0, 60)));
  } catch {
    /* ignore */
  }
}

function emitNotifs() {
  persistNotifs();
  notifListeners.forEach((l) => l());
}

export function getNotifications(): AppNotification[] {
  return loadNotifs();
}

export function unreadCount(): number {
  return loadNotifs().filter((n) => n.unread).length;
}

export function subscribeNotifications(cb: () => void): () => void {
  notifListeners.add(cb);
  return () => notifListeners.delete(cb);
}

export function addNotification(
  input: Omit<AppNotification, "id" | "time" | "unread"> & { id?: string },
): AppNotification {
  const list = loadNotifs();
  const id = input.id ?? `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  if (list.some((n) => n.id === id)) return list.find((n) => n.id === id)!;
  const rec: AppNotification = {
    id,
    category: input.category,
    title: input.title,
    body: input.body,
    time: "Just now",
    unread: true,
  };
  notifCache = [rec, ...list]; // new array ref so subscribers re-render
  emitNotifs();
  return rec;
}

export function markNotificationRead(id: string) {
  const list = loadNotifs();
  if (!list.some((x) => x.id === id && x.unread)) return;
  notifCache = list.map((n) => (n.id === id ? { ...n, unread: false } : n));
  emitNotifs();
}

export function markAllNotificationsRead() {
  const list = loadNotifs();
  if (!list.some((n) => n.unread)) return;
  notifCache = list.map((n) => (n.unread ? { ...n, unread: false } : n));
  emitNotifs();
}

/* ------------------------------- email outbox -------------------------- */

const OUTBOX_KEY = "officeverse.email_outbox";
const SENT_KEY = "officeverse.reminder_log"; // dedupe keys for reminders + emails
const outboxListeners = new Set<() => void>();
let outboxCache: OutboxEmail[] | null = null;

export type EmailKind = "closer-followup" | "shift-summary";

export interface OutboxEmail {
  id: string;
  kind: EmailKind;
  to: string;
  to_name: string;
  subject: string;
  body: string; // plain text
  queued_at: string; // ISO
  /**
   * There is no mail provider in this build, so an email is only ever QUEUED —
   * rendered and ready to hand to a transactional service. Never "SENT".
   */
  status: "QUEUED";
  /** dedupe key that produced this email */
  dedupe_key: string;
}

function loadOutbox(): OutboxEmail[] {
  if (outboxCache) return outboxCache;
  if (typeof window === "undefined") {
    outboxCache = [];
    return outboxCache;
  }
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        outboxCache = parsed as OutboxEmail[];
        return outboxCache;
      }
    }
  } catch {
    /* ignore */
  }
  outboxCache = [];
  return outboxCache;
}

function persistOutbox() {
  if (typeof window === "undefined" || !outboxCache) return;
  try {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(outboxCache.slice(0, 50)));
  } catch {
    /* ignore */
  }
}

export function getOutbox(): OutboxEmail[] {
  return loadOutbox();
}

export function subscribeOutbox(cb: () => void): () => void {
  outboxListeners.add(cb);
  return () => outboxListeners.delete(cb);
}

/* ---- dedupe log: one entry per {threshold|recipient|scheduled instant} ---- */

function loadSent(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed as string[]);
    }
  } catch {
    /* ignore */
  }
  return new Set();
}

function saveSent(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    // keep the log bounded
    const arr = Array.from(set).slice(-400);
    window.localStorage.setItem(SENT_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

/** True the first time a dedupe key is seen; records it and returns true. */
export function claimOnce(key: string): boolean {
  const set = loadSent();
  if (set.has(key)) return false;
  set.add(key);
  saveSent(set);
  return true;
}

export function wasClaimed(key: string): boolean {
  return loadSent().has(key);
}

/**
 * Queue an email to the outbox. The `dedupe_key` guarantees one follow-up /
 * one shift never queues the same email twice. `force` (manual "preview")
 * REPLACES any existing entry with the same key rather than appending a copy.
 * Nothing is ever sent — there is no mail provider.
 */
export function queueEmail(
  input: Omit<OutboxEmail, "id" | "queued_at" | "status">,
  { force = false }: { force?: boolean } = {},
): OutboxEmail {
  const list = loadOutbox();
  const existing = list.find((e) => e.dedupe_key === input.dedupe_key);
  if (existing && !force) return existing;
  const rec: OutboxEmail = {
    ...input,
    status: "QUEUED",
    id: `mail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    queued_at: new Date().toISOString(),
  };
  outboxCache = [rec, ...list.filter((e) => e.dedupe_key !== input.dedupe_key)];
  persistOutbox();
  outboxListeners.forEach((l) => l());
  return rec;
}
