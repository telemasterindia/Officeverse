/**
 * Officeverse — Scoring Engine RULE MODES + OUTCOME model (Phase 2). PURE.
 *
 * TWO SEPARATE CONCEPTS — never collapsed into one setting:
 *
 *   A. RULE MATCHING MODE  (scoring_rules.rule_matching_mode)
 *      how the engine treats SEVERAL rules that all match one event.
 *        FIRST_MATCH   (default) — award the first matching rule, stop
 *        HIGHEST_MATCH           — award the single matching rule worth the most
 *        ALL_MATCHES             — award every matching rule once
 *
 *   B. BAND STRATEGY  (within ONE rule's BANDS outcome)
 *      how a threshold rule turns a value into points.
 *        HIGHEST   (default) — only the highest satisfied band
 *        FIRST              — the first (lowest) satisfied band
 *        ALL                — sum every satisfied band
 *        CUMULATIVE         — add each band's points as its threshold is crossed
 *
 * Points are Admin-authored data; negatives are ordinary points, not a separate
 * penalty subsystem. Nothing here reads money or the CRM.
 */
import { evaluateCondition, type ConditionNode, type ScoringPayload } from "./conditions";
import { toMicros } from "./operators";

/* ------------------------------ audience narrowing --------------------------- */

/**
 * Optional `scoring_rules.applies_to` shape. Every field is data — no closer
 * names, ids, team names, role names or "beginner/senior" labels are hard-coded
 * anywhere in the engine. "Beginner" / "Senior" = an Admin-chosen tenure
 * bracket or explicit id list.
 */
export interface AppliesToShape {
  roles?: string[];
  processes?: string[];
  teams?: string[];
  closerIds?: number[];
  agentIds?: number[];
  closerTenureDaysMin?: number | null;
  closerTenureDaysMax?: number | null;
}

/* ------------------------------ A. rule matching ------------------------------ */

export const RULE_MATCHING_MODES = ["FIRST_MATCH", "HIGHEST_MATCH", "ALL_MATCHES"] as const;
export type RuleMatchingMode = (typeof RULE_MATCHING_MODES)[number];
export const DEFAULT_RULE_MATCHING_MODE: RuleMatchingMode = "FIRST_MATCH";

export function isRuleMatchingMode(x: unknown): x is RuleMatchingMode {
  return typeof x === "string" && (RULE_MATCHING_MODES as readonly string[]).includes(x);
}

export interface MatchedRule {
  ruleId: number;
  priority: number;
  mode: RuleMatchingMode;
  points: number;
}

/**
 * Given the rules that matched an event (condition already true), each with its
 * computed points, decide which are actually awarded. Candidates are considered
 * in (priority asc, ruleId asc) order; each candidate's OWN mode governs:
 *   FIRST_MATCH / HIGHEST_MATCH short-circuit, ALL_MATCHES continues.
 */
export function resolveRuleMatching(matched: MatchedRule[]): { ruleId: number; points: number }[] {
  const ordered = [...matched].sort((a, b) => a.priority - b.priority || a.ruleId - b.ruleId);
  const awarded: { ruleId: number; points: number }[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const cand = ordered[i]!;
    if (cand.mode === "FIRST_MATCH") {
      awarded.push({ ruleId: cand.ruleId, points: cand.points });
      break;
    }
    if (cand.mode === "HIGHEST_MATCH") {
      const rest = ordered.slice(i);
      let best = cand;
      for (const r of rest) if (r.points > best.points) best = r;
      awarded.push({ ruleId: best.ruleId, points: best.points });
      break;
    }
    // ALL_MATCHES — award this one, keep going
    awarded.push({ ruleId: cand.ruleId, points: cand.points });
  }
  return awarded;
}

/* ------------------------------ B. outcome model ----------------------------- */

export const BAND_STRATEGIES = ["HIGHEST", "FIRST", "ALL", "CUMULATIVE"] as const;
export type BandStrategy = (typeof BAND_STRATEGIES)[number];
export const DEFAULT_BAND_STRATEGY: BandStrategy = "HIGHEST";

export function isBandStrategy(x: unknown): x is BandStrategy {
  return typeof x === "string" && (BAND_STRATEGIES as readonly string[]).includes(x);
}

export interface Band {
  min: number;
  points: number;
}
export type Outcome =
  | { kind: "FLAT"; points: number }
  | { kind: "BANDS"; on: string; strategy?: BandStrategy; bands: Band[] }
  | { kind: "BASE_PLUS_BONUS"; base: number; bonus: { if: ConditionNode; points: number }[] };

export const POINTS_MIN = -100_000;
export const POINTS_MAX = 100_000;

function pointsOk(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= POINTS_MIN && n <= POINTS_MAX;
}

