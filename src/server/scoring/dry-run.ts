/**
 * Officeverse — Scoring Engine DRY RUN (Phase 2).
 *
 * Uses the EXACT same evaluator as live scoring (`evaluateScoring`), so a
 * preview and a real award can never diverge. A dry run:
 *   • NEVER writes gamification_point_transactions
 *   • NEVER writes scoring_runs
 *   • NEVER mutates anything
 * and returns matched rules, per-node condition results + failure reasons, the
 * selected band + strategy, the resolved points, and the full context.
 *
 * Phase 3 exposes this through the Admin UI (`scoreDryRunFn`, Admin-only).
 * Phase 2 ships the server-side foundation + tests only.
 */
import { isDbConfigured } from "@/lib/db";
import * as repo from "../db/repos/scoring";
import { normalizeBusinessEvent, type BusinessEvent } from "../events/business-event";
import { isKnownEvent, isScoringEnabledEvent } from "./events";
import {
  evaluateScoring,
  toEvaluableRule,
  type EvaluableRule,
  type ScoringDecision,
} from "./ingest";

export interface DryRunResult {
  ok: boolean;
  reason?: string;
  /** whether the rule set came from the DB or from the `rules` argument */
  ruleSource: "db" | "supplied" | "none";
  eventType?: string;
  decision?: ScoringDecision;
  /** true when at least one enabled open-ended rule exists for the event */
  hasOpenEndedRules?: boolean;
}

/**
 * Evaluate an event without persisting anything.
 * Pass `rules` to evaluate against a hypothetical rule set (no DB needed) — this
 * is how Phase-2 tests prove "debt >= 20000 → 200" without seeding a rule.
 * Omit `rules` to preview against the live enabled rules for the event.
 */
export async function dryRun(
  rawEvent: BusinessEvent,
  rules?: EvaluableRule[],
): Promise<DryRunResult> {
  const norm = normalizeBusinessEvent(rawEvent);
  if (!norm.ok) return { ok: false, reason: norm.reason, ruleSource: "none" };
  const event = norm.event;

  if (!isKnownEvent(event.type)) {
    return { ok: false, reason: "unknown_event_type", ruleSource: "none" };
  }

  if (rules) {
    return {
      ok: true,
      ruleSource: "supplied",
      eventType: event.type,
      decision: evaluateScoring(event, rules),
      hasOpenEndedRules: rules.length > 0,
    };
  }

  if (!isDbConfigured()) {
    return { ok: false, reason: "db_unavailable", ruleSource: "none", eventType: event.type };
  }

  const ruleRows = await repo.listEnabledRulesForEvent(event.type);
  const evaluable: EvaluableRule[] = [];
  for (const row of ruleRows) {
    const er = toEvaluableRule(row, event.operationalDate);
    if (er) evaluable.push(er);
  }

  return {
    ok: true,
    ruleSource: "db",
    eventType: event.type,
    decision: evaluateScoring(event, evaluable),
    hasOpenEndedRules: ruleRows.length > 0,
    ...(isScoringEnabledEvent(event.type) ? {} : { reason: "event_not_enabled_for_scoring" }),
  };
}

export interface DryRunEventOptions {
  /** also preview rules that are currently disabled */
  includeDisabled?: boolean;
  /** preview exactly one rule (any status), by id */
  ruleId?: number;
}

/**
 * Admin console dry-run (Phase 3). Same evaluator, still writes NOTHING. Loads
 * the rule set from the DB per `opts` and picks each rule's version effective on
 * the event's operationalDate. With no options it matches `dryRun(evt)` exactly
 * (enabled rules only).
 */
export async function dryRunEvent(
  rawEvent: BusinessEvent,
  opts: DryRunEventOptions = {},
): Promise<DryRunResult> {
  const norm = normalizeBusinessEvent(rawEvent);
  if (!norm.ok) return { ok: false, reason: norm.reason, ruleSource: "none" };
  const event = norm.event;
  if (!isKnownEvent(event.type)) {
    return { ok: false, reason: "unknown_event_type", ruleSource: "none", eventType: event.type };
  }
  if (!isDbConfigured()) {
    return { ok: false, reason: "db_unavailable", ruleSource: "none", eventType: event.type };
  }

  const rows = await repo.listRulesWithVersions({
    event: event.type,
    enabledOnly: !opts.includeDisabled && !opts.ruleId,
    ...(opts.ruleId ? { ruleId: opts.ruleId } : {}),
  });
  const evaluable: EvaluableRule[] = [];
  for (const row of rows) {
    const er = toEvaluableRule(row, event.operationalDate);
    if (er) evaluable.push(er);
  }

  return {
    ok: true,
    ruleSource: "db",
    eventType: event.type,
    decision: evaluateScoring(event, evaluable),
    hasOpenEndedRules: rows.length > 0,
    ...(isScoringEnabledEvent(event.type) ? {} : { reason: "event_not_enabled_for_scoring" }),
  };
}
