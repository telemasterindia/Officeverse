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
  "AGENT_FOLLOWUPS",
  "CLOSER_LEADS",
  "CLOSER_FOLLOWUPS",
] as const;
export type AssignmentWorkType = (typeof ASSIGNMENT_WORK_TYPES)[number];

export function isAssignmentWorkType(x: string): x is AssignmentWorkType {
  return (ASSIGNMENT_WORK_TYPES as readonly string[]).includes(x);
}

/** The role the owner/destination must have for each work type. */
export const WORKTYPE_ROLE: Record<AssignmentWorkType, "agent" | "closer"> = {
  AGENT_FOLLOWUPS: "agent",
  CLOSER_LEADS: "closer",
  CLOSER_FOLLOWUPS: "closer",
};

/** What is actually being moved. */
export const WORKTYPE_SUBJECT: Record<AssignmentWorkType, "follow_up" | "lead"> = {
  AGENT_FOLLOWUPS: "follow_up",
  CLOSER_LEADS: "lead",
  CLOSER_FOLLOWUPS: "follow_up",
};

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
