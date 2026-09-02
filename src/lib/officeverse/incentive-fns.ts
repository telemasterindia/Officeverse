/**
 * Officeverse — INCENTIVE ENGINE · client-callable server functions (Phase 9).
 *
 * Outside `src/server/**`. Every handler resolves the acting user from the
 * session (`requireUser()`); the SERVICE enforces authorization:
 *   scheme CRUD / dry-run / calculate / review → Admin + Closer (Operations)
 *   approve / finalize / reverse               → Admin only
 *   agent                                      → own results only
 *
 * The browser NEVER supplies the actor id / role, a points value, or a computed
 * incentive amount. Points come from the Phase-8 snapshot; the reward comes
 * from the scheme version config.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/incentive/service";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const PROC = z.enum(["US", "UK", "IN", "AU"]);
const period = z.object({
  period: z.enum(["daily", "weekly", "monthly", "custom", "today", "week", "month"]).optional(),
  from: z.string().regex(YMD).optional(),
  to: z.string().regex(YMD).optional(),
  process: PROC.optional(),
});

const schemeDraft = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).nullish(),
  periodType: z.enum(["daily", "weekly", "monthly", "custom"]),
  priority: z.coerce.number().int().min(0).max(100_000).optional(),
  combineMode: z.enum(["independent", "exclusive", "highest"]).optional(),
  scope: z.record(z.unknown()).nullish(),
  eligibility: z.unknown().nullish(),
  reward: z.unknown(),
  effectiveFrom: z.string().regex(YMD),
  currency: z.string().trim().max(8).optional(),
});

const idInput = z.object({ id: z.coerce.number().int().positive() });
const lifecycleInput = idInput.extend({ reason: z.string().trim().max(255).optional() });

function pick<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

/* ------------------------------ schemes --------------------------- */

export const incentiveSchemesFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireUser();
    return svc.listIncentiveSchemes(user);
  });

export const createIncentiveSchemeFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => schemeDraft.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.createIncentiveScheme(user, data as svc.SchemeDraft, requestInfo());
  });

export const updateIncentiveSchemeFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => schemeDraft.extend({ schemeId: idInput.shape.id }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { schemeId, ...draft } = data;
    return svc.updateIncentiveScheme(user, schemeId, draft as svc.SchemeDraft, requestInfo());
  });

export const setIncentiveSchemeEnabledFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.extend({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.setIncentiveSchemeEnabled(user, data.id, data.enabled, requestInfo());
  });

/* --------------------------- dry-run / calc --------------------------- */

export const incentiveDryRunFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    period
      .extend({
        schemeId: idInput.shape.id,
        userId: z.coerce.number().int().positive(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.dryRunIncentive(user, pick(data) as svc.DryRunInput, requestInfo());
  });

export const calculateIncentivesFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    period
      .extend({
        schemeId: z.coerce.number().int().positive().optional(),
        userIds: z.array(z.coerce.number().int().positive()).max(1000).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.calculateIncentives(user, pick(data) as svc.CalculateInput, requestInfo());
  });

/* ---------------------------- lifecycle ------------------------------ */

export const reviewIncentiveResultFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => lifecycleInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.reviewIncentiveResult(user, data.id, data.reason, requestInfo());
  });

export const approveIncentiveResultFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => lifecycleInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.approveIncentiveResult(user, data.id, data.reason, requestInfo());
  });

export const finalizeIncentiveResultFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => lifecycleInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.finalizeIncentiveResult(user, data.id, data.reason, requestInfo());
  });

export const reverseIncentiveResultFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => lifecycleInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.reverseIncentiveResult(user, data.id, data.reason, requestInfo());
  });

/* --------------------------- read views ---------------------------- */

export const incentiveResultsFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({
        schemeId: z.coerce.number().int().positive().optional(),
        userId: z.coerce.number().int().positive().optional(),
        status: z.array(z.string().max(24)).max(10).optional(),
        from: z.string().regex(YMD).optional(),
        to: z.string().regex(YMD).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.listIncentiveResults(user, pick(data));
  });

export const myIncentiveFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => period.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.myIncentive(user, pick(data));
  });