/** Static validation for a rule's outcome. Returns [] when valid. */
export function validateOutcome(outcome: unknown): string[] {
  const errs: string[] = [];
  if (typeof outcome !== "object" || outcome === null) return ["outcome_not_object"];
  const o = outcome as Record<string, unknown>;

  switch (o["kind"]) {
    case "FLAT": {
      if (!pointsOk(o["points"])) errs.push("flat_points_out_of_range");
      break;
    }
    case "BANDS": {
      if (typeof o["on"] !== "string" || o["on"].trim() === "") errs.push("bands_on_missing");
      if (o["strategy"] !== undefined && !isBandStrategy(o["strategy"])) errs.push("bad_strategy");
      const bands = o["bands"];
      if (!Array.isArray(bands) || bands.length === 0) {
        errs.push("bands_empty");
      } else {
        let prevMin = -Infinity;
        bands.forEach((b, i) => {
          const bb = b as Record<string, unknown>;
          if (typeof bb["min"] !== "number" || !Number.isFinite(bb["min"])) {
            errs.push(`band_${i}_min_not_finite`);
          } else {
            if (bb["min"] <= prevMin) errs.push(`band_${i}_min_not_increasing`);
            prevMin = bb["min"];
          }
          if (!pointsOk(bb["points"])) errs.push(`band_${i}_points_out_of_range`);
        });
      }
      break;
    }
    case "BASE_PLUS_BONUS": {
      if (!pointsOk(o["base"])) errs.push("base_out_of_range");
      const bonus = o["bonus"];
      if (!Array.isArray(bonus)) {
        errs.push("bonus_not_array");
      } else {
        bonus.forEach((b, i) => {
          const bb = b as Record<string, unknown>;
          if (!pointsOk(bb["points"])) errs.push(`bonus_${i}_points_out_of_range`);
          if (typeof bb["if"] !== "object" || bb["if"] === null) errs.push(`bonus_${i}_if_missing`);
        });
      }
      break;
    }
    default:
      errs.push("unknown_outcome_kind");
  }
  return errs;
}

export interface OutcomeDetail {
  kind: string;
  points: number;
  strategy?: BandStrategy;
  matchedBands?: Band[];
  bandInput?: number | null;
  bonusHits?: number[];
  reason?: string;
}

/**
 * Turn an outcome + payload into points. Never throws. An unusable outcome
 * (bad shape, missing band input) yields 0 points with a reason.
 */
export function resolveOutcome(outcome: Outcome, payload: ScoringPayload): OutcomeDetail {
  if (validateOutcome(outcome).length > 0) {
    return {
      kind: String((outcome as { kind?: unknown }).kind ?? "?"),
      points: 0,
      reason: "invalid_outcome",
    };
  }

  if (outcome.kind === "FLAT") {
    return { kind: "FLAT", points: Math.trunc(outcome.points) };
  }

  if (outcome.kind === "BANDS") {
    const strategy = outcome.strategy ?? DEFAULT_BAND_STRATEGY;
    const raw = Object.prototype.hasOwnProperty.call(payload, outcome.on)
      ? payload[outcome.on]
      : undefined;
    const micros = toMicros(raw ?? null);
    if (micros === null) {
      return {
        kind: "BANDS",
        points: 0,
        strategy,
        bandInput: null,
        reason: "band_input_unavailable",
      };
    }
    const value = micros;
    const sorted = [...outcome.bands].sort((a, b) => a.min - b.min);
    const satisfied = sorted.filter((b) => value >= Math.round(b.min * 1_000_000));
    let points = 0;
    if (satisfied.length > 0) {
      switch (strategy) {
        case "FIRST":
          points = Math.trunc(satisfied[0]!.points);
          break;
        case "ALL":
        case "CUMULATIVE":
          points = satisfied.reduce((acc, b) => acc + Math.trunc(b.points), 0);
          break;
        case "HIGHEST":
        default:
          points = Math.trunc(satisfied[satisfied.length - 1]!.points);
          break;
      }
    }
    return {
      kind: "BANDS",
      points,
      strategy,
      matchedBands: satisfied.map((b) => ({ min: b.min, points: b.points })),
      bandInput: value / 1_000_000,
    };
  }

  // BASE_PLUS_BONUS
  const base = Math.trunc(outcome.base);
  const hits: number[] = [];
  let bonusTotal = 0;
  outcome.bonus.forEach((b, i) => {
    if (evaluateCondition(b.if as ConditionNode, payload).result) {
      hits.push(i);
      bonusTotal += Math.trunc(b.points);
    }
  });
  return { kind: "BASE_PLUS_BONUS", points: base + bonusTotal, bonusHits: hits };
}
