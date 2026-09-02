import { describe, expect, it } from "vitest";
import { normalizeBusinessEvent, type BusinessEvent } from "../events/business-event";
import { evaluateScoring, type EvaluableRule } from "../scoring/ingest";
import type { Outcome } from "../scoring/modes";
import type { ConditionNode } from "../scoring/conditions";
import type { AppliesTo } from "../scoring/ingest";

/* --- synthetic helpers (test-only; nothing is seeded into any DB) --- */

function evt(
  payload: Record<string, string | number | boolean | null>,
  over: Partial<BusinessEvent> = {},
): BusinessEvent {
  const raw = {
    type: "LEAD_SUBMITTED",
    occurredAtMs: 1_788_000_000_000,
    operationalDate: "2026-08-31",
    subjectUserId: 123,
    actorUserId: 123,
    source: { type: "lead", id: "TEST-001" },
    payload,
    ...over,
  };
  const n = normalizeBusinessEvent(raw);
  if (!n.ok) throw new Error(`bad synthetic event: ${n.reason}`);
  return n.event;
}

let nextId = 1;
function rule(partial: {
  event?: string;
  priority?: number;
  mode?: EvaluableRule["ruleMatchingMode"];
  appliesTo?: AppliesTo | null;
  conditionTree?: ConditionNode | null;
  outcome: Outcome;
  name?: string;
  version?: number;
}): EvaluableRule {
  const id = nextId++;
  return {
    ruleId: id,
    ruleName: partial.name ?? `Rule ${id}`,
    event: partial.event ?? "LEAD_SUBMITTED",
    priority: partial.priority ?? 100,
    ruleMatchingMode: partial.mode ?? "FIRST_MATCH",
    appliesTo: partial.appliesTo ?? null,
    version: partial.version ?? 1,
    conditionTree: partial.conditionTree ?? null,
    outcome: partial.outcome,
  };
}

describe("evaluateScoring — synthetic business scenarios (no seeded values)", () => {
  it("Debt >= 20,000 → 200 points", () => {
    const r = rule({
      name: "High Debt Lead",
      conditionTree: { field: "debt_amount", operator: "gte", value: 20000, valueType: "money" },
      outcome: { kind: "FLAT", points: 200 },
    });
    const d = evaluateScoring(evt({ debt_amount: 23000, state: "CA" }), [r]);
    expect(d.awardedPointsTotal).toBe(200);
    expect(d.awards[0]?.ruleName).toBe("High Debt Lead");
    expect(d.awards[0]?.dedupeKey).toBe(`LEAD_SUBMITTED:lead:TEST-001:rule:${r.ruleId}:v1`);
    expect(d.awards[0]?.context.rule.version).toBe(1);
  });

  it("Debt < 20,000 → no award, but the run still records why", () => {
    const r = rule({
      conditionTree: { field: "debt_amount", operator: "gte", value: 20000, valueType: "money" },
      outcome: { kind: "FLAT", points: 200 },
    });
    const d = evaluateScoring(evt({ debt_amount: 15000 }), [r]);
    expect(d.awards).toEqual([]);
    expect(d.skipped[0]?.reason).toBe("condition_false");
  });

  it("debt-amount bands, HIGHEST strategy — $40k lead → 500 (not the sum)", () => {
    const r = rule({
      outcome: {
        kind: "BANDS",
        on: "debt_amount",
        strategy: "HIGHEST",
        bands: [
          { min: 10000, points: 10 },
          { min: 20000, points: 200 },
          { min: 30000, points: 300 },
          { min: 40000, points: 500 },
        ],
      },
    });
    expect(evaluateScoring(evt({ debt_amount: 40000 }), [r]).awardedPointsTotal).toBe(500);
  });

  it("closer-specific rule via applies_to.closerIds (ids are data, not code)", () => {
    const r = rule({
      event: "LEAD_ACCEPTED",
      appliesTo: { closerIds: [456] },
      outcome: { kind: "FLAT", points: 75 },
    });
    const base = { debt_amount: 5000, closer_id: 456, role: "closer", process: "US" };
    const hit = evaluateScoring(
      evt(base, { type: "LEAD_ACCEPTED", source: { type: "lead", id: "L2" } }),
      [r],
    );
    expect(hit.awardedPointsTotal).toBe(75);
    const miss = evaluateScoring(
      evt(
        { ...base, closer_id: 999 },
        { type: "LEAD_ACCEPTED", source: { type: "lead", id: "L3" } },
      ),
      [r],
    );
    expect(miss.awardedPointsTotal).toBe(0);
    expect(miss.skipped[0]?.reason).toBe("applies_to:closer_id");
  });

  it("tenure bracket — 'beginner' = an Admin-chosen range, not a hard-coded label", () => {
    const r = rule({
      event: "SALE",
      appliesTo: { closerTenureDaysMax: 30 },
      outcome: { kind: "FLAT", points: 500 },
    });
    const newbie = evaluateScoring(
      evt({ closer_tenure_days: 12 }, { type: "SALE", source: { type: "lead", id: "S1" } }),
      [r],
    );
    expect(newbie.awardedPointsTotal).toBe(500);
    const veteran = evaluateScoring(
      evt({ closer_tenure_days: 400 }, { type: "SALE", source: { type: "lead", id: "S2" } }),
      [r],
    );
    expect(veteran.awardedPointsTotal).toBe(0);
  });

  it("negative points — a penalty rule is an ordinary rule, ordinary award", () => {
    const r = rule({
      conditionTree: { field: "lead_source", operator: "eq", value: "JUNK", valueType: "string" },
      outcome: { kind: "FLAT", points: -100 },
    });
    expect(evaluateScoring(evt({ lead_source: "JUNK" }), [r]).awardedPointsTotal).toBe(-100);
  });

  it("multiple conditions with AND/OR nesting", () => {
    const tree: ConditionNode = {
      op: "AND",
      nodes: [
        { field: "debt_amount", operator: "gte", value: 20000, valueType: "money" },
        {
          op: "OR",
          nodes: [
            { field: "state", operator: "in", value: ["CA", "NV"], valueType: "stringList" },
            { field: "credit_status", operator: "eq", value: "GOOD", valueType: "string" },
          ],
        },
      ],
    };
    const r = rule({ conditionTree: tree, outcome: { kind: "FLAT", points: 300 } });
    expect(evaluateScoring(evt({ debt_amount: 25000, state: "CA" }), [r]).awardedPointsTotal).toBe(
      300,
    );
    expect(
      evaluateScoring(evt({ debt_amount: 25000, state: "TX", credit_status: "POOR" }), [r])
        .awardedPointsTotal,
    ).toBe(0);
  });
});

