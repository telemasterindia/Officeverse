/**
 * TeleMaster India — Follow-up PURE helpers + shared types.
 *
 * The authoritative follow-up lifecycle (create / reschedule / complete /
 * cancel / convert, ownership, visibility, customer identity) is served
 * entirely by the server now — `src/server/followups/service.ts` behind
 * `src/lib/officeverse/followup-fns.ts` and the `use-lead-lifecycle.ts` hooks.
 * The old localStorage `officeverse.followups` demo store that used to live in
 * this file (and its sibling `leads.ts` store) has been removed.
 *
 * What remains here is only side-effect-free formatting / derivation used by the
 * UI and by the in-tab reminder renderer:
 *   - time formatting (displayDate / displayTime / displayDateTime …)
 *   - bucket / urgency derivation from a status + scheduled_at
 *   - the 15 / 3 / 1-minute reminder-threshold derivation + its dedupe key
 *
 * Timezone: the canonical schedule is an IST wall-clock ISO string with the
 * +05:30 offset, e.g. "2026-08-28T14:30:00+05:30". Every surface reads that one
 * field — no browser-local / UTC drift.
 */
import type { Role } from "./types";

// Canonical shift-date + shift-window helpers live in ./shift — re-exported here
// so existing `@/lib/officeverse/followups` imports keep working.
export { shiftDateIST, shiftWindow } from "./shift";

export const IST_OFFSET = "+05:30";
export const IST_TZ = "Asia/Kolkata";
/** Human, unambiguous timezone label — the platform runs on IST everywhere. */
export const IST_TZ_LABEL = "India Standard Time (IST · UTC+05:30)";
export const REMINDER_THRESHOLDS = [15, 3, 1] as const;
export type ReminderThreshold = (typeof REMINDER_THRESHOLDS)[number];
/** Send the shift-summary email this many minutes before shift start. */
export const SHIFT_EMAIL_LEAD_MINUTES = 4 * 60;

export type FollowUpOwnerRole = Extract<Role, "agent" | "closer">;
export type FollowUpLifecycle = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "CONVERTED";
export type FollowUpBucket = "TODAY" | "UPCOMING" | "OVERDUE" | "COMPLETED";
export type FollowUpUrgency =
  "SCHEDULED" | "DUE" | "OVERDUE" | "COMPLETED" | "CANCELLED" | "CONVERTED";

/**
 * The customer captured on the common form. A Follow-up owns its own copy of
 * this — entered once, editable by the owning agent until the Follow-up is
 * completed, cancelled or converted. (The authoritative shape now lives in the
 * server DTO; this stays as the UI form model.)
 */
export interface FollowUpCustomer {
  /** Capture date ("YYYY-MM-DD") — when the agent spoke to the customer. */
  date: string;
  full_name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  debt_amount: number;
  credit: string;
  current_late: "Current" | "Late" | "";
  comment: string;
}

export type FollowUpAttemptOutcome = "RESCHEDULED" | "COMPLETED" | "CANCELLED";

/** One prior callback attempt — the reschedule / close history of a Follow-up. */
export interface FollowUpAttempt {
  /** the schedule this attempt was made against */
  scheduled_at: string;
  outcome: FollowUpAttemptOutcome;
  note: string;
  /** real wall-clock ISO timestamp the outcome was recorded */
  recorded_at: string;
}

export interface FollowUpRecord {
  follow_up_id: string;
  /** Set only once the Follow-up has been converted to a Lead. */
  lead_id?: string;
  /** the customer entered on the common form */
  customer: FollowUpCustomer;
  /** denormalised for fast lists (kept in sync with `customer`) */
  customer_name: string;
  phone: string;
  /** ownership — the agent this callback belongs to (never transferred) */
  owner_id: string;
  owner_name: string;
  owner_role: FollowUpOwnerRole;
  /** canonical schedule: IST wall-clock as an ISO string with +05:30 */
  scheduled_at: string;
  comment: string;
  status: FollowUpLifecycle;
  /** prior callback attempts — reschedule history, oldest first */
  attempts: FollowUpAttempt[];
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  /** conversion trail — the Lead this Follow-up became */
  converted_lead_id?: string;
  converted_at?: string;
}

/* ------------------------------- time helpers ------------------------------ */

function two(n: number) {
  return String(n).padStart(2, "0");
}

