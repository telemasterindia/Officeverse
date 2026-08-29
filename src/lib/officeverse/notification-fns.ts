/**
 * Officeverse — client-callable notification server functions (Phase 6).
 *
 * These live OUTSIDE `src/server/**` on purpose: that directory is import-
 * protected against the client bundle. `createServerFn().handler(...)` keeps
 * the real logic server-side — the TanStack Start compiler strips the handler
 * (and its `@/server/*` imports) from the client build, leaving only an RPC
 * stub. The `inputValidator` runs on both sides, so it uses inline Zod schemas
 * with no server-only imports.
 *
 * Every handler calls `requireUser()` and the service is self-scoped to that
 * session — the browser can never pass a recipient id.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/server/context";
import * as svc from "@/server/notifications/service";
import type { ListNotificationsResult } from "@/server/notifications/service";

const listInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z.coerce.boolean().default(false),
  type: z.string().trim().min(1).max(60).optional(),
});

const markReadInput = z.object({ id: z.coerce.number().int().positive() });

export const listNotificationsFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listInput.parse(d ?? {}))
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
  .inputValidator((d: unknown) => markReadInput.parse(d))
  .handler(async ({ data }): Promise<{ updated: number }> => {
    const user = await requireUser();
    return svc.markNotificationRead(user, data.id);
  });

export const markAllNotificationsReadFn = createServerFn({ method: "POST" })
  .inputValidator(() => null)
  .handler(async (): Promise<{ updated: number }> => {
    const user = await requireUser();
    return svc.markAllNotificationsRead(user);
  });
