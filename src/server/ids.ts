/**
 * Officeverse — canonical business identifiers + idempotency dedupe keys.
 *
 * Business ID conventions are preserved exactly from the current app:
 *   Lead       "TMI_00012345"   (leads.ts nextLeadId — start 12000, step +7)
 *   Follow-up  "FU_00004415"    (followups.ts nextId — start 4400, step +3)
 *   Agent      "AG-00001"
 *   Closer     "CL-00001"
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
export const agentCode = (seq: number): string => `AG-${pad(seq, 5)}`;
export const closerCode = (seq: number): string => `CL-${pad(seq, 5)}`;
export const clientCode = (seq: number): string => `CLT-${pad(seq, 5)}`;

/** Next Lead sequence given the current max numeric part (mirrors nextLeadId). */
export const nextLeadSeq = (maxNumeric: number): number => (maxNumeric || 12000) + 7;
/** Next Follow-up sequence given the current max numeric part. */
export const nextFollowUpSeq = (maxNumeric: number): number => (maxNumeric || 4397) + 3;
/** Next Agent/Closer/Client sequence given the current max numeric part. */
export const nextStaffSeq = (maxNumeric: number): number => (maxNumeric || 0) + 1;

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
