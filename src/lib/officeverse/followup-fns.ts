/**
 * Officeverse — client-callable Follow-up server functions (Phase 4 / 17 ·
 * relocated here in Phase 24A so routes can import them).
 *
 * Each fn: authenticate → Zod-validate → delegate to the Follow-up service
 * (authorization + state machine + repo + transaction + audit) → return
 * client-safe DTOs. Owner / role / actor / canonical `FU_` code / status
 * transition are NEVER read from the body — the owner comes from the session
 * and the legal transition from the state machine.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/followups/service";
import {
  cancelSchema,
  completeSchema,
  convertSchema,
  createFollowUpSchema,
  getFollowUpSchema,
  historySchema,
  listFollowUpsSchema,
  rescheduleSchema,
  updateCustomerArgsSchema,
} from "@/server/validation/followups";
import type { FollowUpDTO } from "@/server/followups/dto";
import type { ConvertResult, ListFollowUpsResult } from "@/server/followups/service";

export const listFollowUpsFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listFollowUpsSchema.parse(d ?? {}))
  .handler(async ({ data }): Promise<ListFollowUpsResult> => {
    const user = await requireUser();
    return svc.listFollowUps(user, data);
  });

export const getFollowUpFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => getFollowUpSchema.parse(d))
  .handler(async ({ data }): Promise<{ followUp: FollowUpDTO }> => {
    const user = await requireUser();
    return { followUp: await svc.getFollowUp(user, data.code) };
  });

export const getFollowUpHistoryFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => historySchema.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.getFollowUpHistory(user, data.code);
  });

export const createFollowUpFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createFollowUpSchema.parse(d))
  .handler(async ({ data }): Promise<{ followUp: FollowUpDTO }> => {
    const user = await requireUser();
    return { followUp: await svc.createFollowUp(user, data, requestInfo()) };
  });

export const updateFollowUpCustomerFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateCustomerArgsSchema.parse(d))
  .handler(async ({ data }): Promise<{ followUp: FollowUpDTO }> => {
    const user = await requireUser();
    return {
      followUp: await svc.updateFollowUpCustomer(user, data.code, data.patch, requestInfo()),
    };
  });

export const rescheduleFollowUpFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => rescheduleSchema.parse(d))
  .handler(async ({ data }): Promise<{ followUp: FollowUpDTO }> => {
    const user = await requireUser();
    return { followUp: await svc.rescheduleFollowUp(user, data.code, data, requestInfo()) };
  });

export const completeFollowUpFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => completeSchema.parse(d))
  .handler(async ({ data }): Promise<{ followUp: FollowUpDTO }> => {
    const user = await requireUser();
    return {
      followUp: await svc.completeFollowUp(user, data.code, data.note ?? null, requestInfo()),
    };
  });

export const cancelFollowUpFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => cancelSchema.parse(d))
  .handler(async ({ data }): Promise<{ followUp: FollowUpDTO }> => {
    const user = await requireUser();
    return {
      followUp: await svc.cancelFollowUp(user, data.code, data.reason ?? null, requestInfo()),
    };
  });

export const convertFollowUpToLeadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => convertSchema.parse(d))
  .handler(async ({ data }): Promise<ConvertResult> => {
    const user = await requireUser();
    return svc.convertFollowUpToLead(
      user,
      data.code,
      data.to_closer_code ?? null,
      data.note ?? null,
      requestInfo(),
    );
  });
