/**
 * Officeverse — DB-backed notification hooks (Phase 6).
 *
 * Source of truth = the Phase-5 server notification service. Data flow:
 *
 *   React component
 *     → these hooks (React Query)
 *       → server functions (src/lib/officeverse/notification-fns.ts)
 *         → notification service (self-scoped to the authenticated session)
 *           → repository → MySQL
 *
 * The browser NEVER passes a recipient id and NEVER reads localStorage for
 * notification data. Ownership is decided entirely by the server session.
 */
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import {
  listNotificationsFn,
  markAllNotificationsReadFn,
  markNotificationReadFn,
  unreadNotificationCountFn,
} from "./notification-fns";
import {
  markAllReadInResult,
  markOneReadInResult,
  type NotificationListResult,
} from "./notification-optimistic";

/** Conservative bell poll — NOT a scheduler. The real scheduler is server-side. */
const UNREAD_POLL_MS = 60_000;
const DEFAULT_PAGE_SIZE = 20;

export const notificationKeys = {
  all: ["notifications"] as const,
  lists: () => ["notifications", "list"] as const,
  list: (page: number, pageSize: number, unreadOnly: boolean, type: string | null) =>
    ["notifications", "list", { page, pageSize, unreadOnly, type }] as const,
  unread: () => ["notifications", "unread"] as const,
};

export interface UseNotificationListOptions {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
  type?: string;
}

export function useNotificationList(options: UseNotificationListOptions = {}) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const unreadOnly = options.unreadOnly ?? false;
  const type = options.type ?? null;

  return useQuery({
    queryKey: notificationKeys.list(page, pageSize, unreadOnly, type),
    queryFn: () =>
      listNotificationsFn({
        data: { page, pageSize, unreadOnly, ...(type ? { type } : {}) },
      }),
    staleTime: 15_000,
    placeholderData: (prev) => prev, // keep the previous page visible while the next loads
  });
}

export function useUnreadNotificationCount(opts: { poll?: boolean } = {}) {
  const poll = opts.poll ?? true;
  const query = useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: () => unreadNotificationCountFn(),
    staleTime: 30_000,
    refetchInterval: poll ? UNREAD_POLL_MS : false,
    refetchOnWindowFocus: true,
  });
  return { ...query, unread: query.data?.unread ?? 0 };
}

/* --------------------------- mutations --------------------------- */

interface Snapshot {
  entries: Array<[QueryKey, NotificationListResult | undefined]>;
  unread: { unread: number } | undefined;
}

function snapshot(qc: ReturnType<typeof useQueryClient>): Snapshot {
  return {
    entries: qc.getQueriesData<NotificationListResult>({ queryKey: notificationKeys.lists() }),
    unread: qc.getQueryData<{ unread: number }>(notificationKeys.unread()),
  };
}

function restore(qc: ReturnType<typeof useQueryClient>, snap: Snapshot) {
  for (const [key, data] of snap.entries) qc.setQueryData(key, data);
  if (snap.unread) qc.setQueryData(notificationKeys.unread(), snap.unread);
}

/** Mark ONE notification read. Optimistic; rolls back on server failure. */
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => markNotificationReadFn({ data: { id } }),
    onMutate: async (id): Promise<Snapshot> => {
      await qc.cancelQueries({ queryKey: notificationKeys.all });
      const snap = snapshot(qc);
      const iso = new Date().toISOString();
      qc.setQueriesData<NotificationListResult>({ queryKey: notificationKeys.lists() }, (old) =>
        old ? markOneReadInResult(old, id, iso) : old,
      );
      qc.setQueryData<{ unread: number }>(notificationKeys.unread(), (old) =>
        old ? { unread: Math.max(0, old.unread - 1) } : old,
      );
      return snap;
    },
    onError: (_err, _id, snap) => {
      if (snap) restore(qc, snap);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/** Mark ALL of the current user's notifications read (server-side bulk op). */
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsReadFn(),
    onMutate: async (): Promise<Snapshot> => {
      await qc.cancelQueries({ queryKey: notificationKeys.all });
      const snap = snapshot(qc);
      const iso = new Date().toISOString();
      qc.setQueriesData<NotificationListResult>({ queryKey: notificationKeys.lists() }, (old) =>
        old ? markAllReadInResult(old, iso) : old,
      );
      qc.setQueryData(notificationKeys.unread(), { unread: 0 });
      return snap;
    },
    onError: (_err, _vars, snap) => {
      if (snap) restore(qc, snap);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}
