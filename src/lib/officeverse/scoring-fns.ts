/**
 * Officeverse — client-callable Scoring Engine server functions (Phase 3).
 *
 * Outside `src/server/**`. Every handler resolves the acting user from the
 * session and requires an Operations role at the boundary —
 * `requireRole("admin", "closer")` (Phase 6.5: the Closer is the Operations
 * Manager) — then delegates to the Phase-2 server foundation in
 * `@/server/scoring/*`, which re-checks via `assertCanManageScoringRules`.
 *
 * The client submits rule DEFINITIONS only — never a computed award, rank,
 * score, or "sale happened" flag. There is no endpoint that writes a point.
 * `scoreDryRunFn` evaluates with the SAME engine as live scoring and writes
 * nothing (no scoring_run, no ledger row, no CRM mutation).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRole, requestInfo } from "@/server/context";
import * as svc from "@/server/scoring/service";
import { dryRunEvent } from "@/server/scoring/dry-run";
import { buildBusinessEvent } from "@/server/events/business-event";
import { EVENT_DEFS } from "@/server/scoring/events";
import { FIELD_DEFS } from "@/server/scoring/fields";
import { OPERATOR_DEFS } from "@/server/scoring/operators";
import { BAND_STRATEGIES, RULE_MATCHING_MODES } from "@/server/scoring/modes";
import type { ProcessCode } from "./types";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const PROCESSES = ["US", "UK", "IN", "AU"] as const;

/* ----------------------------- schemas ---------------------------------- */

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

type LeafNode = { field: string; operator: string; value?: unknown; valueType?: string };
type GroupNode = { op: "AND" | "OR"; nodes: ConditionNode[] };
type ConditionNode = LeafNode | GroupNode;

const conditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    z.object({
      field: z.string().min(1).max(64),
      operator: z.string().min(1).max(24),
      value: z.unknown().optional(),
      valueType: z.enum(["number", "money", "string", "stringList", "boolean", "date"]).optional(),
    }),
    z.object({
      op: z.enum(["AND", "OR"]),
      nodes: z.array(conditionNodeSchema).max(200),
    }),
  ]),
) as z.ZodType<ConditionNode>;

const bandSchema = z.object({ min: z.number(), points: z.number() });

const outcomeSchema = z.union([
  z.object({ kind: z.literal("FLAT"), points: z.number() }),
  z.object({
    kind: z.literal("BANDS"),
    on: z.string().min(1).max(64),
    strategy: z.enum(BAND_STRATEGIES as unknown as [string, ...string[]]).optional(),
    bands: z.array(bandSchema).min(1).max(50),
  }),
  z.object({
    kind: z.literal("BASE_PLUS_BONUS"),
    base: z.number(),
    bonus: z.array(z.object({ if: conditionNodeSchema, points: z.number() })).max(50),
  }),
]);

const appliesToSchema = z
  .object({
    roles: z.array(z.string().max(20)).max(10).optional(),
    processes: z.array(z.string().max(8)).max(8).optional(),
    teams: z.array(z.string().max(60)).max(50).optional(),
    closerIds: z.array(z.number().int().positive()).max(500).optional(),
    agentIds: z.array(z.number().int().positive()).max(500).optional(),
    closerTenureDaysMin: z.number().int().min(0).max(100_000).nullable().optional(),
    closerTenureDaysMax: z.number().int().min(0).max(100_000).nullable().optional(),
  })
  .strict();

const ruleDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  event: z.string().min(1).max(64),
  appliesTo: appliesToSchema.nullish(),
  ruleMatchingMode: z.enum(RULE_MATCHING_MODES as unknown as [string, ...string[]]).optional(),
  priority: z.coerce.number().int().min(0).max(100_000).optional(),
  conditionTree: conditionNodeSchema.nullish(),
  outcome: outcomeSchema,
  effectiveFrom: z.string().regex(YMD),
});

const idSchema = z.object({ ruleId: z.coerce.number().int().positive() });

const dryRunSchema = z.object({
  event: z.string().min(1).max(64),
  payload: z.record(scalar).default({}),
  operationalDate: z.string().regex(YMD).optional(),
  includeDisabled: z.boolean().optional(),
  ruleId: z.coerce.number().int().positive().optional(),
});

/** Input shapes for the hooks (avoids fragile `Parameters<>` inference). */
export type CreateScoringRuleInput = z.input<typeof ruleDraftSchema>;
export type UpdateScoringRuleInput = CreateScoringRuleInput & { ruleId: number };
export type ScoreDryRunInput = z.input<typeof dryRunSchema>;

