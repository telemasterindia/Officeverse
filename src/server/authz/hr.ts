/**
 * Officeverse — HR leave / off authorization (Phase 11). PURE.
 *
 *   Employee (agent/closer/…) → request leave for THEMSELVES only, view own
 *                               leave + own Off. Cannot approve anything,
 *                               cannot create/edit Off, cannot alter sandwich
 *                               or conversion output.
 *   Admin / HR                → view all leave + Off, approve / reject,
 *                               cancel, trigger a recalculation.
 *                               Cannot approve / reject their OWN leave.
 *
 * The acting identity + role always come from the authenticated session.
 */
import { HttpError } from "../http-error";

export type HrRole = "admin" | "agent" | "closer" | "hr";

export function canManageLeave(role: HrRole): boolean {
  return role === "admin" || role === "hr";
}
export const canViewAllHr = canManageLeave;
export const canRecalculateHr = canManageLeave;

/** self only — a client-supplied owner id is never trusted */
export function canRequestLeaveFor(actorUserId: number, targetUserId: number): boolean {
  return actorUserId === targetUserId;
}

/** approve / reject: a manager, but NOT on their own request */
export function canDecideLeave(
  role: HrRole,
  actorUserId: number,
  leaveOwnerUserId: number,
): boolean {
  return canManageLeave(role) && actorUserId !== leaveOwnerUserId;
}

/** cancel: the owner, or a manager */
export function canCancelLeave(
  role: HrRole,
  actorUserId: number,
  leaveOwnerUserId: number,
): boolean {
  return actorUserId === leaveOwnerUserId || canManageLeave(role);
}

export function assertCanManageLeave(role: HrRole): void {
  if (!canManageLeave(role)) {
    throw new HttpError(403, "Only Admin / HR may manage leave", "forbidden");
  }
}
export function assertCanDecideLeave(
  role: HrRole,
  actorUserId: number,
  leaveOwnerUserId: number,
): void {
  if (!canManageLeave(role)) {
    throw new HttpError(403, "Only Admin / HR may decide leave", "forbidden");
  }
  if (actorUserId === leaveOwnerUserId) {
    throw new HttpError(403, "You cannot approve or reject your own leave", "self_approval");
  }
}