/** Build the canonical scheduled_at from an IST date + time. */
export function buildScheduledAt(dateYMD: string, timeHM: string): string {
  const [h = "09", m = "00"] = timeHM.split(":");
  return `${dateYMD}T${two(Number(h))}:${two(Number(m))}:00${IST_OFFSET}`;
}

/** The date ("YYYY-MM-DD") + time ("HH:mm") halves of a canonical scheduled_at. */
export function scheduledParts(iso: string): { date: string; time: string } {
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** Today's date in the operational (IST) timezone, "YYYY-MM-DD". */
export function todayIST(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: IST_TZ });
}

/** Human date, e.g. "Thu, 28 Aug 2026" — reads the IST wall-clock parts directly. */
export function displayDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Human time in IST, e.g. "02:30 PM IST". */
export function displayTime(iso: string): string {
  const [hStr = "9", mStr = "00"] = iso.slice(11, 16).split(":");
  const h = Number(hStr);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${two(h12)}:${two(Number(mStr))} ${ap} IST`;
}

export function displayDateTime(iso: string): string {
  return `${displayDate(iso)} · ${displayTime(iso)}`;
}

/** Minutes from `now` until the scheduled instant (negative once it is past). */
export function minutesUntil(iso: string, now: number = Date.now()): number {
  return (new Date(iso).getTime() - now) / 60000;
}

/* ------------------------------ derivations ------------------------------- */

export function bucketOf(
  fu: Pick<FollowUpRecord, "status" | "scheduled_at">,
  now: number = Date.now(),
): FollowUpBucket {
  if (fu.status === "COMPLETED" || fu.status === "CONVERTED") return "COMPLETED";
  const when = new Date(fu.scheduled_at).getTime();
  if (when < now) return "OVERDUE";
  if (scheduledParts(fu.scheduled_at).date === todayIST(new Date(now))) return "TODAY";
  return "UPCOMING";
}

export function urgencyOf(
  fu: Pick<FollowUpRecord, "status" | "scheduled_at">,
  now: number = Date.now(),
): FollowUpUrgency {
  if (fu.status === "COMPLETED") return "COMPLETED";
  if (fu.status === "CANCELLED") return "CANCELLED";
  if (fu.status === "CONVERTED") return "CONVERTED";
  const m = minutesUntil(fu.scheduled_at, now);
  if (m < 0) return "OVERDUE";
  if (m <= 15) return "DUE";
  return "SCHEDULED";
}

export function isOverdue(fu: FollowUpRecord, now: number = Date.now()): boolean {
  return fu.status === "SCHEDULED" && new Date(fu.scheduled_at).getTime() < now;
}

/* --------------------------- reminder derivation ------------------------- */
/* Pure. A server cron/worker would call these per follow-up and check the key
 * against a "sent" table before dispatching — identical logic, different store. */

/**
 * Which reminder threshold (15 / 3 / 1) is "live" for this follow-up right now,
 * or null. Threshold T fires only inside its own window (T_prev, T] with a 2-min
 * grace past zero for the 1-minute reminder — opening the CRM late never
 * produces a retroactive "15 minutes" reminder for a follow-up 4 minutes away.
 * Completed / cancelled follow-ups always return null.
 */
export function liveReminderThreshold(
  fu: FollowUpRecord,
  now: number = Date.now(),
): ReminderThreshold | null {
  if (fu.status !== "SCHEDULED") return null;
  const m = minutesUntil(fu.scheduled_at, now);
  const sorted = [...REMINDER_THRESHOLDS].sort((a, b) => a - b); // [1, 3, 15]
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!;
    const lo = i === 0 ? -2 : sorted[i - 1]!;
    if (m > lo && m <= t) return t;
  }
  return null;
}

/** Persistent dedupe key: one per follow-up · threshold · scheduled instant. */
export const reminderKey = (fu: FollowUpRecord, t: number) =>
  `rem|${fu.follow_up_id}|${t}|${fu.scheduled_at}`;
/** Persistent dedupe key for the single closer email of a follow-up. */
export const closerEmailKey = (fu: FollowUpRecord) =>
  `mail|closer|${fu.follow_up_id}|${fu.scheduled_at}`;
/** Persistent dedupe key for a user's one shift-summary email. */
export const shiftEmailKey = (userId: string, shiftStartISO: string) =>
  `mail|shift|${userId}|${shiftStartISO.slice(0, 10)}`;
