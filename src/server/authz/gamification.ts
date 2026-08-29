/**
 * Officeverse — gamification authorization (Phase 20). PURE.
 *
 *   Agents / Closers → PARTICIPANTS. See own points / rank / achievements /
 *                      streak / recent events, and the leaderboard.
 *   Admin / HR       → MANAGE the system + investigate any participant's point
 *                      history. NOT automatic participants.
 *
 * Only the SERVER awards points. The browser can request that a business action
 * happened; the server decides whether a qualifying event actually occurred.
 * A client never supplies point amounts, ranks, achievements or scores.
 */
import { HttpError } from "../http-error";

export type GamRole = "admin" | "agent" | "closer" | "hr";

/** Roles that appear ON the leaderboard / earn points. */
export function isGamificationParticipant(role: string): boolean {
  return role === "agent" || role === "closer";
}

/** Roles that manage / investigate gamification. */
export function canManageGamification(role: string): boolean {
  return role === "admin" || role === "hr";
}

export function assertCanManageGamification(role: string): void {
  if (!canManageGamification(role)) {
    throw new HttpError(403, "Only Admin / HR may manage gamification", "forbidden");
  }
}

/** Read a participant's detail: self, or Admin / HR for anyone. */
export function canViewParticipant(
  role: string,
  actorUserId: number,
  targetUserId: number,
): boolean {
  return actorUserId === targetUserId || canManageGamification(role);
}

export function assertCanViewParticipant(
  role: string,
  actorUserId: number,
  targetUserId: number,
): void {
  if (!canViewParticipant(role, actorUserId, targetUserId)) {
    throw new HttpError(403, "You can only view your own gamification profile", "forbidden");
  }
}

/** An admin manual point adjustment must be explicit + reasoned. */
export function assertValidAdjustment(role: string, points: number, reason: string): void {
  assertCanManageGamification(role);
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 100_000) {
    throw new HttpError(400, "Adjustment must be a non-zero integer within ±100000", "bad_amount");
  }
  if (reason.trim().length < 5) {
    throw new HttpError(
      400,
      "A reason (min 5 chars) is required for a point adjustment",
      "reason_required",
    );
  }
}
