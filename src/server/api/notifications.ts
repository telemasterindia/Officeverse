/**
 * Officeverse — notification server functions (Phase 5).
 *
 * TanStack Start `createServerFn`. Each fn: authenticate → Zod-validate →
 * delegate to the notification service, which is ALWAYS self-scoped to the
 * authenticated user. No function accepts a recipient id, so a browser cannot
 * read or mutate another user's feed.
 *
 * There is deliberately NO email-job server function — email jobs are created
 * internally (event integration / future scheduler) only.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireUser } from "../context";
import * as svc from "../notifications/service";
import {
  listNotificationsSchema,
  markAllNotificationsReadSchema,
  markNotificationReadSchema,
} from "../validation/notifications";
import type { ListNotificationsResult } from "../notifications/service";

export const listNotificationsFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listNotificationsSchema.parse(d ?? {}))
  .handler(async ({ data }): Promise<ListNotificationsResult> => {
    const user = await requireUser();
    return svc.listNotifications(user, data);
  });

export const unreadNotificationCountFn = createServerFn({ method: "GET" })
  .inputValidator(() => null)
  .handler(async (): Promise<{ unread: number }> => {
    const user = await requireUser();
    return svc.getUnreadNotificationCount(user);
  });

export const markNotificationReadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => markNotificationReadSchema.parse(d))
  .handler(async ({ data }): Promise<{ updated: number }> => {
    const user = await requireUser();
    return svc.markNotificationRead(user, data.id);
  });

export const markAllNotificationsReadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => markAllNotificationsReadSchema.parse(d ?? {}))
  .handler(async (): Promise<{ updated: number }> => {
    const user = await requireUser();
    return svc.markAllNotificationsRead(user);
  });
