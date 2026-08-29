/**
 * Officeverse — Follow-up authorization + state machine (Phase 4 / Phase 18).
 *
 * PURE FUNCTIONS. No DB, no request. The service layer calls the `assert*`
 * wrappers before every mutation. The client security boundary lives here.
 *
 * OWNERSHIP MODEL (from the existing app + Phase-4 correction):
 *   - A follow-up belongs to `ownerUserId` (a users.id) — the agent OR closer
 *     who created the callback. NEVER reassigned.
 *   - Only the OWNER may edit/reschedule/complete/cancel their follow-up, and
 *     only while it is active (status SCHEDULED).
 *   - CONVERT-to-Lead: the OWNER (agent or closer) may convert their own active
 *     follow-up; ADMIN may convert any active follow-up. The resulting Lead's
 *     ownership mirrors the follow-up owner's role (see conversionOwnershipPlan).
 *   - admin/hr may READ any follow-up + its history. They are NOT granted the
 *     other owner-only actions (customer edit, reschedule, complete, cancel).
 *   - Closers are not granted follow-up visibility just for being closers — only
 *     follow-ups they own. A converted Lead is governed by Lead authorization.
 */
import { HttpError } from "../http-error";
import type { FollowUp, User } from "@/lib/db/schema";

export interface FollowUpActor {
  user: Pick<User, "id" | "role">;
}

type FUOwnerStatus = Pick<FollowUp, "ownerUserId" | "status">;

export type Decision = { ok: true } | { ok: false; reason: string; code: string };
const GRANT: Decision = { ok: true };
const deny = (reason: string, code: string): Decision => ({ ok: false, reason, code });

const isAdmin = (a: FollowUpActor) => a.user.role === "admin" || a.user.role === "hr";
const isOwner = (a: FollowUpActor, fu: Pick<FollowUp, "ownerUserId">) =>
  fu.ownerUserId === a.user.id;

export const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "CONVERTED"] as const;
export function isTerminal(status: FollowUp["status"]): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/* -------------------------------- read ------------------------------- */

/** owner → own · admin/hr → any · everyone else → no */
export function canReadFollowUp(a: FollowUpActor, fu: Pick<FollowUp, "ownerUserId">): boolean {
  return isAdmin(a) || isOwner(a, fu);
}

/** History follows the same visibility as the follow-up itself. */
export const canReadFollowUpHistory = canReadFollowUp;

/* ------------------------------- create ----------------------------- */

/** agent or closer (owner forced to self in the service). Not admin/hr. */
export function canCreateFollowUp(a: FollowUpActor): boolean {
  return a.user.role === "agent" || a.user.role === "closer";
}

/* --------------------- owner-only active actions -------------------- */

function ownerActive(a: FollowUpActor, fu: FUOwnerStatus, verb: string): Decision {
  if (isAdmin(a) && !isOwner(a, fu)) {
    return deny(`Only the follow-up owner can ${verb} it`, "not_owner");
  }
  if (!isOwner(a, fu)) return deny("Not your follow-up", "not_owner");
  if (isTerminal(fu.status)) {
    return deny(`This follow-up is ${fu.status.toLowerCase()} and cannot be ${verb}`, "terminal");
  }
  if (fu.status !== "SCHEDULED") {
    return deny(`Follow-up is not in an active state`, "not_active");
  }
  return GRANT;
}

export const canUpdateFollowUpCustomer = (a: FollowUpActor, fu: FUOwnerStatus): Decision =>
  ownerActive(a, fu, "edit");
export const canRescheduleFollowUp = (a: FollowUpActor, fu: FUOwnerStatus): Decision =>
  ownerActive(a, fu, "reschedule");
export const canCompleteFollowUp = (a: FollowUpActor, fu: FUOwnerStatus): Decision =>
  ownerActive(a, fu, "complete");
export const canCancelFollowUp = (a: FollowUpActor, fu: FUOwnerStatus): Decision =>
  ownerActive(a, fu, "cancel");

/**
 * Convert-to-Lead — Phase-4 correction: BOTH agents and closers may convert
 * their own active follow-up.
 *   - agent owner  → resulting Lead's originating agent = that agent;
 *                    a Closer must be selected (service enforces).
 *   - closer owner → resulting Lead has NO originating agent (agent_id NULL);
 *                    the SAME closer stays operationally responsible. No
 *                    closer-selection step; selecting another closer is refused.
 *   - admin        → may convert any follow-up; the resulting Lead's ownership
 *                    mirrors the follow-up owner's model (service resolves it).
 * A non-owner non-admin cannot convert someone else's follow-up.
 */
export function canConvertFollowUp(a: FollowUpActor, fu: FUOwnerStatus): Decision {
  if (a.user.role === "admin") {
    if (isTerminal(fu.status)) {
      return deny(
        `This follow-up is ${fu.status.toLowerCase()} and cannot be converted`,
        fu.status === "CONVERTED" ? "already_converted" : "terminal",
      );
    }
    if (fu.status !== "SCHEDULED") return deny("Follow-up is not in an active state", "not_active");
    return GRANT;
  }
  return ownerActive(a, fu, "convert");
}

/* ------------------- conversion ownership (pure) ------------------ */

export type OwnerRole = "agent" | "closer";
export type ConversionOwnershipPlan =
  { kind: "agent"; needsCloserSelection: true } | { kind: "closer"; keepSameCloser: true };

/**
 * How the resulting Lead is owned, given the FOLLOW-UP owner's role.
 * (The follow-up owner's role — not the acting user's — decides this, so an
 * admin converting a closer's follow-up still keeps it with that closer.)
 */