function toDraft(d: z.infer<typeof ruleDraftSchema>): svc.RuleDraft {
  const draft: svc.RuleDraft = {
    name: d.name,
    event: d.event,
    outcome: d.outcome as svc.RuleDraft["outcome"],
    effectiveFrom: d.effectiveFrom,
  };
  if (d.appliesTo != null) {
    draft.appliesTo = d.appliesTo as NonNullable<svc.RuleDraft["appliesTo"]>;
  }
  if (d.ruleMatchingMode) {
    draft.ruleMatchingMode = d.ruleMatchingMode as NonNullable<svc.RuleDraft["ruleMatchingMode"]>;
  }
  if (d.priority !== undefined) draft.priority = d.priority;
  if (d.conditionTree !== undefined) {
    draft.conditionTree = d.conditionTree as svc.RuleDraft["conditionTree"] & object;
  }
  return draft;
}

/* ----------------------------- DTOs ----------------------------------- */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export interface ScoringRuleVersionDTO {
  id: number;
  version: number;
  nameSnapshot: string;
  eventSnapshot: string;
  appliesToSnapshot: JsonValue;
  conditionTree: JsonValue;
  outcome: JsonValue;
  effectiveFrom: string;
  effectiveUntil: string | null;
  createdByUserId: number | null;
  createdAt: string;
}

export interface ScoringRuleDTO {
  id: number;
  name: string;
  event: string;
  appliesTo: JsonValue;
  ruleMatchingMode: string;
  priority: number;
  enabled: boolean;
  currentVersion: number;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  versions: ScoringRuleVersionDTO[];
}

const asJson = (v: unknown): JsonValue => (v ?? null) as JsonValue;

function toRuleDTO(r: svc.RuleDetail): ScoringRuleDTO {
  return {
    id: r.id,
    name: r.name,
    event: r.event,
    appliesTo: asJson(r.appliesTo),
    ruleMatchingMode: r.ruleMatchingMode,
    priority: r.priority,
    enabled: r.enabled,
    currentVersion: r.currentVersion,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    versions: r.versions.map((v) => ({
      id: v.id,
      version: v.version,
      nameSnapshot: v.nameSnapshot,
      eventSnapshot: v.eventSnapshot,
      appliesToSnapshot: asJson(v.appliesToSnapshot),
      conditionTree: asJson(v.conditionTree),
      outcome: asJson(v.outcome),
      effectiveFrom: v.effectiveFrom,
      effectiveUntil: v.effectiveUntil,
      createdByUserId: v.createdByUserId,
      createdAt: v.createdAt,
    })),
  };
}

/* ----------------------------- functions ------------------------------- */

/** Registry metadata for the builder UI — so nothing is hard-coded client-side. */
export const scoringMetaFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    await requireRole("admin", "closer");
    return {
      events: EVENT_DEFS,
      fields: FIELD_DEFS,
      operators: OPERATOR_DEFS,
      ruleMatchingModes: RULE_MATCHING_MODES,
      bandStrategies: BAND_STRATEGIES,
      processes: PROCESSES,
    };
  });

export const listScoringRulesFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ event: z.string().max(64).optional() }).parse(d ?? {}))
  .handler(async ({ data }): Promise<{ dbUnavailable?: boolean; rules: ScoringRuleDTO[] }> => {
    const user = await requireRole("admin", "closer");
    const res = await svc.listScoringRules(user, data.event ? { event: data.event } : {});
    return {
      ...(res.dbUnavailable ? { dbUnavailable: true } : {}),
      rules: res.rules.map(toRuleDTO),
    };
  });

export const getScoringRuleFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }): Promise<ScoringRuleDTO> => {
    const user = await requireRole("admin", "closer");
    return toRuleDTO(await svc.getScoringRule(user, data.ruleId));
  });

export const createScoringRuleFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ruleDraftSchema.parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return svc.createScoringRule(user, toDraft(data), requestInfo());
  });

export const updateScoringRuleFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    ruleDraftSchema.extend({ ruleId: idSchema.shape.ruleId }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    const { ruleId, ...draft } = data;
    return svc.updateScoringRule(user, ruleId, toDraft(draft), requestInfo());
  });

export const setScoringRuleEnabledFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idSchema.extend({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return svc.setScoringRuleEnabled(user, data.ruleId, data.enabled, requestInfo());
  });

export const scoreDryRunFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => dryRunSchema.parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    const proc =
      typeof data.payload["process"] === "string" &&
      (PROCESSES as readonly string[]).includes(data.payload["process"])
        ? (data.payload["process"] as ProcessCode)
        : "US";
    const built = buildBusinessEvent({
      type: data.event,
      subjectUserId: user.id,
      actorUserId: user.id,
      source: { type: "dryrun", id: `admin-${user.id}-${Date.now()}` },
      payload: data.payload,
      process: proc,
    });
    const evt = data.operationalDate ? { ...built, operationalDate: data.operationalDate } : built;
    return dryRunEvent(evt, {
      ...(data.includeDisabled ? { includeDisabled: true } : {}),
      ...(data.ruleId ? { ruleId: data.ruleId } : {}),
    });
  });
