/**
 * Officeverse — Scoring Engine INGEST (Phase 2).
 *
 * `evaluateScoring()` is the PURE core: (BusinessEvent, rules) → decision. No
 * DB, no clock, no CRM. Both live `ingest()` and `dryRun()` call it, so a
 * preview and a real award always agree.
 *
 * `ingest()` is the thin DB-bound shell: flag + registry gate → run-once
 * idempotency → load effective rule versions → evaluate → write ONE scoring_run
 * → append immutable ledger rows via `awardScored()`. It never mutates a CRM
 * row. With `SCORING_ENGINE_ENABLED` unset it returns before touching anything.
 *
 * PERFORMANCE: the payload is hydrated once (by the emit-site adapter in a
 * later phase) into a flat in-memory event; condition evaluation is pure and
 * never queries per-condition. `ingest()` issues at most: 1 idempotency read,
 * 1 rule read, 1 run insert, and N ledger inserts (N = awarded rules).
 */
import { isDbConfigured } from "@/lib/db";
import { epochMsToIstWallClock, nowIST } from "../time";
import { awardScored } from "../gamification/service";
import { scoredDedupeKey } from "../gamification/points";
import * as repo from "../db/repos/scoring";
import { normalizeBusinessEvent, type BusinessEvent } from "../events/business-event";
import { isScoringEnabledEvent } from "./events";
import { isScoringEngineEnabled } from "./flags";
import {
  evaluateCondition,
  type ConditionNode,
  type NodeTrace,
  type ScoringPayload,
} from "./conditions";
import {
  resolveOutcome,
  resolveRuleMatching,
  type AppliesToShape,
  type Outcome,
  type OutcomeDetail,
  type RuleMatchingMode,
} from "./modes";
import { selectVersionForDate } from "./versions";

type Meta = { ip?: string | null; userAgent?: string | null };

/* ------------------------------- applies-to -------------------------------- */

export type AppliesTo = AppliesToShape;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^[+-]?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

/** All present constraints must pass (AND). Missing payload field for a stated constraint fails. */
export function matchesAppliesTo(
  appliesTo: AppliesTo | null | undefined,
  payload: ScoringPayload,
): { ok: boolean; reason?: string } {
  if (!appliesTo) return { ok: true };
  const a = appliesTo;

  if (a.roles?.length) {
    if (typeof payload["role"] !== "string" || !a.roles.includes(payload["role"])) {
      return { ok: false, reason: "role" };
    }
  }
  if (a.processes?.length) {
    if (typeof payload["process"] !== "string" || !a.processes.includes(payload["process"])) {
      return { ok: false, reason: "process" };
    }
  }
  if (a.teams?.length) {
    if (typeof payload["team"] !== "string" || !a.teams.includes(payload["team"])) {
      return { ok: false, reason: "team" };
    }
  }
  if (a.closerIds?.length) {
    const id = num(payload["closer_id"]);
    if (id === null || !a.closerIds.includes(id)) return { ok: false, reason: "closer_id" };
  }
  if (a.agentIds?.length) {
    const id = num(payload["agent_id"]);
    if (id === null || !a.agentIds.includes(id)) return { ok: false, reason: "agent_id" };
  }
  if (a.closerTenureDaysMin != null || a.closerTenureDaysMax != null) {
    const t = num(payload["closer_tenure_days"]);
    if (t === null) return { ok: false, reason: "closer_tenure_days" };
    if (a.closerTenureDaysMin != null && t < a.closerTenureDaysMin) {
      return { ok: false, reason: "closer_tenure_min" };
    }
    if (a.closerTenureDaysMax != null && t > a.closerTenureDaysMax) {
      return { ok: false, reason: "closer_tenure_max" };
    }
  }
  return { ok: true };
}

/* ------------------------------ pure evaluator ---------------------------- */

export interface EvaluableRule {
  ruleId: number;
  ruleName: string;
  event: string;
  priority: number;
  ruleMatchingMode: RuleMatchingMode;
  appliesTo: AppliesTo | null;
  version: number;
  conditionTree: ConditionNode | null;
  outcome: Outcome;
}

