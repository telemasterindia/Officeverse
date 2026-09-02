import { describe, expect, it } from "vitest";
import { validateRuleDraft, type RuleDraft } from "../scoring/service";

const good: RuleDraft = {
  name: "High Debt Lead",
  event: "LEAD_SUBMITTED",
  ruleMatchingMode: "FIRST_MATCH",
  priority: 100,
  conditionTree: { field: "debt_amount", operator: "gte", value: 20000, valueType: "money" },
  outcome: { kind: "FLAT", points: 200 },
  effectiveFrom: "2026-09-01",
};

describe("scoring service — validateRuleDraft (server-authoritative, pure part)", () => {
  it("accepts a well-formed draft", () => {
    expect(validateRuleDraft(good)).toEqual([]);
  });

  it("rejects an unknown / disabled event", () => {
    expect(validateRuleDraft({ ...good, event: "WAT" })).toContain("event_unknown");
    expect(validateRuleDraft({ ...good, event: "FOLLOW_UP_COMPLETED" })).toContain(
      "event_not_enabled_for_scoring",
    );
  });

  it("rejects a bad effective date", () => {
    expect(validateRuleDraft({ ...good, effectiveFrom: "2026/09/01" })).toContain(
      "effective_from_invalid",
    );
  });

  it("rejects an out-of-range priority", () => {
    expect(validateRuleDraft({ ...good, priority: -1 })).toContain("priority_out_of_range");
    expect(validateRuleDraft({ ...good, priority: 1_000_001 })).toContain("priority_out_of_range");
  });

  it("surfaces outcome errors with an outcome: prefix", () => {
    const errs = validateRuleDraft({
      ...good,
      outcome: { kind: "FLAT", points: Number.POSITIVE_INFINITY },
    });
    expect(errs.some((e) => e.startsWith("outcome:"))).toBe(true);
  });

  it("surfaces condition errors with a condition: prefix (unknown field / bad event field)", () => {
    const errs = validateRuleDraft({
      ...good,
      conditionTree: { field: "ghost_field", operator: "eq", value: 1, valueType: "number" },
    });
    expect(errs.some((e) => e.startsWith("condition:") && e.endsWith("unknown_field"))).toBe(true);
  });

  it("allows a null condition tree (flat, unconditional rule)", () => {
    expect(validateRuleDraft({ ...good, conditionTree: null })).toEqual([]);
  });

  it("allows negative outcome points (penalty rule)", () => {
    expect(validateRuleDraft({ ...good, outcome: { kind: "FLAT", points: -100 } })).toEqual([]);
  });
});
