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

const workType = z.enum([
  "AGENT_FOLLOWUPS",
  "CLOSER_LEADS",
  "CLOSER_FOLLOWUPS",
  "CLOSER_FOLLOWUPS_TO_AGENT",
]);
const transferScope = z.enum(["OVERDUE", "DUE_TODAY", "UPCOMING", "ALL_PENDING", "SELECTED"]);
const ownerId = z.coerce.number().int().positive();

export const assignmentRosterFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ process: z.enum(["US", "UK", "IN", "AU"]).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.assignmentRoster(user, data.process ? { process: data.process } : {});
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
        /** §2/§3 — server resolves the ids for every scope except SELECTED */
        scope: transferScope.optional(),
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
        ...(data.scope !== undefined ? { scope: data.scope } : {}),
        ...(data.reason !== undefined ? { reason: data.reason } : {}),
      },
      requestInfo(),
    );
  });

export const longDatedFollowUpsFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ process: z.enum(["US", "UK", "IN", "AU"]).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.longDatedFollowUps(user, data.process ? { process: data.process } : {});
  });

export const assignmentHistoryFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.assignmentHistory(user, data.limit !== undefined ? { limit: data.limit } : {});
  });
