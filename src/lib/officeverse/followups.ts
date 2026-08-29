/**
 * TeleMaster India — Follow-up system.
 *
 * A Follow-up is an Agent-owned callback. It carries its OWN customer payload
 * (captured once on the common New-Customer form) and has no `lead_id` until it
 * is converted to a Lead. It can be rescheduled repeatedly (history preserved)
 * and finally converted — which creates the Lead from that same payload.
 *
 * Persistence: localStorage (the same mechanism the session + avatar use). The
 * store is seeded once from the demo data, then owns every create / reschedule /
 * complete / cancel. Swap `loadStore`/`persist` for a real API to go live.
 *
 * Timezone: India-based staff run the US process. The single canonical time
 * representation is an ISO string carrying the IST offset, e.g.
 *   "2026-08-28T14:30:00+05:30"
 * Every surface (calendar, list, 15/3/1-minute reminders, closer email, shift
 * email) reads that one field — no browser-local / UTC drift.
 */
import { AGENTS, CLOSERS, DEMO_USERS, EMPLOYEES, FOLLOW_UPS as SEED_FOLLOW_UPS } from "./data";
import { createLead, getLead, loadLeads, searchLeads } from "./leads";
import { shiftDateIST, shiftWindow } from "./shift";
import type { Lead, ProcessCode, Role, SessionUser } from "./types";

export { getLead, searchLeads } from "./leads";
// Canonical shift-date + shift-window helpers live in ./shift — re-exported here
// so existing `@/lib/officeverse/followups` imports keep working.
export { shiftDateIST, shiftWindow } from "./shift";

export const IST_OFFSET = "+05:30";
export const IST_TZ = "Asia/Kolkata";
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
 * this — it is entered once, stays attached to the Follow-up, and the owning
 * agent can keep editing it (phone corrections, new email, updated debt…)
 * right up until the Follow-up is completed, cancelled or converted to a Lead.
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
  /**
   * Set ONLY once the Follow-up has been converted to a Lead (and, for legacy
   * seeded rows, the Lead they were historically attached to). A live
   * agent-created Follow-up has NO lead_id — it is the agent's own callback.
   */
  lead_id?: string;
  /** the customer entered on the common form — the record's own source of truth */
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

export function bucketOf(fu: FollowUpRecord, now: number = Date.now()): FollowUpBucket {
  if (fu.status === "COMPLETED" || fu.status === "CONVERTED") return "COMPLETED";
  const when = new Date(fu.scheduled_at).getTime();
  if (when < now) return "OVERDUE";
  if (scheduledParts(fu.scheduled_at).date === todayIST(new Date(now))) return "TODAY";
  return "UPCOMING";
}

