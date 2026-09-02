/**
 * Officeverse — MILESTONE ENGINE evaluation core (Phase 10 Stage 4). PURE.
 *
 * Given a milestone definition + the AUTHORITATIVE value for its period (read by
 * the service from the scoring ledger / performance aggregation) it decides:
 *   - which operational-date window the period maps to (Phase-8 semantics)
 *   - the deterministic dedupe key for THIS fire (retry-safe idempotency)
 *   - whether the threshold is crossed under the configured trigger policy
 *   - the recognition payload the existing celebration / TV pipeline consumes
 *
 * No DB, no I/O, no clock. `operationalDate` is always the server shift date
 * passed in — never a browser date.
 */
import { windowBounds, type WindowBounds } from "../gamification/leaderboard";
import type { MilestonePeriod, MilestoneTriggerPolicy, MilestoneType } from "./milestone-model";

/** Phase-8 leaderboard window kind for a milestone period. */
export function periodToWindowKind(
  period: MilestonePeriod,
): "daily" | "weekly" | "monthly" | "alltime" {
  return period === "DAILY"
    ? "daily"
    : period === "WEEKLY"
      ? "weekly"
      : period === "MONTHLY"
        ? "monthly"
        : "alltime";
}

/** The inclusive operational-date window the threshold is measured over. */
export function windowFor(period: MilestonePeriod, operationalDate: string): WindowBounds {
  if (period === "ALL_TIME") return { from: null, to: null };
  return windowBounds(periodToWindowKind(period), operationalDate);
}

/**
 * A short, stable key for the period a fire belongs to:
 *   ALL_TIME → "all"
 *   DAILY    → "YYYY-MM-DD"
 *   WEEKLY   → the ISO-week Monday "YYYY-MM-DD"
 *   MONTHLY  → "YYYY-MM"
 */
export function periodKeyFor(period: MilestonePeriod, operationalDate: string): string {
  if (period === "ALL_TIME") return "all";
  const w = windowFor(period, operationalDate);
  if (period === "MONTHLY") return (w.from ?? operationalDate).slice(0, 7);
  return w.from ?? operationalDate;
}

export interface DedupeInput {
  milestoneId: number;
  policy: MilestoneTriggerPolicy;
  isTeam: boolean;
  userId: number | null;
  periodKey: string;
  /** current authoritative value — only used for EVERY_THRESHOLD_CROSSING */
  actualValue: number;
  threshold: number;
}

/**
 * Deterministic dedupe key for one fire. Retrying the same source event yields
 * the SAME key → the unique index on `milestone_triggers.dedupe_key` blocks a
 * second recognition / celebration / announcement.
 *
 *   ONCE                     → milestone:<id>:(team|user:<u>)
 *   PER_PERIOD               → …:period:<periodKey>
 *   EVERY_THRESHOLD_CROSSING → …:mult:<floor(value/threshold)>   (>= 1)
 */
export function dedupeKeyFor(i: DedupeInput): string {
  const who = i.isTeam ? "team" : `user:${i.userId ?? 0}`;
  const head = `milestone:${i.milestoneId}:${who}`;
  if (i.policy === "PER_PERIOD") return `${head}:period:${i.periodKey}`;
  if (i.policy === "EVERY_THRESHOLD_CROSSING") {
    const mult = i.threshold > 0 ? Math.floor(i.actualValue / i.threshold) : 0;
    return `${head}:mult:${Math.max(1, mult)}`;
  }
  return head; // ONCE
}

export interface CrossDecision {
  fired: boolean;
  /** the dedupe key to persist / check (present even when not fired) */
  dedupeKey: string;
  /** floor(value/threshold) — the multiple reached, for EVERY_THRESHOLD_CROSSING */
  multiple: number;
}

/**
 * Decide whether this evaluation crosses the threshold. `alreadyFiredKeys` is
 * the set of dedupe keys already in `milestone_triggers` for this milestone —
 * the service supplies it so a repeat / retry is a no-op.
 */
export function crossed(i: DedupeInput, alreadyFiredKeys: ReadonlySet<string>): CrossDecision {
  const dedupeKey = dedupeKeyFor(i);
  const multiple = i.threshold > 0 ? Math.floor(i.actualValue / i.threshold) : 0;
  const atOrAbove = i.threshold > 0 && i.actualValue >= i.threshold;
  const fired = atOrAbove && !alreadyFiredKeys.has(dedupeKey);
  return { fired, dedupeKey, multiple };
}

/* ------------------------- recognition payload --------------------- */

export interface MilestoneRecognitionInput {
  milestoneId: number;
  type: MilestoneType;
  name: string;
  description: string | null;
  isTeam: boolean;
  /** null for a team milestone — NEVER fabricate a person */
  subjectUserId: number | null;
  subjectName: string | null;
  recognitionLevel: string;
  threshold: number;
  actualValue: number;
  /** process/team label for a team milestone headline */
  scopeLabel: string | null;
  /** authoritative points ONLY when the milestone measures points */
  points: number | null;
}

export interface MilestoneRecognition {
  /** approved recognition kind for the orchestrator */
  kind: "TEAM_MILESTONE" | "ACHIEVEMENT_UNLOCKED";
  subjectUserId: number | null;
  headline: string;
  subheadline: string | null;
  level: string;
  points: number | null;
}

/** Build the recognition moment. Team milestones carry NO subject. */
export function buildMilestoneRecognition(i: MilestoneRecognitionInput): MilestoneRecognition {
  const headline = i.isTeam
    ? i.scopeLabel
      ? `TEAM ${i.scopeLabel} — ${i.name.toUpperCase()}`
      : `TEAM — ${i.name.toUpperCase()}`
    : i.name.toUpperCase();
  const subheadline = i.description
    ? i.description
    : i.isTeam
      ? `${i.actualValue} reached`
      : `${i.subjectName ?? "A team member"} — ${i.actualValue}`;
  return {
    kind: i.isTeam ? "TEAM_MILESTONE" : "ACHIEVEMENT_UNLOCKED",
    subjectUserId: i.isTeam ? null : i.subjectUserId,
    headline,
    subheadline,
    level: i.recognitionLevel,
    points: i.points != null && i.points > 0 ? Math.trunc(i.points) : null,
  };
}
