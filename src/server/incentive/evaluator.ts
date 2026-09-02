/**
 * Officeverse — INCENTIVE ENGINE · the ONE evaluator (Phase 9). PURE.
 *
 * The SAME function backs dry-run and live calculation. Given a scheme version
 * (config) + one employee's Phase-8 snapshot row, it returns an explainable
 * result. It never scores, never touches the DB, never processes a payment.
 *
 *   OUT_OF_SCOPE  → the employee is not in the scheme's process/role/team/user scope
 *   NOT_ELIGIBLE  → in scope but the eligibility conditions did not pass  → reward 0
 *   ELIGIBLE      → conditions passed → reward per the reward structure
 *
 * `combineResults` decides what happens when several schemes match one employee
 * (independent | exclusive | highest), always with `priority` (lower first) as
 * the deterministic tie-break — never DB row order.
 */
import {
  buildMetricContext,
  evaluateEligibility,
  type ConditionNode,
  type ConditionCheck,
} from "./conditions";
import { evaluateReward, type RewardOutcome } from "./reward";

export type IncentiveEligibility = "ELIGIBLE" | "NOT_ELIGIBLE" | "OUT_OF_SCOPE";

export interface SchemeScope {
  processes?: string[] | null;
  roles?: string[] | null;
  teams?: string[] | null;
  userIds?: number[] | null;
}

export interface SchemeVersionConfig {
  schemeId: number;
  version: number;
  name: string;
  scope: SchemeScope | null;
  eligibility: ConditionNode | null;
  reward: unknown;
  currency: string;
}

export interface EmployeeSnapshotRow {
  userId: number;
  name: string;
  role: string;
  process: string;
  team?: string | null;
  points: number;
  metrics: {
    leadsSubmitted: number;
    leadsAccepted: number;
    followUps: number;
    sales: number;
    scoredLeads: number;
  };
  ruleBreakdown: ReadonlyArray<{ ruleId: number | null; event: string; points: number }>;
}

export interface IncentiveExplanation {
  scheme: string;
  schemeId: number;
  schemeVersion: number;
  eligibility: IncentiveEligibility;
  points: number;
  checks: ConditionCheck[];
  reward: {
    kind: RewardOutcome["rewardKind"];
    amount: number;
    label: string | null;
    tier: RewardOutcome["tier"];
    calc: string;
  };
  reason: string;
}

export interface IncentiveEvaluation {
  schemeId: number;
  schemeVersion: number;
  userId: number;
  eligibility: IncentiveEligibility;
  rewardKind: RewardOutcome["rewardKind"];
  rewardAmount: number;
  rewardLabel: string | null;
  currency: string;
  points: number;
  explanation: IncentiveExplanation;
}

function inScope(scope: SchemeScope | null, e: EmployeeSnapshotRow): boolean {
  if (!scope) return true;
  if (scope.userIds && scope.userIds.length > 0) return scope.userIds.includes(e.userId);
  if (scope.processes && scope.processes.length > 0 && !scope.processes.includes(e.process))
    return false;
  if (scope.roles && scope.roles.length > 0 && !scope.roles.includes(e.role)) return false;
  if (scope.teams && scope.teams.length > 0) {
    if (!e.team || !scope.teams.includes(e.team)) return false;
  }
  return true;
}

/** Evaluate ONE scheme version for ONE employee. Total — never throws. */
export function evaluateScheme(
  v: SchemeVersionConfig,
  e: EmployeeSnapshotRow,
): IncentiveEvaluation {
  const base = {
    schemeId: v.schemeId,
    schemeVersion: v.version,
    userId: e.userId,
    currency: v.currency || "INR",
    points: e.points,
  };

  if (!inScope(v.scope, e)) {
    const explanation: IncentiveExplanation = {
      scheme: v.name,
      schemeId: v.schemeId,
      schemeVersion: v.version,
      eligibility: "OUT_OF_SCOPE",
      points: e.points,
      checks: [],
      reward: { kind: "FIXED", amount: 0, label: null, tier: null, calc: "n/a" },
      reason: "Employee is outside the scheme scope (process / role / team / user).",
    };
    return {
      ...base,
      eligibility: "OUT_OF_SCOPE",
      rewardKind: "FIXED",
      rewardAmount: 0,
      rewardLabel: null,
      explanation,
    };
  }

  const ctx = buildMetricContext({
    points: e.points,
    metrics: e.metrics,
    ruleBreakdown: e.ruleBreakdown,
  });
  const elig = evaluateEligibility(v.eligibility, ctx);

  if (!elig.passed) {
    const failed = elig.checks.filter((c) => !c.pass);
    const explanation: IncentiveExplanation = {
      scheme: v.name,
      schemeId: v.schemeId,
      schemeVersion: v.version,
      eligibility: "NOT_ELIGIBLE",
      points: e.points,
      checks: elig.checks,
      reward: { kind: "FIXED", amount: 0, label: null, tier: null, calc: "not eligible" },
      reason:
        failed.length > 0
          ? `Did not meet: ${failed
              .map((c) => `${c.metric} ${c.operator} ${c.value} (was ${c.actual})`)
              .join("; ")}`
          : "Eligibility conditions not met.",
    };
    return {
      ...base,
      eligibility: "NOT_ELIGIBLE",
      rewardKind: "FIXED",
      rewardAmount: 0,
      rewardLabel: null,
      explanation,
    };
  }

  const reward = evaluateReward(v.reward, ctx);
  const explanation: IncentiveExplanation = {
    scheme: v.name,
    schemeId: v.schemeId,
    schemeVersion: v.version,
    eligibility: "ELIGIBLE",
    points: e.points,
    checks: elig.checks,
    reward: {
      kind: reward.rewardKind,
      amount: reward.rewardAmount,
      label: reward.rewardLabel,
      tier: reward.tier,
      calc: reward.calc,
    },
    reason:
      reward.rewardKind === "RECOGNITION"
        ? `Eligible — recognition reward "${reward.rewardLabel ?? "Recognition"}".`
        : reward.tier
          ? `Eligible — reached tier [${reward.tier.min}${reward.tier.label ? ` "${reward.tier.label}"` : ""}] → ${reward.rewardAmount} ${base.currency}.`
          : `Eligible — ${reward.rewardAmount} ${base.currency} (${reward.calc}).`,
  };
  return {
    ...base,
    eligibility: "ELIGIBLE",
    rewardKind: reward.rewardKind,
    rewardAmount: reward.rewardAmount,
    rewardLabel: reward.rewardLabel,
    explanation,
  };
}

