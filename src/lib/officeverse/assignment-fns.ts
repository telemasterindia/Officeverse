/**
 * Officeverse — client-callable Assignment Control server functions (Phase 22).
 *
 * Outside `src/server/**`. Every handler resolves identity via `requireUser()`
 * and the service enforces `assertCanReassignAssignments` (Admin only). The
 * client sends a selection (ids or "ALL") + a destination owner; the SERVER
 * recomputes the eligible set, scopes every UPDATE, and returns the
 * authoritative requested / reassigned / skipped / failed counts. The client
 * never decides final ownership.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/assignments/service";

const workType = z.enum(["AGENT_FOLLOWUPS", "CLOSER_LEADS", "CLOSER_FOLLOWUPS"]);
const ownerId = z.coerce.number().int().positive();

export const assignmentRosterFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireUser();
    return svc.assignmentRoster(user);
  });

export const assignmentWorkloadFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ workType, ownerId, search: z.string().trim().max(120).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.assignmentWorkload(user, {
      workType: data.workType,
      ownerId: data.ownerId,
      ...(data.search !== undefined ? { search: data.search } : {}),
    });
  });

export const reassignBulkFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        workType,
        fromOwnerId: ownerId,
        toOwnerId: ownerId,
        selection: z.union([
          z.array(z.coerce.number().int().positive()).max(5000),
          z.literal("ALL"),
        ]),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.reassignBulk(
      user,
      {
        workType: data.workType,
        fromOwnerId: data.fromOwnerId,
        toOwnerId: data.toOwnerId,
        selection: data.selection,
        ...(data.reason !== undefined ? { reason: data.reason } : {}),
      },
      requestInfo(),
    );
  });

export const assignmentHistoryFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.assignmentHistory(user, data.limit !== undefined ? { limit: data.limit } : {});
  });