describe("evaluateScoring — multiple rules for one event", () => {
  const mkTwo = (mode: EvaluableRule["ruleMatchingMode"]) => [
    rule({ priority: 10, mode, outcome: { kind: "FLAT", points: 100 } }),
    rule({ priority: 20, mode, outcome: { kind: "FLAT", points: 250 } }),
  ];

  it("FIRST_MATCH → one award, the first by priority", () => {
    const d = evaluateScoring(evt({ debt_amount: 1 }), mkTwo("FIRST_MATCH"));
    expect(d.awards.map((a) => a.points)).toEqual([100]);
  });
  it("HIGHEST_MATCH → one award, the most valuable", () => {
    const d = evaluateScoring(evt({ debt_amount: 1 }), mkTwo("HIGHEST_MATCH"));
    expect(d.awards.map((a) => a.points)).toEqual([250]);
  });
  it("ALL_MATCHES → each rule awarded once, distinct dedupe keys", () => {
    const d = evaluateScoring(evt({ debt_amount: 1 }), mkTwo("ALL_MATCHES"));
    expect(d.awards.map((a) => a.points)).toEqual([100, 250]);
    expect(new Set(d.awards.map((a) => a.dedupeKey)).size).toBe(2);
  });
});

describe("evaluateScoring — determinism + explainability", () => {
  it("same (event, rules) → identical decision", () => {
    const rules = [
      rule({
        conditionTree: { field: "debt_amount", operator: "gte", value: 10000, valueType: "money" },
        outcome: {
          kind: "BANDS",
          on: "debt_amount",
          bands: [
            { min: 10000, points: 10 },
            { min: 30000, points: 300 },
          ],
        },
      }),
    ];
    const e = evt({ debt_amount: 35000, state: "CA" });
    const a = JSON.stringify(evaluateScoring(e, rules));
    for (let i = 0; i < 25; i++) expect(JSON.stringify(evaluateScoring(e, rules))).toBe(a);
  });

  it("every award carries a context that explains the points", () => {
    const r = rule({
      name: "High Debt Lead",
      version: 3,
      conditionTree: { field: "debt_amount", operator: "gte", value: 20000, valueType: "money" },
      outcome: {
        kind: "BANDS",
        on: "debt_amount",
        strategy: "HIGHEST",
        bands: [{ min: 20000, points: 200 }],
      },
    });
    const ctx = evaluateScoring(evt({ debt_amount: 23000 }), [r]).awards[0]!.context;
    expect(ctx.rule).toMatchObject({
      name: "High Debt Lead",
      version: 3,
      matchingMode: "FIRST_MATCH",
    });
    expect(ctx.outcome.kind).toBe("BANDS");
    expect(ctx.outcome.strategy).toBe("HIGHEST");
    expect(ctx.payloadUsed).toMatchObject({ debt_amount: 23000 });
    expect(ctx.points).toBe(200);
  });
});
