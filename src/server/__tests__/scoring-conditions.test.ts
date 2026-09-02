import { describe, expect, it } from "vitest";
import {
  collectConditionIssues,
  evaluateCondition,
  type ConditionNode,
  type ScoringPayload,
} from "../scoring/conditions";

const P: ScoringPayload = {
  debt_amount: 23000,
  state: "CA",
  credit_status: "GOOD",
  lead_source: "TEST",
};

describe("condition tree — AND / OR / nesting", () => {
  it("AND: all children must be true", () => {
    const tree: ConditionNode = {
      op: "AND",
      nodes: [
        { field: "debt_amount", operator: "gte", value: 20000, valueType: "money" },
        { field: "state", operator: "eq", value: "CA", valueType: "string" },
      ],
    };
    expect(evaluateCondition(tree, P).result).toBe(true);
    expect(evaluateCondition(tree, { ...P, state: "NV" }).result).toBe(false);
  });

  it("OR: any child true wins", () => {
    const tree: ConditionNode = {
      op: "OR",
      nodes: [
        { field: "state", operator: "eq", value: "NV", valueType: "string" },
        { field: "state", operator: "eq", value: "CA", valueType: "string" },
      ],
    };
    expect(evaluateCondition(tree, P).result).toBe(true);
  });

  it("nested AND(OR, leaf)", () => {
    const tree: ConditionNode = {
      op: "AND",
      nodes: [
        { field: "debt_amount", operator: "gte", value: 20000, valueType: "money" },
        {
          op: "OR",
          nodes: [
            { field: "state", operator: "eq", value: "CA", valueType: "string" },
            { field: "state", operator: "eq", value: "NV", valueType: "string" },
          ],
        },
      ],
    };
    expect(evaluateCondition(tree, P).result).toBe(true);
  });
});

describe("condition tree — safe-false semantics (never throws, never awards)", () => {
  it("null / undefined tree is match-all", () => {
    expect(evaluateCondition(null, P).result).toBe(true);
    expect(evaluateCondition(undefined, P).result).toBe(true);
  });

  it("explicitly empty group is FALSE", () => {
    expect(evaluateCondition({ op: "AND", nodes: [] }, P).result).toBe(false);
    expect(evaluateCondition({ op: "OR", nodes: [] }, P).result).toBe(false);
  });

  it("missing field → false with reason missing_field", () => {
    const r = evaluateCondition(
      { field: "zip", operator: "eq", value: "90001", valueType: "string" },
      P,
    );
    expect(r.result).toBe(false);
    expect(r.traces.at(-1)?.reason).toBe("missing_field");
  });

  it("unknown field → false with reason unknown_field", () => {
    const r = evaluateCondition(
      { field: "made_up", operator: "eq", value: 1, valueType: "number" } as ConditionNode,
      P,
    );
    expect(r.result).toBe(false);
    expect(r.traces.at(-1)?.reason).toBe("unknown_field");
  });

  it("unknown operator → false", () => {
    const r = evaluateCondition(
      {
        field: "state",
        operator: "matchesVibes",
        value: "CA",
        valueType: "string",
      } as ConditionNode,
      P,
    );
    expect(r.result).toBe(false);
    expect(r.traces.at(-1)?.reason).toBe("unknown_operator");
  });

  it("value type mismatch → false", () => {
    const r = evaluateCondition(
      { field: "debt_amount", operator: "eq", value: "CA", valueType: "string" } as ConditionNode,
      P,
    );
    expect(r.result).toBe(false);
    expect(r.traces.at(-1)?.reason).toBe("value_type_mismatch");
  });

  it("field not valid for event → false when eventType supplied", () => {
    const r = evaluateCondition(
      { field: "debt_amount", operator: "gte", value: 1, valueType: "money" },
      P,
      { eventType: "TEAM_MILESTONE" },
    );
    expect(r.result).toBe(false);
    expect(r.traces.at(-1)?.reason).toBe("field_not_valid_for_event");
  });

  it("pathologically deep tree is bounded, not a stack overflow", () => {
    let node: ConditionNode = { field: "state", operator: "eq", value: "CA", valueType: "string" };
    for (let i = 0; i < 200; i++) node = { op: "AND", nodes: [node] };
    const r = evaluateCondition(node, P);
    expect(typeof r.result).toBe("boolean");
    expect(r.traces.some((t) => t.reason === "max_depth")).toBe(true);
  });
});

describe("condition tree — deterministic", () => {
  it("same (tree, payload) → identical result across many runs", () => {
    const tree: ConditionNode = {
      op: "OR",
      nodes: [
        { field: "debt_amount", operator: "between", value: [20000, 30000], valueType: "money" },
        {
          field: "credit_status",
          operator: "in",
          value: ["GOOD", "FAIR"],
          valueType: "stringList",
        },
      ],
    };
    const first = JSON.stringify(evaluateCondition(tree, P));
    for (let i = 0; i < 50; i++) expect(JSON.stringify(evaluateCondition(tree, P))).toBe(first);
  });
});

describe("condition tree — static structural check (Admin builder)", () => {
  it("clean tree → no issues", () => {
    expect(
      collectConditionIssues(
        { field: "debt_amount", operator: "gte", value: 1, valueType: "money" },
        "LEAD_SUBMITTED",
      ),
    ).toEqual([]);
  });
  it("flags unknown field, empty group, bad operator", () => {
    const issues = collectConditionIssues(
      {
        op: "AND",
        nodes: [
          { field: "ghost", operator: "eq", value: 1, valueType: "number" },
          { op: "OR", nodes: [] },
        ],
      } as ConditionNode,
      "LEAD_SUBMITTED",
    );
    expect(issues.some((i) => i.endsWith("unknown_field"))).toBe(true);
    expect(issues.some((i) => i.endsWith("empty_group"))).toBe(true);
  });
});
