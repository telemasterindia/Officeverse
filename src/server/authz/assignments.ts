/**
 * Officeverse — Assignment Control authorization + eligibility (Phase 22). PURE.
 *
 * THREE distinct, never-mixed operations:
 *   AGENT_FOLLOWUPS   — an agent's follow-up ownership → another agent
 *   CLOSER_LEADS      — a closer's lead ownership      → another closer
 *   CLOSER_FOLLOWUPS  — a closer's follow-up ownership → another closer
 *
 * INVARIANT: reassigning a follow-up NEVER touches `leads.assignedCloserId`;
 * reassigning a lead NEVER touches any `follow_ups.owner_user_id`. Lead
 * ownership and follow-up ownership are independent.
 *
 * Only an Admin may bulk-reassign. Agents / Closers / HR may not (HR is not
 * given a new permission here).
 */
import { HttpError } from "../http-error";

export const ASSIGNMENT_WORK_TYPES = [
  "AGENT_FOLLOWUPS", // agent  → agent   follow-up ownership
  "CLOSER_LEADS", // closer → closer  lead ownership
  "CLOSER_FOLLOWUPS", // closer → closer  follow-up ownership
  "CLOSER_FOLLOWUPS_TO_AGENT", // closer → agent   follow-up ownership (Admin-only)
] as const;
export type AssignmentWorkType = (typeof ASSIGNMENT_WORK_TYPES)[number];

export function isAssignmentWorkType(x: string): x is AssignmentWorkType {
  return (ASSIGNMENT_WORK_TYPES as readonly string[]).includes(x);
}

/** The role the SOURCE owner must have. */
export const WORKTYPE_SOURCE_ROLE: Record<AssignmentWorkType, "agent" | "closer"> = {
  AGENT_FOLLOWUPS: "agent",
  CLOSER_LEADS: "closer",
  CLOSER_FOLLOWUPS: "closer",
  CLOSER_FOLLOWUPS_TO_AGENT: "closer",
};

/** The role the DESTINATION owner must have. (For CLOSER_LEADS the destination
 *  is validated as a real closers.id, not by users.role.) */
export const WORKTYPE_ROLE: Record<AssignmentWorkType, "agent" | "closer"> = {
  AGENT_FOLLOWUPS: "agent",
  CLOSER_LEADS: "closer",
  CLOSER_FOLLOWUPS: "closer",
  CLOSER_FOLLOWUPS_TO_AGENT: "agent",
};

/** What is actually being moved. */
export const WORKTYPE_SUBJECT: Record<AssignmentWorkType, "follow_up" | "lead"> = {
  AGENT_FOLLOWUPS: "follow_up",
  CLOSER_LEADS: "lead",
  CLOSER_FOLLOWUPS: "follow_up",
  CLOSER_FOLLOWUPS_TO_AGENT: "follow_up",
};

/**
 * What subset of a follow-up owner's active work an Admin chooses to move.
 * The server resolves the concrete follow-up ids for every scope except
 * SELECTED (which carries explicit ids). Buckets reuse the exact definitions
 * from the follow-up list repo:
 *   OVERDUE    — SCHEDULED, scheduledAt < now
 *   DUE_TODAY  — SCHEDULED, now ≤ scheduledAt < start-of-tomorrow
 *   UPCOMING   — SCHEDULED, scheduledAt ≥ start-of-tomorrow
 *   ALL_PENDING— SCHEDULED (any date)
 */
export const TRANSFER_SCOPES = [
  "OVERDUE",
  "DUE_TODAY",
  "UPCOMING",
  "ALL_PENDING",
  "SELECTED",
] as const;
export type TransferScope = (typeof TRANSFER_SCOPES)[number];
export function isTransferScope(x: string): x is TransferScope {
  return (TRANSFER_SCOPES as readonly string[]).includes(x);
}

/** A follow-up scheduled this many days ahead (or more) is "long-dated" — the
 *  ~2–3-month horizon an Admin reviews for keep-or-transfer decisions. */
export const LONG_DATED_MIN_DAYS = 55;
export const LONG_DATED_MAX_DAYS = 120;

/**
 * A follow-up is assignable only while it is the single ACTIVE status
 * ("SCHEDULED"). COMPLETED / CANCELLED / CONVERTED are terminal and never
 * reappear in a reassignment workload. (Officeverse has no soft-delete column;
 * lifecycle is the status enum.)
 */
export const ASSIGNABLE_FOLLOWUP_STATUSES = ["SCHEDULED"] as const;

/**
 * A lead is closer-assignable only while a closer is actively working it — the
 * exact in-flight set from the closer status-transition rules
 * (ASSIGNED / ACCEPTED / FOLLOW-UP). NEW has no closer; COMPLETED is a finished
 * sale; REJECTED bounced back to the agent — none are reassignable here.
 */
export const ASSIGNABLE_CLOSER_LEAD_STATUSES = ["ASSIGNED", "ACCEPTED", "FOLLOW-UP"] as const;

export function canReassignAssignments(role: string): boolean {
  return role === "admin";
}

export function assertCanReassignAssignments(role: string): void {
  if (!canReassignAssignments(role)) {
    throw new HttpError(403, "Only an Admin may reassign work", "forbidden");
  }
}
