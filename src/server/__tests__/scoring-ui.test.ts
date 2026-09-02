import { describe, expect, it } from "vitest";
import {
  clientValidateDraft,
  diffVersions,
  humanizeCondition,
  humanizeOutcome,
  humanizeAppliesTo,
  isGroup,
  newGroup,
  newLeaf,
  pruneConditionTree,
  type DraftLike,
  type FieldInfo,
} from "@/lib/officeverse/scoring-ui";
import type { ConditionNode } from "@/server/scoring/conditions";
import type { ScoringRuleVersionDTO } from "@/lib/officeverse/scoring-fns";

const FIELDS: FieldInfo[] = [
  { key: "debt_amount", type: "money", events: ["LEAD_SUBMITTED"] },
  { key: "state", type: "string", events: ["LEAD_SUBMITTED"] },
  { key: "qualified", type: "boolean", events: ["LEAD_ACCEPTED"] },
];
const label = (k: string) => ({ debt_amount: "Debt Amount", state: "State" })[k] ?? k;

describe("scoring-ui — condition tree helpers", () => {
  it("newLeaf / newGroup / isGroup", () => {
    expect(isGroup(newGroup("AND"))).toBe(true);
    expect(isGroup(newLeaf("state"))).toBe(false);
  });

  it("pruneConditionTree strips empty groups, collapsing to null (match-all)", () => {
    const t: ConditionNode = {
      op: "AND",
      nodes: [
        { op: "OR", nodes: [] },
        { op: "AND", nodes: [{ op: "OR", nodes: [] }] },
      ],
    };
    expect(pruneConditionTree(t)).toBeNull();
  });

  it("pruneConditionTree keeps real leaves", () => {
    const t: ConditionNode = {
      op: "AND",
      nodes: [
        { field: "debt_amount", operator: "gte", value: 20000, valueType: "money" },
        { op: "OR", nodes: [] },
      ],
    };
    expect(pruneConditionTree(t)).toEqual({
      op: "AND",
      nodes: [{ field: "debt_amount", operator: "gte", value: 20000, valueType: "money" }],
    });
  });
});

describe("scoring-ui — humanize", () => {
  it("condition tree → readable string", () => {
    const t: ConditionNode = {
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
    expect(humanizeCondition(t, label)).toBe(
      "Debt Amount ≥ $20,000 AND (State = CA OR State = NV)",
    );
    expect(humanizeCondition(null, label)).toMatch(/Always/);
  });

  it("outcomes → readable strings", () => {
    expect(humanizeOutcome({ kind: "FLAT", points: 200 })).toBe("+200 points");
    expect(humanizeOutcome({ kind: "FLAT", points: -100 })).toBe("-100 points");
    expect(
      humanizeOutcome({
        kind: "BANDS",
        on: "debt_amount",
        strategy: "HIGHEST",
        bands: [
          { min: 20000, points: 200 },
          { min: 40000, points: 500 },
        ],
      }),
    ).toBe("bands on debt_amount (HIGHEST): $20,000 → +200, $40,000 → +500");
  });

  it("applies-to → readable string", () => {
    expect(humanizeAppliesTo(null)).toBe("All applicable subjects");
    expect(humanizeAppliesTo({ roles: ["closer"], closerTenureDaysMax: 30 })).toBe(
      "roles: closer · closer tenure 0–30 days",
    );
  });
});

describe("scoring-ui — clientValidateDraft (UX only)", () => {
  const base: DraftLike = {
    name: "R",
    event: "LEAD_SUBMITTED",
    outcome: { kind: "FLAT", points: 100 },
    effectiveFrom: "2026-09-01",
    conditionTree: null,
  };
  const ctx = { enabledEvents: ["LEAD_SUBMITTED"], fields: FIELDS };

  it("clean draft → no errors", () => {
    expect(clientValidateDraft(base, ctx)).toEqual([]);
  });
  it("flags missing name / bad date / disabled event", () => {
    expect(clientValidateDraft({ ...base, name: "  " }, ctx).join()).toMatch(/name/i);
    expect(clientValidateDraft({ ...base, effectiveFrom: "2026/09/01" }, ctx).join()).toMatch(
      /date/i,
    );
    expect(
      clientValidateDraft(
        { ...base, event: "FOLLOW_UP_COMPLETED" },
        { ...ctx, enabledEvents: ["LEAD_SUBMITTED"] },
      ).join(),
    ).toMatch(/not available/i);
  });
  it("flags band order / duplicate mins", () => {
    const errs = clientValidateDraft(
      {
        ...base,
        outcome: {
          kind: "BANDS",
          on: "debt_amount",
          bands: [
            { min: 200, points: 1 },
            { min: 200, points: 2 },
          ],
        },
      },
      ctx,
    );
    expect(errs.join()).toMatch(/greater than the band above/i);
  });
  it("flags out-of-range points", () => {
    expect(
      clientValidateDraft({ ...base, outcome: { kind: "FLAT", points: 999_999 } }, ctx).join(),
    ).toMatch(/-100000 and 100000/);
  });
  it("flags an unknown field / missing operator / missing value in the condition tree", () => {
    const errs = clientValidateDraft(
      {
        ...base,
        conditionTree: {
          op: "AND",
          nodes: [
            { field: "ghost", operator: "eq", value: 1 },
            { field: "state", operator: "", value: "" },
          ],
        } as ConditionNode,
      },
      ctx,
    );
    expect(errs.join()).toMatch(/unknown field/i);
    expect(errs.join()).toMatch(/pick an operator/i);
  });
  it("allows negative flat points (penalty)", () => {
    expect(clientValidateDraft({ ...base, outcome: { kind: "FLAT", points: -100 } }, ctx)).toEqual(
      [],
    );
  });
});

describe("scoring-ui — diffVersions", () => {
  const v = (over: Partial<ScoringRuleVersionDTO>): ScoringRuleVersionDTO => ({
    id: 1,
    version: 1,
    nameSnapshot: "R",
    eventSnapshot: "LEAD_SUBMITTED",
    appliesToSnapshot: null,
    conditionTree: { field: "debt_amount", operator: "gte", value: 10000, valueType: "money" },
    outcome: { kind: "FLAT", points: 100 },
    effectiveFrom: "2026-08-01",
    effectiveUntil: null,
    createdByUserId: 1,
    createdAt: "2026-08-01 00:00:00",
    ...over,
  });

  it("reports only the fields that changed, human-readably", () => {
    const rows = diffVersions(
      v({ version: 1, outcome: { kind: "FLAT", points: 100 }, effectiveUntil: "2026-09-01" }),
      v({
        version: 2,
        outcome: { kind: "FLAT", points: 150 },
        conditionTree: { field: "debt_amount", operator: "gte", value: 20000, valueType: "money" },
        effectiveFrom: "2026-09-01",
      }),
      label,
    );
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(byLabel["Outcome"]).toMatchObject({ before: "+100 points", after: "+150 points" });
    expect(byLabel["Conditions"]).toMatchObject({
      before: "Debt Amount ≥ $10,000",
      after: "Debt Amount ≥ $20,000",
    });
    expect(byLabel["Effective From"]).toBeTruthy();
    expect(byLabel["Name"]).toBeUndefined();
  });
});