export interface ScoringContext {
  event: string;
  operationalDate: string;
  source: { type: string; id: string };
  rule: { id: number; name: string; version: number; matchingMode: RuleMatchingMode };
  outcome: OutcomeDetail;
  conditions: NodeTrace[];
  payloadUsed: ScoringPayload;
  points: number;
}

export interface ScoringAward {
  ruleId: number;
  ruleName: string;
  version: number;
  points: number;
  dedupeKey: string;
  context: ScoringContext;
}

export interface ScoringDecision {
  eventType: string;
  matched: {
    ruleId: number;
    ruleName: string;
    version: number;
    points: number;
    conditionTraces: NodeTrace[];
    outcomeDetail: OutcomeDetail;
  }[];
  skipped: {
    ruleId: number;
    ruleName: string;
    version: number;
    reason: string;
    conditionTraces?: NodeTrace[];
  }[];
  awards: ScoringAward[];
  awardedPointsTotal: number;
}

function payloadUsed(
  payload: ScoringPayload,
  traces: NodeTrace[],
  bandOn?: string,
): ScoringPayload {
  const keys = new Set<string>();
  for (const t of traces) if (t.field) keys.add(t.field);
  if (bandOn) keys.add(bandOn);
  const out: ScoringPayload = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, k)) out[k] = payload[k]!;
  }
  return out;
}

type MatchedInternal = ScoringDecision["matched"][number] & {
  priority: number;
  mode: RuleMatchingMode;
  bandOn?: string;
};

/** PURE. Same (event, rules) → same decision. */
export function evaluateScoring(event: BusinessEvent, rules: EvaluableRule[]): ScoringDecision {
  const forEvent = rules.filter((r) => r.event === event.type);
  const matchedList: MatchedInternal[] = [];
  const skipped: ScoringDecision["skipped"] = [];

  for (const r of forEvent) {
    const gate = matchesAppliesTo(r.appliesTo, event.payload);
    if (!gate.ok) {
      skipped.push({
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        version: r.version,
        reason: `applies_to:${gate.reason ?? "no"}`,
      });
      continue;
    }
    const cond = evaluateCondition(r.conditionTree, event.payload, { eventType: event.type });
    if (!cond.result) {
      skipped.push({
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        version: r.version,
        reason: "condition_false",
        conditionTraces: cond.traces,
      });
      continue;
    }
    const detail = resolveOutcome(r.outcome, event.payload);
    matchedList.push({
      ruleId: r.ruleId,
      ruleName: r.ruleName,
      version: r.version,
      points: detail.points,
      conditionTraces: cond.traces,
      outcomeDetail: detail,
      priority: r.priority,
      mode: r.ruleMatchingMode,
      ...(r.outcome.kind === "BANDS" ? { bandOn: r.outcome.on } : {}),
    });
  }

  const selected = resolveRuleMatching(
    matchedList.map((m) => ({
      ruleId: m.ruleId,
      priority: m.priority,
      mode: m.mode,
      points: m.points,
    })),
  );

  const awards: ScoringAward[] = selected.map((s) => {
    const m = matchedList.find((x) => x.ruleId === s.ruleId)!;
    return {
      ruleId: s.ruleId,
      ruleName: m.ruleName,
      version: m.version,
      points: s.points,
      dedupeKey: scoredDedupeKey(
        event.type,
        event.source.type,
        event.source.id,
        s.ruleId,
        m.version,
      ),
      context: {
        event: event.type,
        operationalDate: event.operationalDate,
        source: { type: event.source.type, id: event.source.id },
        rule: { id: s.ruleId, name: m.ruleName, version: m.version, matchingMode: m.mode },
        outcome: m.outcomeDetail,
        conditions: m.conditionTraces,
        payloadUsed: payloadUsed(event.payload, m.conditionTraces, m.bandOn),
        points: s.points,
      },
    };
  });

  return {
    eventType: event.type,
    matched: matchedList.map((m) => ({
      ruleId: m.ruleId,
      ruleName: m.ruleName,
      version: m.version,
      points: m.points,
      conditionTraces: m.conditionTraces,
      outcomeDetail: m.outcomeDetail,
    })),
    skipped,
    awards,
    awardedPointsTotal: awards.reduce((acc, a) => acc + Math.trunc(a.points), 0),
  };
}