export function conversionOwnershipPlan(ownerRole: OwnerRole): ConversionOwnershipPlan {
  return ownerRole === "agent"
    ? { kind: "agent", needsCloserSelection: true }
    : { kind: "closer", keepSameCloser: true };
}

/**
 * Validate the client-supplied `to_closer_code` against the plan.
 *   - agent  → a closer code is REQUIRED
 *   - closer → a closer code must be ABSENT, or equal the follow-up owner's own
 *              closer code (no reassignment)
 */
export function validateConversionCloser(
  ownerRole: OwnerRole,
  toCloserCode: string | null,
  ownerCloserCode: string | null,
): Decision {
  if (ownerRole === "agent") {
    return toCloserCode
      ? GRANT
      : deny("Agent conversion must select a Closer for the new Lead", "closer_required");
  }
  if (toCloserCode && toCloserCode !== ownerCloserCode) {
    return deny(
      "A closer's follow-up converts to a Lead that stays with that same closer",
      "closer_cannot_reassign",
    );
  }
  return GRANT;
}

/* ---------------------- customer field scope ---------------------- */

/** Legacy/DTO field names the owner may edit on an active follow-up. */
export const CUSTOMER_FIELDS = [
  "full_name",
  "customer_name",
  "phone",
  "email",
  "address",
  "city",
  "state",
  "zip",
  "debt_amount",
  "credit",
  "credit_status",
  "current_late",
  "current_debts",
  "comment",
] as const;

const CUSTOMER_SET = new Set<string>(CUSTOMER_FIELDS);

export function filterCustomerPatch<T extends Record<string, unknown>>(
  patch: T,
): { allowed: Partial<T>; rejected: string[] } {
  const allowed: Partial<T> = {};
  const rejected: string[] = [];
  for (const k of Object.keys(patch)) {
    if (patch[k] === undefined) continue;
    if (CUSTOMER_SET.has(k)) (allowed as Record<string, unknown>)[k] = patch[k];
    else rejected.push(k);
  }
  return { allowed, rejected };
}

/* --------------------------- state machine ---------------------------- *
 * The follow-up RECORD stays "SCHEDULED" through the whole reschedule chain;
 * rescheduling is recorded only in follow_up_attempts history. The record has
 * exactly three legal exits, each terminal and irreversible.
 * ------------------------------------------------------------------- */

export type FollowUpAction = "reschedule" | "complete" | "cancel" | "convert";

const LEGAL_FROM_SCHEDULED: Record<FollowUpAction, true> = {
  reschedule: true,
  complete: true,
  cancel: true,
  convert: true,
};

/** Is `action` legal given the current record status? */
export function canTransition(status: FollowUp["status"], action: FollowUpAction): Decision {
  if (status === "SCHEDULED") {
    return LEGAL_FROM_SCHEDULED[action] ? GRANT : deny(`Illegal action "${action}"`, "illegal");
  }
  // COMPLETED / CANCELLED / CONVERTED are terminal
  return deny(
    `A ${status.toLowerCase()} follow-up cannot be ${action}d`,
    status === "CONVERTED" && action === "convert" ? "already_converted" : "terminal",
  );
}

/** Resulting record status after `action` (reschedule keeps SCHEDULED). */
export function nextStatus(action: FollowUpAction): FollowUp["status"] {
  switch (action) {
    case "reschedule":
      return "SCHEDULED";
    case "complete":
      return "COMPLETED";
    case "cancel":
      return "CANCELLED";
    case "convert":
      return "CONVERTED";
  }
}

/* ---------------------------- assertions -------------------------- */

export function assertCanReadFollowUp(a: FollowUpActor, fu: Pick<FollowUp, "ownerUserId">): void {
  if (!canReadFollowUp(a, fu)) {
    throw new HttpError(403, "Not authorized to view this follow-up", "forbidden");
  }
}
export function assertCanCreateFollowUp(a: FollowUpActor): void {
  if (!canCreateFollowUp(a)) {
    throw new HttpError(403, "Your role cannot create follow-ups", "forbidden");
  }
}
function assertDecision(d: Decision): void {
  if (d.ok) return;
  const status = d.code === "terminal" || d.code === "not_active" ? 422 : 403;
  throw new HttpError(status, d.reason, d.code);
}
export const assertCanUpdateFollowUpCustomer = (a: FollowUpActor, fu: FUOwnerStatus) =>
  assertDecision(canUpdateFollowUpCustomer(a, fu));
export const assertCanRescheduleFollowUp = (a: FollowUpActor, fu: FUOwnerStatus) =>
  assertDecision(canRescheduleFollowUp(a, fu));
export const assertCanCompleteFollowUp = (a: FollowUpActor, fu: FUOwnerStatus) =>
  assertDecision(canCompleteFollowUp(a, fu));
export const assertCanCancelFollowUp = (a: FollowUpActor, fu: FUOwnerStatus) =>
  assertDecision(canCancelFollowUp(a, fu));
export const assertCanConvertFollowUp = (a: FollowUpActor, fu: FUOwnerStatus) =>
  assertDecision(canConvertFollowUp(a, fu));

/** List scope: owner → own; admin/hr → all (optionally filtered by owner). */
export type FollowUpScope = { kind: "all" } | { kind: "owner"; ownerUserId: number };
export function followUpScope(a: FollowUpActor): FollowUpScope {
  return isAdmin(a) ? { kind: "all" } : { kind: "owner", ownerUserId: a.user.id };
}
