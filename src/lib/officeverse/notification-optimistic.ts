/**
 * Officeverse — pure optimistic-update helpers for the notification cache
 * (Phase 6). Kept separate from the React hook so they can be unit-tested.
 *
 * These operate on the exact shape returned by `listNotificationsFn`
 * (ListNotificationsResult). On a server failure the hook simply restores the
 * previous snapshot — it never leaves the UI showing a false "read" state.
 */
import type { NotificationDTO } from "@/server/notifications/dto";
import type { ListNotificationsResult } from "@/server/notifications/service";

export type NotificationListResult = ListNotificationsResult;

/** Mark a single notification read in a cached page. No-op if already read/absent. */
export function markOneReadInResult(
  result: NotificationListResult,
  id: number,
  readAtIso: string,
): NotificationListResult {
  let changed = false;
  const notifications = result.notifications.map((n): NotificationDTO => {
    if (n.id !== id || !n.unread) return n;
    changed = true;
    return { ...n, unread: false, read_at: readAtIso };
  });
  if (!changed) return result;
  return { ...result, notifications, unread: Math.max(0, result.unread - 1) };
}

/** Mark every notification in a cached page read. */
export function markAllReadInResult(
  result: NotificationListResult,
  readAtIso: string,
): NotificationListResult {
  const notifications = result.notifications.map((n): NotificationDTO =>
    n.unread ? { ...n, unread: false, read_at: readAtIso } : n,
  );
  return { ...result, notifications, unread: 0 };
}

/** Decrement a raw unread counter without going negative. */
export function decrementUnread(current: number, by = 1): number {
  return Math.max(0, current - by);
}
