/**
 * Officeverse — profile-photo authorization (Phase 19). PURE.
 *
 *   Any employee  → manage / view their OWN photo.
 *   Admin / HR    → manage / view any employee's photo.
 *
 * The acting identity + role always come from the authenticated session. A
 * client-supplied target user id is only honoured for Admin / HR; for everyone
 * else the target is forced to `self`.
 */
import { HttpError } from "../http-error";

export type PhotoRole = "admin" | "agent" | "closer" | "hr";

export function isPhotoManager(role: string): boolean {
  return role === "admin" || role === "hr";
}

export function canManagePhotoFor(
  role: string,
  actorUserId: number,
  targetUserId: number,
): boolean {
  return actorUserId === targetUserId || isPhotoManager(role);
}

export function assertCanManagePhotoFor(
  role: string,
  actorUserId: number,
  targetUserId: number,
): void {
  if (!canManagePhotoFor(role, actorUserId, targetUserId)) {
    throw new HttpError(403, "You can only manage your own profile photo", "forbidden");
  }
}

/** Resolve the effective target: self for a normal employee, the requested
 *  user for Admin / HR. Never trusts a client id for a non-manager. */
export function resolvePhotoTarget(
  role: string,
  actorUserId: number,
  requestedUserId: number | null | undefined,
): number {
  if (requestedUserId == null || requestedUserId === actorUserId) return actorUserId;
  if (isPhotoManager(role)) return requestedUserId;
  return actorUserId;
}
