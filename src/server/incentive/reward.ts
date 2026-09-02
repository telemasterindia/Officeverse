/**
 * Officeverse — INCENTIVE ENGINE · reward structures (Phase 9). PURE.
 *
 * An extensible reward model. The amount is an integer in the scheme's currency
 * unit — the engine determines an EARNED result, it does NOT process a payment.
 * No hard-coded amounts / thresholds: every number is scheme-config.
 */
import { metricValue, type IncentiveMetricContext } from "./conditions";

export const REWARD_KINDS = ["FIXED", "TIERED", "PERCENT", "RECOGNITION"] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

export interface FixedReward {
  kind: "FIXED";
  amount: number;
}
export interface RewardTier {
  min: number;
  amount: number;
  label?: string;
}
export interface TieredReward {
  kind: "TIERED";
  /** metric the tier is matched against (default "points") */
  metric?: string;
  tiers: RewardTier[];
}
export interface PercentReward {
  kind: "PERCENT";
  /** metric the percentage applies to (default "points") */
  metric?: string;
  percent: number;
  cap?: number;
}
export interface RecognitionReward {
  kind: "RECOGNITION";
  label: string;
}
export type RewardConfig = FixedReward | TieredReward | PercentReward | RecognitionReward;

export interface RewardOutcome {
  rewardKind: RewardKind;
  /** integer amount in the scheme currency; 0 for RECOGNITION / no tier */
  rewardAmount: number;
  rewardLabel: string | null;
  /** the matched tier (TIERED only), or null */
  tier: { min: number; amount: number; label: string | null } | null;
  /** human-readable calculation trace for the explanation */
  calc: string;
}

const ZERO: RewardOutcome = {
  rewardKind: "FIXED",
  rewardAmount: 0,
  rewardLabel: null,
  tier: null,
  calc: "no reward",
};

/**
 * Resolve the earned reward for one eligible employee. Total — never throws; a
 * malformed config yields a zero reward with an explanatory `calc`.
 */
export function evaluateReward(reward: unknown, ctx: IncentiveMetricContext): RewardOutcome {
  if (!reward || typeof reward !== "object") return { ...ZERO, calc: "invalid reward config" };
  const r = reward as RewardConfig;

  if (r.kind === "FIXED") {
    const amount = int(r.amount);
    return {
      rewardKind: "FIXED",
      rewardAmount: amount,
      rewardLabel: null,
      tier: null,
      calc: `fixed ${amount}`,
    };
  }

  if (r.kind === "RECOGNITION") {
    const label = typeof r.label === "string" ? r.label.slice(0, 120) : "Recognition";
    return {
      rewardKind: "RECOGNITION",
      rewardAmount: 0,
      rewardLabel: label,
      tier: null,
      calc: `recognition: ${label}`,
    };
  }

  if (r.kind === "PERCENT") {
    const key = typeof r.metric === "string" && r.metric ? r.metric : "points";
    const base = metricValue(ctx, key);
    const pct = num(r.percent);
    let amount = Math.round((base * pct) / 100);
    const cap = r.cap != null ? int(r.cap) : null;
    if (cap != null && amount > cap) amount = cap;
    if (amount < 0) amount = 0;
    return {
      rewardKind: "PERCENT",
      rewardAmount: amount,
      rewardLabel: null,
      tier: null,
      calc: `${pct}% of ${key}=${base} → ${amount}${cap != null ? ` (cap ${cap})` : ""}`,
    };
  }

  if (r.kind === "TIERED") {
    const key = typeof r.metric === "string" && r.metric ? r.metric : "points";
    const value = metricValue(ctx, key);
    const tiers = Array.isArray(r.tiers)
      ? [...r.tiers]
          .filter((t) => t && typeof t === "object")
          .map((t) => ({ min: num(t.min), amount: int(t.amount), label: strOrNull(t.label) }))
          .sort((a, b) => a.min - b.min)
      : [];
    let matched: { min: number; amount: number; label: string | null } | null = null;
    for (const t of tiers) {
      if (value >= t.min) matched = t;
    }
    return {
      rewardKind: "TIERED",
      rewardAmount: matched ? matched.amount : 0,
      rewardLabel: matched?.label ?? null,
      tier: matched,
      calc: matched
        ? `${key}=${value} → tier [${matched.min}${matched.label ? ` "${matched.label}"` : ""}] → ${matched.amount}`
        : `${key}=${value} → below the lowest tier → 0`,
    };
  }

  return { ...ZERO, calc: "unknown reward kind" };
}

/** Static validation for the scheme editor. Returns [] when saveable. */
export function validateReward(reward: unknown): string[] {
  if (!reward || typeof reward !== "object") return ["reward_missing"];
  const r = reward as Record<string, unknown>;
  if (!(REWARD_KINDS as readonly string[]).includes(r["kind"] as string))
    return ["reward_bad_kind"];
  const errs: string[] = [];
  if (r["kind"] === "FIXED" && !Number.isFinite(r["amount"] as number))
    errs.push("fixed_bad_amount");
  if (r["kind"] === "RECOGNITION" && (typeof r["label"] !== "string" || !r["label"]))
    errs.push("recognition_missing_label");
  if (r["kind"] === "PERCENT" && !Number.isFinite(r["percent"] as number))
    errs.push("percent_bad_percent");
  if (r["kind"] === "TIERED") {
    if (!Array.isArray(r["tiers"]) || (r["tiers"] as unknown[]).length === 0)
      errs.push("tiered_no_tiers");
    else
      for (const t of r["tiers"] as Record<string, unknown>[]) {
        if (!Number.isFinite(t["min"] as number)) errs.push("tier_bad_min");
        if (!Number.isFinite(t["amount"] as number)) errs.push("tier_bad_amount");
      }
  }
  return errs;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function int(v: unknown): number {
  return Math.trunc(num(v));
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, 120) : null;
}
