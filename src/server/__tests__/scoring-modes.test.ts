import { describe, expect, it } from "vitest";
import {
  DEFAULT_BAND_STRATEGY,
  DEFAULT_RULE_MATCHING_MODE,
  resolveOutcome,
  resolveRuleMatching,
  validateOutcome,
  type MatchedRule,
  type Outcome,
} from "../scoring/modes";

describe("scoring modes — the two concepts are separate, with sane defaults", () => {
  it("defaults: FIRST_MATCH (rule matching) and HIGHEST (band strategy)", () => {
    expect(DEFAULT_RULE_MATCHING_MODE).toBe("FIRST_MATCH");
    expect(DEFAULT_BAND_STRATEGY).toBe("HIGHEST");
  });
});

describe("scoring modes — A. rule matching mode", () => {
  const rules = (mode: MatchedRule["mode"]): MatchedRule[] => [
    { ruleId: 1, priority: 10, mode, points: 100 },
    { ruleId: 2, priority: 20, mode, points: 250 },
    { ruleId: 3, priority: 30, mode, points: 50 },
  ];

  it("FIRST_MATCH awards only the first (priority order), stops", () => {
    expect(resolveRuleMatching(rules("FIRST_MATCH"))).toEqual([{ ruleId: 1, points: 100 }]);
  });

  it("HIGHEST_MATCH awards the single most valuable matching rule", () => {
    expect(resolveRuleMatching(rules("HIGHEST_MATCH"))).toEqual([{ ruleId: 2, points: 250 }]);
  });

  it("ALL_MATCHES awards every matching rule once", () => {
    expect(resolveRuleMatching(rules("ALL_MATCHES"))).toEqual([
      { ruleId: 1, points: 100 },
      { ruleId: 2, points: 250 },
      { ruleId: 3, points: 50 },
    ]);
  });

  it("negative points are ordinary — a penalty rule is just a rule", () => {
    expect(
      resolveRuleMatching([{ ruleId: 9, priority: 5, mode: "ALL_MATCHES", points: -100 }]),
    ).toEqual([{ ruleId: 9, points: -100 }]);
  });
});

describe("scoring modes — B. band strategy", () => {
  const bands = [
    { min: 10000, points: 10 },
    { min: 20000, points: 200 },
    { min: 30000, points: 300 },
    { min: 40000, points: 500 },
  ];
  const at = (strategy: "HIGHEST" | "FIRST" | "ALL" | "CUMULATIVE", debt: number) =>
    resolveOutcome({ kind: "BANDS", on: "debt_amount", strategy, bands }, { debt_amount: debt })
      .points;

  it("HIGHEST → top satisfied band only", () => {
    expect(at("HIGHEST", 40000)).toBe(500);
  });
  it("FIRST → lowest satisfied band", () => {
    expect(at("FIRST", 40000)).toBe(10);
  });
  it("ALL → sum of every satisfied band", () => {
    expect(at("ALL", 40000)).toBe(10 + 200 + 300 + 500);
  });
  it("CUMULATIVE → each crossed threshold added", () => {
    expect(at("CUMULATIVE", 25000)).toBe(10 + 200);
  });
});

describe("scoring modes — outcome kinds", () => {
  it("FLAT", () => {
    expect(resolveOutcome({ kind: "FLAT", points: 500 }, {}).points).toBe(500);
  });
  it("BASE_PLUS_BONUS adds bonuses whose condition passes", () => {
    const o: Outcome = {
      kind: "BASE_PLUS_BONUS",
      base: 50,
      bonus: [
        {
          if: { field: "state", operator: "eq", value: "CA", valueType: "string" },
          points: 100,
        },
        {
          if: { field: "state", operator: "eq", value: "NV", valueType: "string" },
          points: 999,
        },
      ],
    };
    expect(resolveOutcome(o, { state: "CA" }).points).toBe(150);
  });
});

describe("scoring modes — band validation at save time", () => {
  it("accepts strictly increasing bands", () => {
    expect(
      validateOutcome({
        kind: "BANDS",
        on: "debt_amount",
        bands: [
          { min: 100, points: 1 },
          { min: 200, points: 2 },
        ],
      }),
    ).toEqual([]);
  });
  it("rejects non-increasing / duplicate mins", () => {
    expect(
      validateOutcome({
        kind: "BANDS",
        on: "debt_amount",
        bands: [
          { min: 200, points: 1 },
          { min: 200, points: 2 },
        ],
      }),
    ).toContain("band_1_min_not_increasing");
  });
  it("rejects NaN / Infinity / out-of-range points", () => {
    expect(validateOutcome({ kind: "FLAT", points: Number.POSITIVE_INFINITY })).toContain(
      "flat_points_out_of_range",
    );
    expect(validateOutcome({ kind: "FLAT", points: 999_999 })).toContain(
      "flat_points_out_of_range",
    );
    expect(validateOutcome({ kind: "FLAT", points: -100_000 })).toEqual([]);
  });
  it("rejects an unknown outcome kind / bad strategy", () => {
    expect(validateOutcome({ kind: "WAT", points: 1 })).toContain("unknown_outcome_kind");
    expect(
      validateOutcome({
        kind: "BANDS",
        on: "x",
        strategy: "MOSTLY",
        bands: [{ min: 1, points: 1 }],
      }),
    ).toContain("bad_strategy");
  });
  it("an invalid outcome resolves to 0 points, never a throw", () => {
    expect(resolveOutcome({ kind: "WAT" } as unknown as Outcome, {}).points).toBe(0);
  });
});
