import { describe, expect, it } from "vitest";
import { evaluateCondition, type ConditionNode } from "../scoring/conditions";
import { resolveOutcome, type Outcome } from "../scoring/modes";

describe("scoring money — exact decimal boundaries, no float drift", () => {
  const rule: ConditionNode = {
    field: "debt_amount",
    operator: "gte",
    value: 20000,
    valueType: "money",
  };

  it("19999.99 does NOT satisfy >= 20000", () => {
    expect(evaluateCondition(rule, { debt_amount: 19999.99 }).result).toBe(false);
  });
  it("20000 satisfies >= 20000 (boundary inclusive)", () => {
    expect(evaluateCondition(rule, { debt_amount: 20000 }).result).toBe(true);
  });
  it("20000.01 satisfies >= 20000", () => {
    expect(evaluateCondition(rule, { debt_amount: 20000.01 }).result).toBe(true);
  });
  it("classic 0.1 + 0.2 style value compares exactly", () => {
    const r: ConditionNode = {
      field: "debt_amount",
      operator: "eq",
      value: 0.3,
      valueType: "money",
    };
    expect(evaluateCondition(r, { debt_amount: 0.1 + 0.2 }).result).toBe(true);
  });
  it("numeric string and number compare identically", () => {
    expect(evaluateCondition(rule, { debt_amount: "20000.00" }).result).toBe(true);
    expect(evaluateCondition(rule, { debt_amount: "19999.99" }).result).toBe(false);
  });
});

describe("scoring money — band thresholds are decimal-exact", () => {
  const outcome: Outcome = {
    kind: "BANDS",
    on: "debt_amount",
    strategy: "HIGHEST",
    bands: [
      { min: 10000, points: 10 },
      { min: 20000, points: 200 },
      { min: 30000, points: 300 },
      { min: 40000, points: 500 },
    ],
  };

  it("$40,000 → 500 (HIGHEST, not the sum)", () => {
    expect(resolveOutcome(outcome, { debt_amount: 40000 }).points).toBe(500);
  });
  it("$19,999.99 → 10 (only the 10k band satisfied)", () => {
    expect(resolveOutcome(outcome, { debt_amount: 19999.99 }).points).toBe(10);
  });
  it("$20,000.00 exactly → 200", () => {
    expect(resolveOutcome(outcome, { debt_amount: 20000 }).points).toBe(200);
  });
  it("below the first band → 0", () => {
    expect(resolveOutcome(outcome, { debt_amount: 9999.99 }).points).toBe(0);
  });
  it("missing / non-numeric band input → 0 with a reason, never a throw", () => {
    expect(resolveOutcome(outcome, {}).points).toBe(0);
    expect(resolveOutcome(outcome, { debt_amount: null }).reason).toBe("band_input_unavailable");
  });
});