export function urgencyOf(fu: FollowUpRecord, now: number = Date.now()): FollowUpUrgency {
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

/* --------------------------- people / ownership --------------------------- */

function slugId(name: string): string {
  return "p_" + name.toLowerCase().replace(/[^a-z]+/g, "_");
}

/** Best-effort stable id for a person named `name`. */
export function personId(name: string, sessionUser?: SessionUser | null): string {
  if (sessionUser && sessionUser.name === name) return sessionUser.id;
  const demo = Object.values(DEMO_USERS).find((u) => u.name === name);
  if (demo) return demo.id;
  const emp = EMPLOYEES.find((e) => e.name === name);
  return emp ? emp.id : slugId(name);
}

export function roleOfPerson(name: string): FollowUpOwnerRole {
  if (CLOSERS.includes(name)) return "closer";
  return "agent";
}

export interface OwnerOption {
  id: string;
  name: string;
  role: FollowUpOwnerRole;
  label: string;
}

/** Who the current user may hand a follow-up to, for a given (optional) lead. */
export function ownerOptions(user: SessionUser, lead?: Lead | null): OwnerOption[] {
  const mk = (name: string, role: FollowUpOwnerRole, extra?: string): OwnerOption => ({
    id: personId(name, user),
    name,
    role,
    label: `${name} — ${role === "agent" ? "Agent" : "Closer"}${extra ? ` ${extra}` : ""}`,
  });

  if (user.role === "admin" || user.role === "hr") {
    return [...AGENTS.map((n) => mk(n, "agent")), ...CLOSERS.map((n) => mk(n, "closer"))];
  }

  const me = mk(user.name, user.role === "closer" ? "closer" : "agent", "(you)");
  if (user.role === "closer") {
    const agent = lead?.submitted_by;
    return agent
      ? [me, mk(agent, "agent")]
      : [me, ...AGENTS.filter((n) => n !== user.name).map((n) => mk(n, "agent"))];
  }
  // agent
  const closer = lead?.assigned_closer;
  return closer ? [me, mk(closer, "closer")] : [me, ...CLOSERS.map((n) => mk(n, "closer"))];
}

/** Follow-ups a given user is allowed to see by default (before UI filters). */
export function visibleFollowUps(all: FollowUpRecord[], user: SessionUser): FollowUpRecord[] {
  if (user.role === "admin" || user.role === "hr") return all;
  return all.filter((f) => f.owner_id === user.id || f.owner_name === user.name);
}

/* ----------------------- customer identity (via Lead) -------------------- */

/**
 * Resolve the customer identity for a follow-up. The Follow-up's own `customer`
 * payload is the source of truth (it is entered on the common form and stays
 * editable by the owner). Once converted, the linked Lead is used as a fallback
 * for any field the payload is missing; legacy rows with no payload fall back to
 * the Lead and then the denormalised snapshot.
 */
export function resolveCustomer(
  fu: Pick<FollowUpRecord, "customer_name" | "phone"> & {
    lead_id?: string;
    customer?: FollowUpCustomer;
  },
): {
  lead_id: string;
  name: string;
  phone: string;
  email: string;
  file_name: string;
  customer?: FollowUpCustomer;
  lead?: Lead;
} {
  const lead = fu.lead_id ? getLead(fu.lead_id) : undefined;
  const c = fu.customer;
  return {
    lead_id: fu.lead_id ?? "",
    name: c?.full_name || lead?.customer_name || fu.customer_name,
    phone: c?.phone || lead?.phone || fu.phone,
    email: c?.email || lead?.email || "",
    file_name: lead?.file_name ?? "",
    ...(c ? { customer: c } : {}),
    ...(lead ? { lead } : {}),
  };
}

/* --------------------------------- store -------------------------------- */

const STORE_KEY = "officeverse.followups";
const listeners = new Set<() => void>();
let cache: FollowUpRecord[] | null = null;

function to24h(t: string): string {
  const parts = t.trim().split(/\s+/);
  const [hm = "9:00", ap] = parts;
  const nums = hm.split(":").map(Number);
  let h = nums[0] ?? 9;
  const m = nums[1] ?? 0;
  if (ap) {
    const up = ap.toUpperCase();
    if (up === "PM" && h < 12) h += 12;
    if (up === "AM" && h === 12) h = 0;
  }
  return `${two(h)}:${two(m)}`;
}

/** Build a FollowUpCustomer payload from a Lead (used by seed + migration). */
export function customerFromLead(l: Lead, date?: string): FollowUpCustomer {
  return {
    date: date || todayIST(),
    full_name: l.customer_name,
    phone: l.phone,
    email: l.email,
    address: l.address,
    city: l.city,
    state: l.state,
    zip: l.zip,
    debt_amount: l.debt_amount,
    credit: l.credit,
    current_late: l.current_late,
    comment: l.comment,
  };
}

const EMPTY_CUSTOMER: FollowUpCustomer = {
  date: "",
  full_name: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  debt_amount: 0,
  credit: "",
  current_late: "",
  comment: "",
};

function seed(): FollowUpRecord[] {
  return SEED_FOLLOW_UPS.map((f) => {
    const lead = getLead(f.lead_id);
    const ownerName = f.current_assignee;
    const capture = `${f.created_at}`.slice(0, 10);
    return {
      follow_up_id: f.follow_up_id,
      lead_id: f.lead_id,
      customer: lead
        ? customerFromLead(lead, capture)
        : {
            ...EMPTY_CUSTOMER,
            date: capture,
            full_name: f.customer_name,
            phone: f.phone,
            comment: f.comment,
          },
      customer_name: lead?.customer_name ?? f.customer_name,
      phone: lead?.phone ?? f.phone,
      owner_id: personId(ownerName),
      owner_name: ownerName,
      owner_role: (f.assignee_role === "closer" ? "closer" : "agent") as FollowUpOwnerRole,
      scheduled_at: buildScheduledAt(f.follow_up_date, to24h(f.follow_up_time)),
      comment: f.comment,
      status: (f.status === "COMPLETED" ? "COMPLETED" : "SCHEDULED") as FollowUpLifecycle,
      attempts: [],
      created_by: f.created_by,
      created_at: `${f.created_at}T09:00:00${IST_OFFSET}`,
      updated_at: `${f.created_at}T09:00:00${IST_OFFSET}`,
      ...(f.status === "COMPLETED"
        ? { completed_at: buildScheduledAt(f.follow_up_date, to24h(f.follow_up_time)) }
        : {}),
    } satisfies FollowUpRecord;
  });
}

/** Backfill records saved before the Follow-up carried its own customer payload. */
function migrateRecord(f: Record<string, unknown>): FollowUpRecord {
  const rec = f as unknown as FollowUpRecord & { customer?: FollowUpCustomer };
  if (rec.customer && Array.isArray(rec.attempts)) return rec;
  const lead = rec.lead_id ? getLead(rec.lead_id) : undefined;
  const capture = String(rec.created_at ?? "").slice(0, 10) || todayIST();
  return {
    ...rec,
    customer:
      rec.customer ??
      (lead
        ? customerFromLead(lead, capture)
        : {
            ...EMPTY_CUSTOMER,
            date: capture,
            full_name: rec.customer_name ?? "",
            phone: rec.phone ?? "",
            comment: rec.comment ?? "",
          }),
    attempts: Array.isArray(rec.attempts) ? rec.attempts : [],
  };
}

function loadStore(): FollowUpRecord[] {
  if (cache) return cache;
  if (typeof window === "undefined") {
    cache = seed();
    return cache;
  }
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cache = parsed.map(migrateRecord);
        return cache;
      }
    }
  } catch {
    /* ignore */
  }
  cache = seed();
  persist();
  return cache;
}

