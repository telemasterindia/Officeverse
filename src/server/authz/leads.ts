/**
 * Officeverse — Lead authorization predicates (Phase 3 / Phase 18).
 *
 * PURE FUNCTIONS. No DB, no request, no session — they take a resolved actor
 * (`LeadActor`) and the relevant lead columns, and return a decision. This is
 * the server-side security boundary; the service layer calls the `assert*`
 * wrappers before every repository mutation. RoleGate on the client is UX only.
 *
 * Ownership model (from the existing app + Phase-1/4 schema):
 *   - `leads.agentId` is the ORIGINATING agent and is immutable. It is NULL for
 *     a lead produced by converting a closer-owned follow-up (no agent involved).
 *   - `leads.assignedCloserId` is the OPERATIONAL closer (null until an agent
 *     transfers it; set immediately when a closer's follow-up converts).
 *   - A lead that has a closer (assignedCloserId != null, i.e. status != NEW) is
 *     TRANSFERRED and becomes READ-ONLY to the originating agent.
 *   - Closer authorization keys entirely off `assignedCloserId`, so a
 *     null-agent (closer-originated) lead works normally for its closer.
 */
import { HttpError } from "../http-error";
import type { Lead, User } from "@/lib/db/schema";

export interface LeadActor {
  user: Pick<User, "id" | "role">;
  /** resolved agents.id for an agent user, else null */
  agentId: number | null;
  /** resolved closers.id for a closer user, else null */
  closerId: number | null;
}

type LeadOwn = Pick<Lead, "agentId" | "assignedCloserId">;
type LeadState = Pick<Lead, "agentId" | "assignedCloserId" | "status">;

export type Decision = { ok: true } | { ok: false; reason: string; code: string };
const GRANT: Decision = { ok: true };
const deny = (reason: string, code: string): Decision => ({ ok: false, reason, code });

const isAdmin = (a: LeadActor) => a.user.role === "admin";
const isHr = (a: LeadActor) => a.user.role === "hr";

/* ------------------------------- read --------------------------------- */

/** admin/hr → any · agent → own submissions · closer → own assignments */
export function canReadLead(a: LeadActor, lead: LeadOwn): boolean {
  if (isAdmin(a) || isHr(a)) return true;
  if (a.user.role === "agent") return a.agentId != null && lead.agentId === a.agentId;
  if (a.user.role === "closer") return a.closerId != null && lead.assignedCloserId === a.closerId;
  return false;
}

/* ------------------------------ create -------------------------------- */

/**
 * admin + agent. Closers receive leads only via Follow-up → Convert (Phase 4),
 * not via the direct create path.
 */
export function canCreateLead(a: LeadActor): boolean {
  return a.user.role === "admin" || a.user.role === "agent";
}

/* ------------------------------ update -------------------------------- */

/**
 * admin → any.
 * agent → ONLY their own lead that is still NEW and unassigned. Once a closer
 *         is assigned the lead is read-only to the agent (transferred_readonly).
 * closer → ONLY a lead currently assigned to them (field scope enforced by
 *          `updatableFields` / `canSetLeadStatus`).
 */
export function canUpdateLead(a: LeadActor, lead: LeadState): Decision {
  if (isAdmin(a)) return GRANT;
  if (a.user.role === "agent") {
    if (a.agentId == null || lead.agentId !== a.agentId) return deny("Not your lead", "not_owner");
    if (lead.assignedCloserId != null || lead.status !== "NEW") {
      return deny("This lead has been transferred and is read-only", "transferred_readonly");
    }
    return GRANT;
  }
  if (a.user.role === "closer") {
    if (a.closerId == null || lead.assignedCloserId !== a.closerId) {
      return deny("Lead is not assigned to you", "not_assignee");
    }
    return GRANT;
  }
  return deny("Your role cannot update leads", "role_forbidden");
}

/* ---------------------------- transfer -------------------------------- */

/**
 * admin → assign/reassign to any closer.
 * agent → assign a closer to their OWN lead that is still unassigned. An agent
 *         cannot re-transfer once a closer is set.
 * closer → never (only admin reassigns between closers).
 */
