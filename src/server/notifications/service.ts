/**
 * Officeverse — notification service (Phase 5).
 *
 * Business rules for the in-app bell feed. All read/list/mark operations are
 * SELF-SCOPED to the authenticated user via ../authz/notifications.ts — the
 * recipient is never taken from the request. `createNotification(s)` is for
 * INTERNAL callers only (event integration, and the future scheduler): the
 * caller passes an already-resolved `recipientUserId`.
 */
import { notificationListScope, type NotificationActor } from "../authz/notifications";
import { nowIST } from "../time";
import { toNotificationDTO, type NotificationDTO } from "./dto";
import * as repo from "../db/repos/notifications";
import type { NewNotification, User } from "@/lib/db/schema";
import type { ListNotificationsInput } from "../validation/notifications";

function actorOf(user: Pick<User, "id" | "role">): NotificationActor {
  return { user: { id: user.id, role: user.role } };
}

export interface CreateNotificationInput {
  recipientUserId: number;
  type: string;
  title: string;
  message: string;
  relatedEntityType?: string | null;
  relatedEntityId?: number | null;
  relatedEntityCode?: string | null;
  /** business-event-derived idempotency key (see src/server/ids.ts) */
  dedupeKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

function toRow(input: CreateNotificationInput, createdAt: string): NewNotification {
  return {
    recipientUserId: input.recipientUserId,
    type: input.type.slice(0, 60),
    title: input.title.slice(0, 255),
    message: input.message.slice(0, 1000),
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
    relatedEntityCode: input.relatedEntityCode ?? null,
    dedupeKey: input.dedupeKey ?? null,
    metadata: input.metadata ?? null,
    createdAt,
  };
}

/**
 * Internal. Create one notification; a repeated `dedupeKey` is a no-op.
 * Returns whether a row was actually created.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<{ id: number; created: boolean }> {
  const { row, created } = await repo.insertNotification(toRow(input, nowIST()));
  return { id: row.id, created };
}

/** Internal. Batch create; DB-level dedupe skips keys that already exist. */
export async function createNotifications(
  inputs: CreateNotificationInput[],
): Promise<{ requested: number; inserted: number }> {
  if (!inputs.length) return { requested: 0, inserted: 0 };
  const now = nowIST();
  const inserted = await repo.bulkInsertNotifications(inputs.map((i) => toRow(i, now)));
  return { requested: inputs.length, inserted };
}

/* ------------------------------ read side --------------------------- */

export interface ListNotificationsResult {
  notifications: NotificationDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  unread: number;
}

export async function listNotifications(
  user: User,
  input: ListNotificationsInput,
): Promise<ListNotificationsResult> {
  const scope = notificationListScope(actorOf(user)); // ALWAYS { recipientUserId: user.id }
  const [{ rows, total }, unread] = await Promise.all([
    repo.listNotifications({
      recipientUserId: scope.recipientUserId,
      unreadOnly: input.unreadOnly,
      type: input.type,
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    }),
    repo.countUnread(scope.recipientUserId),
  ]);
  return {
    notifications: rows.map(toNotificationDTO),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
    unread,
  };
}

export async function getUnreadNotificationCount(user: User): Promise<{ unread: number }> {
  const scope = notificationListScope(actorOf(user));
  return { unread: await repo.countUnread(scope.recipientUserId) };
}

/**
 * Mark one notification read. Scoped by recipient in the WHERE clause, so a
 * caller can never affect a row that is not theirs. Idempotent: `updated` is 0
 * if the row is missing, not theirs, or already read.
 */
export async function markNotificationRead(user: User, id: number): Promise<{ updated: number }> {
  const scope = notificationListScope(actorOf(user));
  const updated = await repo.markRead(id, scope.recipientUserId, nowIST());
  return { updated };
}

export async function markAllNotificationsRead(user: User): Promise<{ updated: number }> {
  const scope = notificationListScope(actorOf(user));
  const updated = await repo.markAllRead(scope.recipientUserId, nowIST());
  return { updated };
}
