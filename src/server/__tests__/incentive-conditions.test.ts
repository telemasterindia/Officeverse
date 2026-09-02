/**
 * Phase 9 — INCENTIVE ENGINE eligibility conditions. PURE. No scoring, no
 * hard-coded thresholds (every value is scheme config).
 */
import { describe, expect, it } from "vitest";
import {
  buildMetricContext,
  evaluateEligibility,
  metricValue,
  validateConditionTree,
  type ConditionNode,
  type IncentiveMetricContext,
} from "../incentive/conditions";

const ctx: IncentiveMetricContext = buildMetricContext({
  points: 8250,
  metrics: { leadsSubmitted: 40, leadsAccepted: 28, followUps: 3, sales: 6, scoredLeads: 22 },
  ruleBreakdown: [
    { ruleId: 5, event: "LEAD_ACCEPTED", points: 1200 },
    { ruleId: 5, event: "LEAD_ACCEPTED", points: 300 },
    { ruleId: 9, event: "SALE", points: 1400 },
    { ruleId: null, event: "LEAD_SUBMITTED", points: 40 },
  ],
});

describe("metricValue — static + dynamic families", () => {
  it("resolves static metrics", () => {
    expect(metricValue(ctx, "points")).toBe(8250);
    expect(metricValue(ctx, "leadsAccepted")).toBe(28);
    expect(metricValue(ctx, "sales")).toBe(6);
    expect(metricValue(ctx, "scoredLeads")).toBe(22);
    expect(metricValue(ctx, "totalActivity")).toBe(40 + 28 + 3 + 6);
  });
  it("resolves rulePoints:<id> and eventPoints:<EVENT> from the breakdown", () => {
    expect(metricValue(ctx, "rulePoints:5")).toBe(1500);
    expect(metricValue(ctx, "rulePoints:9")).toBe(1400);
    expect(metricValue(ctx, "eventPoints:LEAD_ACCEPTED")).toBe(1500);
    expect(metricValue(ctx, "eventPoints:SALE")).toBe(1400);
  });
  it("unknown / malformed metric → 0 (never throws)", () => {
    expect(metricValue(ctx, "nope")).toBe(0);
    expect(metricValue(ctx, "rulePoints:999")).toBe(0);
    expect(metricValue(ctx, "eventPoints:MADE_UP")).toBe(0);
  });
});

describe("evaluateEligibility — AND / OR trees + explainable checks", () => {
  it("null tree → eligible, no checks (a scheme with no conditions pays everyone in scope)", () => {
    const r = evaluateEligibility(null, ctx);
    expect(r.passed).toBe(true);
    expect(r.checks).toEqual([]);
  });
  it("a passing AND tree records every check", () => {
    const tree: ConditionNode = {
      op: "AND",
      nodes: [
        { metric: "points", operator: "gte", value: 7500 },
        { metric: "leadsAccepted", operator: "gte", value: 25 },
        { metric: "sales", operator: "gte", value: 5 },
      ],
    };
    const r = evaluateEligibility(tree, ctx);
    expect(r.passed).toBe(true);
    expect(r.checks.map((c) => c.pass)).toEqual([true, true, true]);
    expect(r.checks[0]).toMatchObject({
      metric: "points",
      operator: "gte",
      value: 7500,
      actual: 8250,
    });
  });
  it("a failing AND → not eligible; the failing leaf is visible", () => {
    const r = evaluateEligibility(
      { op: "AND", nodes: [{ metric: "points", operator: "gte", value: 9000 }] },
      ctx,
    );
    expect(r.passed).toBe(false);
    expect(r.checks[0]).toMatchObject({ pass: false, actual: 8250, value: 9000 });
  });
  it("OR passes when any child passes", () => {
    const r = evaluateEligibility(
      {
        op: "OR",
        nodes: [
          { metric: "sales", operator: "gte", value: 100 },
          { metric: "points", operator: "gte", value: 5000 },
        ],
      },
      ctx,
    );
    expect(r.passed).toBe(true);
  });
  it("all operators behave", () => {
    const c = buildMetricContext({
      points: 10,
      metrics: { leadsSubmitted: 0, leadsAccepted: 0, followUps: 0, sales: 0, scoredLeads: 0 },
      ruleBreakdown: [],
    });
    expect(
      evaluateEligibility({ metric: "points", operator: "eq", value: 10 } as ConditionNode, c)
        .passed,
    ).toBe(true);
    expect(
      evaluateEligibility({ metric: "points", operator: "neq", value: 10 } as ConditionNode, c)
        .passed,
    ).toBe(false);
    expect(
      evaluateEligibility({ metric: "points", operator: "lt", value: 11 } as ConditionNode, c)
        .passed,
    ).toBe(true);
    expect(
      evaluateEligibility({ metric: "points", operator: "lte", value: 10 } as ConditionNode, c)
        .passed,
    ).toBe(true);
    expect(
      evaluateEligibility({ metric: "points", operator: "gt", value: 10 } as ConditionNode, c)
        .passed,
    ).toBe(false);
  });
  it("is deterministic for the same tree + ctx", () => {
    const tree: ConditionNode = {
      op: "AND",
      nodes: [{ metric: "points", operator: "gte", value: 7500 }],
    };
    const a = evaluateEligibility(tree, ctx);
    for (let i = 0; i < 10; i++) expect(evaluateEligibility(tree, ctx)).toEqual(a);
  });
});

describe("validateConditionTree", () => {
  it("accepts a well-formed tree", () => {
    expect(
      validateConditionTree({
        op: "AND",
        nodes: [{ metric: "points", operator: "gte", value: 1 }],
      }),
    ).toEqual([]);
    expect(validateConditionTree(null)).toEqual([]);
  });
  it("flags a bad operator / value / group op", () => {
    expect(validateConditionTree({ metric: "points", operator: "≥", value: 1 })).toContain(
      "leaf_bad_operator",
    );
    expect(validateConditionTree({ metric: "points", operator: "gte", value: "x" })).toContain(
      "leaf_bad_value",
    );
    expect(validateConditionTree({ op: "XOR", nodes: [] })).toContain("bad_group_op");
  });
});