function persist() {
  if (typeof window === "undefined" || !cache) return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

export function loadFollowUps(): FollowUpRecord[] {
  return loadStore();
}

export function subscribeFollowUps(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function nextId(): string {
  const list = loadStore();
  let n = 4400 + list.length * 3;
  const ids = new Set(list.map((f) => f.follow_up_id));
  while (ids.has(`FU_${String(n).padStart(8, "0")}`)) n += 3;
  return `FU_${String(n).padStart(8, "0")}`;
}

export interface CreateFollowUpInput {
  /** the customer captured on the common form */
  customer: FollowUpCustomer;
  scheduled_at: string; // canonical ISO (+05:30)
  comment: string;
  owner: { id: string; name: string; role: FollowUpOwnerRole };
  created_by: string;
  /** optional — only when scheduling against an already-transferred Lead */
  lead_id?: string;
}

export function createFollowUp(input: CreateFollowUpInput): FollowUpRecord {
  const nowISO = new Date().toISOString();
  const customer: FollowUpCustomer = { ...input.customer };
  const rec: FollowUpRecord = {
    follow_up_id: nextId(),
    customer,
    customer_name: customer.full_name.trim(),
    phone: customer.phone.trim(),
    owner_id: input.owner.id,
    owner_name: input.owner.name,
    owner_role: input.owner.role,
    scheduled_at: input.scheduled_at,
    comment: input.comment.trim(),
    status: "SCHEDULED",
    attempts: [],
    created_by: input.created_by,
    created_at: nowISO,
    updated_at: nowISO,
    ...(input.lead_id ? { lead_id: input.lead_id } : {}),
  };
  cache = [rec, ...loadStore()]; // new array ref so subscribers re-render
  emit();
  return rec;
}

export function updateFollowUp(
  id: string,
  patch: Partial<
    Pick<
      FollowUpRecord,
      "scheduled_at" | "comment" | "owner_id" | "owner_name" | "owner_role" | "status"
    >
  >,
): FollowUpRecord | null {
  const list = loadStore();
  const i = list.findIndex((f) => f.follow_up_id === id);
  if (i < 0) return null;
  const next = { ...list[i]!, ...patch, updated_at: new Date().toISOString() };
  if (patch.status === "COMPLETED" && !next.completed_at) next.completed_at = next.updated_at;
  cache = list.map((f, idx) => (idx === i ? next : f)); // new array ref
  emit();
  return next;
}

/** Edit the customer payload of a Follow-up (owner only, while SCHEDULED). */
export function updateFollowUpCustomer(
  id: string,
  patch: Partial<FollowUpCustomer>,
): FollowUpRecord | null {
  const list = loadStore();
  const i = list.findIndex((f) => f.follow_up_id === id);
  if (i < 0) return null;
  const cur = list[i]!;
  const customer: FollowUpCustomer = { ...cur.customer, ...patch };
  const next: FollowUpRecord = {
    ...cur,
    customer,
    customer_name: customer.full_name.trim() || cur.customer_name,
    phone: customer.phone.trim() || cur.phone,
    updated_at: new Date().toISOString(),
  };
  cache = list.map((f, idx) => (idx === i ? next : f));
  emit();
  return next;
}

/** Record a terminal outcome, appending it to the attempt history. */
function terminate(
  id: string,
  status: "COMPLETED" | "CANCELLED",
  note: string,
): FollowUpRecord | null {
  const list = loadStore();
  const i = list.findIndex((f) => f.follow_up_id === id);
  if (i < 0) return null;
  const cur = list[i]!;
  const now = new Date().toISOString();
  const next: FollowUpRecord = {
    ...cur,
    status,
    attempts: [
      ...cur.attempts,
      { scheduled_at: cur.scheduled_at, outcome: status, note: note.trim(), recorded_at: now },
    ],
    updated_at: now,
    ...(status === "COMPLETED" ? { completed_at: now } : {}),
  };
  cache = list.map((f, idx) => (idx === i ? next : f));
  emit();
  return next;
}

export const completeFollowUp = (id: string, note = "") => terminate(id, "COMPLETED", note);
export const cancelFollowUp = (id: string, note = "") => terminate(id, "CANCELLED", note);

/**
 * Reschedule a Follow-up to a new callback time. The PREVIOUS schedule is
 * pushed onto the attempt history ("Not Reached / Rescheduled") — history is
 * never destroyed and no duplicate customer is created; it stays the same
 * record with a new `scheduled_at`, which re-arms the reminders.
 */
export function rescheduleFollowUp(
  id: string,
  scheduled_at: string,
  note = "",
): FollowUpRecord | null {
  const list = loadStore();
  const i = list.findIndex((f) => f.follow_up_id === id);
  if (i < 0) return null;
  const cur = list[i]!;
  const now = new Date().toISOString();
  const next: FollowUpRecord = {
    ...cur,
    scheduled_at,
    status: "SCHEDULED",
    attempts: [
      ...cur.attempts,
      {
        scheduled_at: cur.scheduled_at,
        outcome: "RESCHEDULED",
        note: note.trim(),
        recorded_at: now,
      },
    ],
    updated_at: now,
  };
  cache = list.map((f, idx) => (idx === i ? next : f));
  emit();
  return next;
}

/**
 * Convert a Follow-up into a Lead assigned to a Closer. The existing customer
 * payload becomes the Lead — NO duplicate customer, no re-entry. The Follow-up
 * moves to CONVERTED (no longer active) and keeps a `converted_lead_id` trail
 * so the conversion stays visible in its history.
 */
export function convertFollowUpToLead(
  id: string,
  opts: { closer: string; actor: string; process?: ProcessCode },
): { follow_up: FollowUpRecord; lead: Lead } | null {
  const list = loadStore();
  const i = list.findIndex((f) => f.follow_up_id === id);
  if (i < 0) return null;
  const cur = list[i]!;
  if (cur.status === "CONVERTED" && cur.converted_lead_id) {
    const existing = getLead(cur.converted_lead_id);
    if (existing) return { follow_up: cur, lead: existing };
  }
  const c = cur.customer;
  const lead = createLead({
    customer_name: c.full_name,
    email: c.email,
    phone: c.phone,
    ...(c.date ? { date: c.date } : {}),
    address: c.address,
    city: c.city,
    state: c.state,
    zip: c.zip,
    debt_amount: c.debt_amount,
    ...(c.credit ? { credit: c.credit } : {}),
    ...(c.current_late === "Current" || c.current_late === "Late"
      ? { current_late: c.current_late }
      : {}),
    comment: c.comment,
    submitted_by: cur.created_by,
    assigned_closer: opts.closer,
    ...(opts.process ? { process: opts.process } : {}),
  });
  const now = new Date().toISOString();
  const next: FollowUpRecord = {
    ...cur,
    status: "CONVERTED",
    lead_id: lead.lead_id,
    converted_lead_id: lead.lead_id,
    converted_at: now,
    attempts: [
      ...cur.attempts,
      {
        scheduled_at: cur.scheduled_at,
        outcome: "COMPLETED",
        note: `Converted to Lead ${lead.lead_id} — transferred to ${opts.closer} by ${opts.actor}`,
        recorded_at: now,
      },
    ],
    updated_at: now,
  };
  cache = list.map((f, idx) => (idx === i ? next : f));
  emit();
  return { follow_up: next, lead };
}

/* --------------------------- shift-time helpers ------------------------- */

/** The next upcoming shift-start instant (ISO, IST) for this user. */
export function nextShiftStart(process: ProcessCode, now: Date = new Date()): string {
  const { start } = shiftWindow(process);
  const today = todayIST(now);
  const todayStart = buildScheduledAt(today, start);
  if (new Date(todayStart).getTime() > now.getTime()) return todayStart;
  // otherwise tomorrow
  const [y, mo, d] = today.split("-").map(Number);
  const t = new Date(Date.UTC(y!, mo! - 1, d! + 1));
  const tomorrow = t.toISOString().slice(0, 10);
  return buildScheduledAt(tomorrow, start);
}

/** Convert an absolute instant to the canonical IST wall-clock ISO string. */
export function toISTISO(instantMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instantMs));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:00${IST_OFFSET}`;
}

/**
 * DEMO AID ONLY — not part of the business model. Ensures the logged-in
 * agent/closer has ONE near-term follow-up so the 15 / 3 / 1-minute reminders
 * (and, for a closer, the single closer email) are observable without waiting
 * for real scheduling. Runs at most once per user per day, and only if the user
 * has nothing scheduled in the next 25 minutes.
 */
export function seedDemoReminders(user: SessionUser): void {
  if (typeof window === "undefined") return;
  if (user.role !== "agent" && user.role !== "closer") return;
  const TS_KEY = `officeverse.demo_reminder_ts.${user.id}`;
  try {
    const last = Number(window.localStorage.getItem(TS_KEY) ?? 0);
    if (Date.now() - last < 20 * 60_000) return; // once per 20 min
  } catch {
    return;
  }
  const now = Date.now();
  const imminent = visibleFollowUps(loadStore(), user).some(
    (f) =>
      f.status === "SCHEDULED" &&
      minutesUntil(f.scheduled_at, now) > -1 &&
      minutesUntil(f.scheduled_at, now) < 25,
  );
  if (imminent) return;

  const lead = loadLeads().find((l) => l.submitted_by === user.name) ?? loadLeads()[0];
  if (!lead) return;
  createFollowUp({
    customer: customerFromLead(lead, shiftDateIST()),
    scheduled_at: toISTISO(now + 16 * 60_000),
    comment: "Demo follow-up — the 15, then 3, then 1-minute reminders will fire.",
    owner: { id: user.id, name: user.name, role: user.role as FollowUpOwnerRole },
    created_by: user.name,
  });
  try {
    window.localStorage.setItem(TS_KEY, String(now));
  } catch {
    /* ignore */
  }
}

/** Follow-ups owned by `user` that fall inside their next shift window. */
export function followUpsForNextShift(all: FollowUpRecord[], user: SessionUser): FollowUpRecord[] {
  const startISO = nextShiftStart(user.process);
  const { end, overnight } = shiftWindow(user.process);
  const startDate = startISO.slice(0, 10);
  let endISO: string;
  if (overnight) {
    const [y, mo, d] = startDate.split("-").map(Number);
    const t = new Date(Date.UTC(y!, mo! - 1, d! + 1));
    endISO = buildScheduledAt(t.toISOString().slice(0, 10), end);
  } else {
    endISO = buildScheduledAt(startDate, end);
  }
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  return visibleFollowUps(all, user)
    .filter((f) => f.status === "SCHEDULED")
    .filter((f) => {
      const w = new Date(f.scheduled_at).getTime();
      return w >= s && w <= e;
    })
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
}