/* ----------------------------- DB-bound ingest --------------------------- */

export type IngestStatus = "scored" | "duplicate" | "skipped" | "dropped" | "legacy_fallback";

export interface IngestOutcome {
  status: IngestStatus;
  reason?: string;
  runId?: number;
  decision?: ScoringDecision;
  awardedTransactionIds?: number[];
}

export function toEvaluableRule(
  row: repo.RuleWithVersions,
  operationalDate: string,
): EvaluableRule | null {
  const v = selectVersionForDate(
    row.versions.map((x) => ({
      version: x.version,
      effectiveFrom: x.effectiveFrom,
      effectiveUntil: x.effectiveUntil,
      raw: x,
    })),
    operationalDate,
  );
  if (!v) return null;
  return {
    ruleId: row.id,
    ruleName: v.raw.nameSnapshot,
    event: v.raw.eventSnapshot,
    priority: row.priority,
    ruleMatchingMode: row.ruleMatchingMode as RuleMatchingMode,
    appliesTo: (v.raw.appliesToSnapshot as AppliesTo | null) ?? null,
    version: v.version,
    conditionTree: (v.raw.conditionTree as ConditionNode | null) ?? null,
    outcome: v.raw.outcome as Outcome,
  };
}

export async function ingest(rawEvent: BusinessEvent, meta: Meta = {}): Promise<IngestOutcome> {
  const norm = normalizeBusinessEvent(rawEvent);
  if (!norm.ok) return { status: "dropped", reason: norm.reason };
  const event = norm.event;

  if (!isScoringEnabledEvent(event.type)) {
    return { status: "skipped", reason: "event_not_enabled_for_scoring" };
  }
  if (!isScoringEngineEnabled()) return { status: "skipped", reason: "flag_off" };
  if (!isDbConfigured()) return { status: "skipped", reason: "db_unavailable" };

  const existing = await repo.findRun(event.type, event.source.type, event.source.id);
  if (existing) return { status: "duplicate", runId: existing.id };

  const ruleRows = await repo.listEnabledRulesForEvent(event.type);
  if (ruleRows.length === 0) return { status: "legacy_fallback", reason: "no_open_ended_rules" };

  const rules: EvaluableRule[] = [];
  for (const row of ruleRows) {
    const er = toEvaluableRule(row, event.operationalDate);
    if (er) rules.push(er);
  }
  if (rules.length === 0) return { status: "legacy_fallback", reason: "no_effective_versions" };

  const decision = evaluateScoring(event, rules);

  const run = await repo.insertRun({
    eventType: event.type,
    sourceType: event.source.type,
    sourceId: event.source.id,
    subjectUserId: event.subjectUserId,
    operationalDate: event.operationalDate,
    occurredAt: epochMsToIstWallClock(event.occurredAtMs),
    payloadSnapshot: event.payload,
    matchedRuleIds: decision.awards.map((a) => a.ruleId),
    awardedPointsTotal: decision.awardedPointsTotal,
    createdAt: nowIST(),
  });
  if (!run.created) return { status: "duplicate", runId: run.id };

  const txnIds: number[] = [];
  for (const a of decision.awards) {
    const res = await awardScored(
      {
        subjectUserId: event.subjectUserId,
        event: event.type,
        source: { type: event.source.type, id: event.source.id },
        ruleId: a.ruleId,
        ruleVersion: a.version,
        ruleName: a.ruleName,
        points: a.points,
        context: a.context,
        scoreRunId: run.id,
        operationalDate: event.operationalDate,
        dedupeKey: a.dedupeKey,
      },
      meta,
    ).catch(() => null);
    if (res && res.transactionId) txnIds.push(res.transactionId);
  }

  return { status: "scored", runId: run.id, decision, awardedTransactionIds: txnIds };
}
