/**
 * Officeverse — canonical business identifiers + idempotency dedupe keys.
 *
 * Business ID conventions:
 *   Lead       "TMI_00012345"   (leads.ts nextLeadId — start 12000, step +7)
 *   Follow-up  "FU_00004415"    (followups.ts nextId — start 4400, step +3)
 *   Agent      "TMI_CC_001"     (canonical Employee ID, server-generated,
 *                                sequential; legacy "TMI_CC###" / "AG-#####"
 *                                codes still resolve but no new ones are minted)
 *   Closer     "TMI_CL_001"     (canonical Employee ID; legacy "CL-#####" still
 *                                resolves)
 *   Client     "CLT-00001"
 *
 * Dedupe keys follow the exact shapes named in the spec (Phase 4 & 6):
 *   followup:<id>:15:<scheduled_at>
 *   email:closer-followup:<id>:<scheduled_at>
 *   shift:<user_id>:<shift_start_datetime>
 */

export const REMINDER_THRESHOLDS = [15, 3, 1] as const;
export type ReminderThreshold = (typeof REMINDER_THRESHOLDS)[number];

function pad(n: number, width: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(width, "0");
}

/** Digits of a business code as a number ("TMI_00012345" -> 12345). */
export function numericPart(code: string): number {
  const digits = code.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

/* --------------------------------- codes -------------------------------- */

export const leadCode = (seq: number): string => `TMI_${pad(seq, 8)}`;
export const followUpCode = (seq: number): string => `FU_${pad(seq, 8)}`;
/** Canonical Agent Employee ID: "TMI_CC_001", "TMI_CC_002", … */
export const agentCode = (seq: number): string => `TMI_CC_${pad(seq, 3)}`;
/** Canonical Closer Employee ID: "TMI_CL_001", "TMI_CL_002", … */
export const closerCode = (seq: number): string => `TMI_CL_${pad(seq, 3)}`;
export const clientCode = (seq: number): string => `CLT-${pad(seq, 5)}`;

/** Shared canonical/legacy Employee-ID matchers (single source of truth). */
export {
  AGENT_CODE_RE,
  CLOSER_CODE_RE,
  AGENT_CODE_CANONICAL_RE,
  CLOSER_CODE_CANONICAL_RE,
  isAgentCode,
  isCloserCode,
} from "@/lib/officeverse/staff-codes";

/** Next Lead sequence given the current max numeric part (mirrors nextLeadId). */
export const nextLeadSeq = (maxNumeric: number): number => (maxNumeric || 12000) + 7;
/** Next Follow-up sequence given the current max numeric part. */
export const nextFollowUpSeq = (maxNumeric: number): number => (maxNumeric || 4397) + 3;
/**
 * Next Agent/Closer/Client sequence = (highest existing numeric suffix) + 1.
 * `Number(...)` coercion is deliberate: a MySQL `MAX(CAST(... AS UNSIGNED))`
 * comes back from mysql2 as a STRING, and `"10" + 1` would concatenate to
 * `"101"` — silently corrupting every generated code. Never `MAX(id)`, and
 * never "first unused" — an issued code is a permanent identity.
 */
export const nextStaffSeq = (maxNumeric: number | string | null | undefined): number =>
  (Number(maxNumeric) || 0) + 1;

/* ------------------------------ dedupe keys ----------------------------- */

/**
 * Idempotency key for a follow-up reminder notification. `ref` is the follow-up
 * identifier (numeric id or code — be consistent per caller). `scheduledAt` is
 * the IST wall-clock string; changing it (a reschedule) yields a NEW key and
 * therefore correctly re-arms the reminder.
 */
export function reminderDedupeKey(
  ref: string | number,
  threshold: ReminderThreshold,
  scheduledAt: string,
): string {
  return `followup:${ref}:${threshold}:${scheduledAt.trim()}`;
}

/** Idempotency key for the single closer follow-up email. */
export function closerEmailDedupeKey(ref: string | number, scheduledAt: string): string {
  return `email:closer-followup:${ref}:${scheduledAt.trim()}`;
}

/** Idempotency key for a user's one pre-shift summary email. */
export function shiftEmailDedupeKey(userId: string | number, shiftStart: string): string {
  return `shift:${userId}:${shiftStart.trim()}`;
}

/** Idempotency key for a "lead assigned" notification. */
export function leadAssignedDedupeKey(
  leadRef: string | number,
  closerRef: string | number,
): string {
  return `lead:${leadRef}:assigned:${closerRef}`;
}

/* --------------------- Phase 5: event-driven dedupe -------------------- *
 * Every key below is derived ONLY from the business event (entity code +
 * event name + a stable "occurrence" token such as the scheduled instant or
 * the shift date). NEVER from `Date.now()`. Re-running the scheduler / a
 * retried worker therefore lands on the SAME key and is a no-op.
 * ------------------------------------------------------------------------ */

/** Follow-up lifecycle events an integration point emits (not time-based reminders). */
export const FOLLOW_UP_EVENTS = [
  "rescheduled",
  "converted",
  "completed",
  "cancelled",
  "reminder",
  "overdue",
] as const;
export type FollowUpEvent = (typeof FOLLOW_UP_EVENTS)[number];

/**
 * Canonical notification idempotency key.
 *   notif:<type>:<entityRef>:<occurrence>
 * `occurrence` MUST be event-derived (a scheduled wall-clock, a shift date, a
 * target user code…), never the current time.
 */
export function notificationDedupeKey(
  type: string,
  entityRef: string | number,
  occurrence: string | number,
): string {
  return `notif:${type}:${entityRef}:${String(occurrence).trim()}`;
}

/**
 * Follow-up event key: followup:<code>:<event>:<occurrence>. The follow-up CODE
 * is stable across reschedules (the record keeps its id), so a reschedule only
 * changes `occurrence` (the new scheduled instant) and correctly yields a new
 * key while completed/cancelled/converted keep their own terminal keys.
 */
export function followUpEventDedupeKey(
  event: FollowUpEvent,
  followUpCode: string,
  occurrence: string,
): string {
  return `followup:${followUpCode}:${event}:${occurrence.trim()}`;
}

/**
 * The matching EMAIL job key for any notification/event key: the same key with
 * a `:email` suffix (spec: followup:FU_…:reminder:<at>  →  …:email). One event
 * therefore yields at most one notification AND at most one email job.
 */
export function emailDedupeKey(eventKey: string): string {
  return eventKey.endsWith(":email") ? eventKey : `${eventKey}:email`;
}
