/**
 * Officeverse — Lead server functions (Phase 3 / Phase 17).
 *
 * TanStack Start `createServerFn` (this repo's API style — no file-based server
 * routes in this version). Every function:
 *   - authenticates (requireUser / requireRole) — the security boundary
 *   - validates input with Zod
 *   - delegates to the Lead service (authorization + repo + audit)
 *   - returns client-safe DTOs only
 */
import { createServerFn } from "@tanstack/react-start";
import { requireRole, requireUser, requestInfo } from "../context";
import * as svc from "../leads/service";
import {
  createLeadSchema,
  getLeadSchema,
  listLeadsSchema,
  transferLeadSchema,
  updateLeadArgsSchema,
} from "../validation/leads";
import type { LeadDTO } from "../leads/dto";
import type { ListLeadsResult } from "../leads/service";

export const listLeadsFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listLeadsSchema.parse(d ?? {}))
  .handler(async ({ data }): Promise<ListLeadsResult> => {
    const user = await requireUser();
    return svc.listLeads(user, data);
  });

export const getLeadFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => getLeadSchema.parse(d))
  .handler(async ({ data }): Promise<{ lead: LeadDTO }> => {
    const user = await requireUser();
    return { lead: await svc.getLead(user, data.code) };
  });

export const createLeadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createLeadSchema.parse(d))
  .handler(async ({ data }): Promise<{ lead: LeadDTO }> => {
    const user = await requireRole("admin", "agent");
    return { lead: await svc.createLead(user, data, requestInfo()) };
  });

export const updateLeadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateLeadArgsSchema.parse(d))
  .handler(async ({ data }): Promise<{ lead: LeadDTO }> => {
    const user = await requireUser();
    return { lead: await svc.updateLead(user, data.code, data.patch, requestInfo()) };
  });

export const transferLeadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => transferLeadSchema.parse(d))
  .handler(async ({ data }): Promise<{ lead: LeadDTO }> => {
    const user = await requireUser();
    return {
      lead: await svc.transferLead(
        user,
        data.code,
        data.to_closer_code,
        data.note ?? null,
        requestInfo(),
      ),
    };
  });