export function canTransferLead(a: LeadActor, lead: LeadState): Decision {
  if (isAdmin(a)) return GRANT;
  if (a.user.role === "agent") {
    if (a.agentId == null || lead.agentId !== a.agentId) return deny("Not your lead", "not_owner");
    if (lead.assignedCloserId != null) {
      return deny("This lead has already been transferred", "already_transferred");
    }
    return GRANT;
  }
  return deny("Only an admin or the submitting agent can transfer a lead", "role_forbidden");
}

/* --------------------- field-level update scope ---------------------- */

/** Editable field keys use the legacy/DTO names (customer_name, debt_amount…). */
const AGENT_FIELDS = [
  "customer_name",
  "phone",
  "email",
  "address",
  "city",
  "state",
  "zip",
  "debt_amount",
  "credit",
  "current_late",
  "file_name",
  "comment",
] as const;
const CLOSER_FIELDS = ["status", "comment"] as const;

export function updatableFields(a: LeadActor): ReadonlySet<string> {
  if (isAdmin(a)) return new Set<string>([...AGENT_FIELDS, "status"]);
  if (a.user.role === "agent") return new Set<string>(AGENT_FIELDS);
  if (a.user.role === "closer") return new Set<string>(CLOSER_FIELDS);
  return new Set<string>();
}

/** Split a patch into what this actor may write vs. what is rejected. */
export function filterUpdatablePatch<T extends Record<string, unknown>>(
  a: LeadActor,
  patch: T,
): { allowed: Partial<T>; rejected: string[] } {
  const allow = updatableFields(a);
  const allowed: Partial<T> = {};
  const rejected: string[] = [];
  for (const k of Object.keys(patch)) {
    if (patch[k] === undefined) continue;
    if (allow.has(k)) (allowed as Record<string, unknown>)[k] = patch[k];
    else rejected.push(k);
  }
  return { allowed, rejected };
}

/* --------------------- status transition rules --------------------- */

const CLOSER_TRANSITIONS: Record<string, ReadonlyArray<Lead["status"]>> = {
  ASSIGNED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["COMPLETED", "FOLLOW-UP"],
  "FOLLOW-UP": ["ACCEPTED", "COMPLETED"],
};

/** Which status changes an actor may make on a given lead. Admin → any. */
export function canSetLeadStatus(
  a: LeadActor,
  lead: Pick<Lead, "status">,
  next: Lead["status"],
): Decision {
  if (isAdmin(a)) return GRANT;
  if (a.user.role === "closer") {
    const allowed = CLOSER_TRANSITIONS[lead.status] ?? [];
    return allowed.includes(next)
      ? GRANT
      : deny(`A closer cannot change status ${lead.status} → ${next}`, "bad_transition");
  }
  return deny("Your role cannot change lead status", "role_forbidden");
}

/* ------------------------- list-query scope ----------------------- */

export type LeadScope =
  | { kind: "all" }
  | { kind: "agent"; agentId: number }
  | { kind: "closer"; closerId: number }
  | { kind: "none" };

export function leadScope(a: LeadActor): LeadScope {
  if (isAdmin(a) || isHr(a)) return { kind: "all" };
  if (a.user.role === "agent") {
    return a.agentId != null ? { kind: "agent", agentId: a.agentId } : { kind: "none" };
  }
  if (a.user.role === "closer") {
    return a.closerId != null ? { kind: "closer", closerId: a.closerId } : { kind: "none" };
  }
  return { kind: "none" };
}

/* ---------------------------- assertions -------------------------- */

export function assertCanReadLead(a: LeadActor, lead: LeadOwn): void {
  if (!canReadLead(a, lead)) {
    throw new HttpError(403, "Not authorized to view this lead", "forbidden");
  }
}
export function assertCanCreateLead(a: LeadActor): void {
  if (!canCreateLead(a)) throw new HttpError(403, "Not authorized to create leads", "forbidden");
}
export function assertCanUpdateLead(a: LeadActor, lead: LeadState): void {
  const d = canUpdateLead(a, lead);
  if (!d.ok) throw new HttpError(403, d.reason, d.code);
}
export function assertCanTransferLead(a: LeadActor, lead: LeadState): void {
  const d = canTransferLead(a, lead);
  if (!d.ok) throw new HttpError(403, d.reason, d.code);
}