/* --------------------------- multi-scheme --------------------------- */

export type CombineMode = "independent" | "exclusive" | "highest";

export interface CombinableResult {
  combineMode: CombineMode;
  priority: number;
  evaluation: IncentiveEvaluation;
}

export interface CombinedOutcome extends IncentiveEvaluation {
  combineMode: CombineMode;
  priority: number;
  /** true when this result was suppressed by an exclusive/highest rule */
  superseded: boolean;
  supersededBy: number | null;
}

/**
 * Decide what pays when multiple schemes match one employee.
 *   independent → every eligible scheme pays its own result
 *   exclusive   → among ELIGIBLE `exclusive` schemes, only the winner pays
 *                 (priority ASC, then rewardAmount DESC, then schemeId ASC);
 *                 the rest become superseded (NO_MATCH, reward 0)
 *   highest     → among ELIGIBLE `highest` schemes, only the max-reward pays
 *                 (tie → priority ASC → schemeId ASC)
 * Never double-pays within a group. Output is sorted priority ASC, schemeId ASC.
 */
export function combineResults(items: CombinableResult[]): CombinedOutcome[] {
  const order = (a: CombinableResult, b: CombinableResult) =>
    a.priority - b.priority || a.evaluation.schemeId - b.evaluation.schemeId;

  const eligibleExclusive = items
    .filter((i) => i.combineMode === "exclusive" && i.evaluation.eligibility === "ELIGIBLE")
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        b.evaluation.rewardAmount - a.evaluation.rewardAmount ||
        a.evaluation.schemeId - b.evaluation.schemeId,
    );
  const exclusiveWinner = eligibleExclusive[0]?.evaluation.schemeId ?? null;

  const eligibleHighest = items
    .filter((i) => i.combineMode === "highest" && i.evaluation.eligibility === "ELIGIBLE")
    .sort(
      (a, b) =>
        b.evaluation.rewardAmount - a.evaluation.rewardAmount ||
        a.priority - b.priority ||
        a.evaluation.schemeId - b.evaluation.schemeId,
    );
  const highestWinner = eligibleHighest[0]?.evaluation.schemeId ?? null;

  return [...items].sort(order).map((i) => {
    let superseded = false;
    let supersededBy: number | null = null;
    if (
      i.combineMode === "exclusive" &&
      i.evaluation.eligibility === "ELIGIBLE" &&
      exclusiveWinner != null &&
      i.evaluation.schemeId !== exclusiveWinner
    ) {
      superseded = true;
      supersededBy = exclusiveWinner;
    }
    if (
      i.combineMode === "highest" &&
      i.evaluation.eligibility === "ELIGIBLE" &&
      highestWinner != null &&
      i.evaluation.schemeId !== highestWinner
    ) {
      superseded = true;
      supersededBy = highestWinner;
    }
    if (superseded) {
      return {
        ...i.evaluation,
        combineMode: i.combineMode,
        priority: i.priority,
        superseded: true,
        supersededBy,
        eligibility: i.evaluation.eligibility,
        rewardAmount: 0,
        explanation: {
          ...i.evaluation.explanation,
          reason: `Superseded by ${i.combineMode} scheme #${supersededBy} (this scheme paid 0).`,
        },
      };
    }
    return {
      ...i.evaluation,
      combineMode: i.combineMode,
      priority: i.priority,
      superseded: false,
      supersededBy: null,
    };
  });
}
