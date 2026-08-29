/**
 * Officeverse — notification authorization (Phase 5). PURE functions, no DB.
 *
 * OWNERSHIP MODEL
 *   - A notification belongs to exactly one recipient (`recipientUserId`).
 *   - Only that recipient may read it or mark it read — INCLUDING admins:
 *     there is no cross-user "see everyone's bell feed" in Phase 5. An admin
 *     sees the notifications addressed to that admin, nothing more.
 *   - The recipient is ALWAYS resolved server-side. No list/read/mark operation
 *     accepts a recipient id from the client, so a browser cannot request
 *     someone else's feed by passing another user id.
 *   - Email jobs have NO client-facing surface at all (internal creation only).
 */
import { HttpError } from "../http-error";
import type { User } from "@/lib/db/schema";

export interface NotificationActor {
  user: Pick<User, "id" | "role">;
}

/** Only the recipient — no admin/hr override. */
export function canReadNotification(a: NotificationActor, n: { recipientUserId: number }): boolean {
  return n.recipientUserId === a.user.id;
}

export const canMarkNotificationRead = canReadNotification;

/**
 * List scope is ALWAYS the caller's own feed. Returned as an object (not a
 * boolean) to mirror leadScope/followUpScope and to make the "never all"
 * guarantee explicit and testable.
 */
export function notificationListScope(a: NotificationActor): { recipientUserId: number } {
  return { recipientUserId: a.user.id };
}

export function assertCanReadNotification(
  a: NotificationActor,
  n: { recipientUserId: number },
): void {
  if (!canReadNotification(a, n)) {
    throw new HttpError(403, "Not your notification", "forbidden");
  }
}
