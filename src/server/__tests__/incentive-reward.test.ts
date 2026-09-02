/**
 * Phase 9 — INCENTIVE ENGINE reward structures. PURE. Amounts are scheme config;
 * the engine determines an EARNED result, never a payment.
 */
import { describe, expect, it } from "vitest";
import { buildMetricContext } from "../incentive/conditions";
import { evaluateReward, validateReward } from "../incentive/reward";

const ctx = (points: number, extra: Partial<Record<string, number>> = {}) =>
  buildMetricContext({
    points,
    metrics: {
      leadsSubmitted: extra["leadsSubmitted"] ?? 0,
      leadsAccepted: extra["leadsAccepted"] ?? 0,
      followUps: 0,
      sales: extra["sales"] ?? 0,
      scoredLeads: 0,
    },
    ruleBreakdown: [],
  });

describe("evaluateReward", () => {
  it("FIXED — flat amount", () => {
    const r = evaluateReward({ kind: "FIXED", amount: 2500 }, ctx(9999));
    expect(r).toMatchObject({ rewardKind: "FIXED", rewardAmount: 2500, tier: null });
  });

  it("TIERED — highest tier whose min <= value", () => {
    const reward = {
      kind: "TIERED",
      metric: "points",
      tiers: [
        { min: 0, amount: 0 },
        { min: 5000, amount: 2500, label: "Tier 1" },
        { min: 7500, amount: 5000, label: "Tier 2" },
        { min: 10000, amount: 10000, label: "Tier 3" },
      ],
    };
    expect(evaluateReward(reward, ctx(8250)).rewardAmount).toBe(5000);
    expect(evaluateReward(reward, ctx(8250)).tier).toMatchObject({
      min: 7500,
      amount: 5000,
      label: "Tier 2",
    });
    expect(evaluateReward(reward, ctx(4999)).rewardAmount).toBe(0);
    expect(evaluateReward(reward, ctx(12000)).rewardAmount).toBe(10000);
    // input order of tiers does not matter
    const shuffled = { ...reward, tiers: [...reward.tiers].reverse() };
    expect(evaluateReward(shuffled, ctx(8250)).rewardAmount).toBe(5000);
  });

  it("TIERED — below the lowest tier → 0, explained", () => {
    const r = evaluateReward({ kind: "TIERED", tiers: [{ min: 5000, amount: 2500 }] }, ctx(3100));
    expect(r.rewardAmount).toBe(0);
    expect(r.calc).toMatch(/below the lowest tier/);
  });

  it("PERCENT — of a metric, with optional cap", () => {
    expect(
      evaluateReward({ kind: "PERCENT", metric: "points", percent: 10 }, ctx(8250)).rewardAmount,
    ).toBe(825);
    expect(
      evaluateReward({ kind: "PERCENT", metric: "points", percent: 10, cap: 500 }, ctx(8250))
        .rewardAmount,
    ).toBe(500);
    expect(
      evaluateReward({ kind: "PERCENT", metric: "sales", percent: 100 }, ctx(0, { sales: 6 }))
        .rewardAmount,
    ).toBe(6);
  });

  it("RECOGNITION — non-monetary, amount 0 + label", () => {
    const r = evaluateReward({ kind: "RECOGNITION", label: "Star of the Month" }, ctx(9999));
    expect(r).toMatchObject({
      rewardKind: "RECOGNITION",
      rewardAmount: 0,
      rewardLabel: "Star of the Month",
    });
  });

  it("malformed config → zero reward, never throws", () => {
    expect(evaluateReward(null, ctx(100)).rewardAmount).toBe(0);
    expect(evaluateReward({ kind: "NOPE" }, ctx(100)).rewardAmount).toBe(0);
    expect(evaluateReward({ kind: "TIERED" }, ctx(100)).rewardAmount).toBe(0);
  });

  it("is deterministic", () => {
    const reward = { kind: "TIERED", tiers: [{ min: 100, amount: 50 }] };
    const a = evaluateReward(reward, ctx(150));
    for (let i = 0; i < 10; i++) expect(evaluateReward(reward, ctx(150))).toEqual(a);
  });
});

describe("validateReward", () => {
  it("accepts each valid kind", () => {
    expect(validateReward({ kind: "FIXED", amount: 1 })).toEqual([]);
    expect(validateReward({ kind: "PERCENT", percent: 5 })).toEqual([]);
    expect(validateReward({ kind: "RECOGNITION", label: "x" })).toEqual([]);
    expect(validateReward({ kind: "TIERED", tiers: [{ min: 0, amount: 0 }] })).toEqual([]);
  });
  it("flags missing / malformed config", () => {
    expect(validateReward(null)).toContain("reward_missing");
    expect(validateReward({ kind: "WHAT" })).toContain("reward_bad_kind");
    expect(validateReward({ kind: "TIERED", tiers: [] })).toContain("tiered_no_tiers");
    expect(validateReward({ kind: "RECOGNITION" })).toContain("recognition_missing_label");
  });
});
