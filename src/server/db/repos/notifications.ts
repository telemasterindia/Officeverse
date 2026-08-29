/**
 * Officeverse — notification repository (Phase 5). DATA ACCESS ONLY.
 *
 * No authorization here (see ../../authz/notifications.ts). The recipient guard
 * on mutating queries (WHERE recipient_user_id = ?) is a defence-in-depth data
 * constraint, not the security boundary.
 *
 * Deduplication is enforced by the `notifications_dedupe_uq` UNIQUE index on
 * `dedupe_key`. A NULL key never collides (MySQL allows many NULLs), so ad-hoc
 * one-off notifications are always inserted.
 */
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import { notifications, type NewNotification, type Notification } from "@/lib/db/schema";

function rowsAffected(res: unknown): number {
  const head = Array.isArray(res) ? res[0] : res;
  return Number((head as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

function isDuplicateKey(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /duplicate entry|er_dup_entry|dedupe_uq/i.test(m);
}

/* -------------------------------- reads ------------------------------- */

export async function getNotificationById(
  id: number,
  ex: DBX = getDb(),
): Promise<Notification | undefined> {
  const rows = await ex.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  return rows[0];
}

export async function getNotificationByDedupeKey(
  key: string,
  ex: DBX = getDb(),
): Promise<Notification | undefined> {
  const rows = await ex
    .select()
    .from(notifications)
    .where(eq(notifications.dedupeKey, key))
    .limit(1);
  return rows[0];
}

export interface ListNotificationsQuery {
  recipientUserId: number;
  unreadOnly?: boolean | undefined;
  type?: string | undefined;
  limit: number;
  offset: number;
}

export async function listNotifications(
  q: ListNotificationsQuery,
  ex: DBX = getDb(),
): Promise<{ rows: Notification[]; total: number }> {
  const conds: SQL[] = [eq(notifications.recipientUserId, q.recipientUserId)];
  if (q.unreadOnly) conds.push(isNull(notifications.readAt));
  if (q.type) conds.push(eq(notifications.type, q.type));
  const where = and(...conds);

  const [rows, totals] = await Promise.all([
    ex
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(q.limit)
      .offset(q.offset),
    ex
      .select({ n: sql<number>`count(*)` })
      .from(notifications)
      .where(where),
  ]);
  return { rows, total: Number(totals[0]?.n ?? 0) };
}

export async function countUnread(recipientUserId: number, ex: DBX = getDb()): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, recipientUserId), isNull(notifications.readAt)));
  return Number(rows[0]?.n ?? 0);
}

/* ------------------------------- writes ----------------------------- */

/**
 * Insert one notification. If `dedupeKey` is set and already present, this is a
 * no-op and the existing row is returned with `created: false`.
 */
export async function insertNotification(
  values: NewNotification,
  ex: DBX = getDb(),
): Promise<{ row: Notification; created: boolean }> {
  if (values.dedupeKey) {
    const existing = await getNotificationByDedupeKey(values.dedupeKey, ex);
    if (existing) return { row: existing, created: false };
  }
  try {
    const res = await ex.insert(notifications).values(values);
    const insertId = Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
    const row = insertId
      ? await getNotificationById(insertId, ex)
      : values.dedupeKey
        ? await getNotificationByDedupeKey(values.dedupeKey, ex)
        : undefined;
    if (!row) throw new Error("Notification insert did not return a row");
    return { row, created: true };
  } catch (err) {
    if (isDuplicateKey(err) && values.dedupeKey) {
      const row = await getNotificationByDedupeKey(values.dedupeKey, ex);
      if (row) return { row, created: false };
    }
    throw err;
  }
}

/**
 * Batch insert. Rows whose `dedupe_key` already exists are silently skipped by
 * the DB (ON DUPLICATE KEY … no-op). Returns the number of rows the statement
 * reported as inserted (best-effort).
 */
export async function bulkInsertNotifications(
  rows: NewNotification[],
  ex: DBX = getDb(),
): Promise<number> {
  if (!rows.length) return 0;
  const res = await ex
    .insert(notifications)
    .values(rows)
    .onDuplicateKeyUpdate({ set: { dedupeKey: sql`${notifications.dedupeKey}` } });
  return rowsAffected(res);
}

/**
 * Mark one notification read. The `recipient_user_id` predicate means a caller
 * can never flip a row that is not theirs — 0 rows affected if it is missing,
 * not theirs, or already read.
 */
export async function markRead(
  id: number,
  recipientUserId: number,
  readAt: string,
  ex: DBX = getDb(),
): Promise<number> {
  const res = await ex
    .update(notifications)
    .set({ readAt })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.recipientUserId, recipientUserId),
        isNull(notifications.readAt),
      ),
    );
  return rowsAffected(res);
}

/** Mark every unread notification for one recipient read. Returns the count. */
export async function markAllRead(
  recipientUserId: number,
  readAt: string,
  ex: DBX = getDb(),
): Promise<number> {
  const res = await ex
    .update(notifications)
    .set({ readAt })
    .where(and(eq(notifications.recipientUserId, recipientUserId), isNull(notifications.readAt)));
  return rowsAffected(res);
}
