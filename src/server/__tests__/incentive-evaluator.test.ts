/**
 * Phase 9 — INCENTIVE ENGINE evaluator. PURE. The SAME function backs dry-run
 * and live calculation. It never scores, never re-computes points.
 */
import { describe, expect, it } from "vitest";
import {
  combineResults,
  evaluateScheme,
  type CombinableResult,
  type EmployeeSnapshotRow,
  type SchemeVersionConfig,
} from "../incentive/evaluator";

const emp = (o: Partial<EmployeeSnapshotRow> = {}): EmployeeSnapshotRow => ({
  userId: o.userId ?? 7,
  name: o.name ?? "Amit",
  role: o.role ?? "agent",
  process: o.process ?? "IN",
  team: o.team ?? null,
  points: o.points ?? 8250,
  metrics: o.metrics ?? {
    leadsSubmitted: 40,
    leadsAccepted: 28,
    followUps: 3,
    sales: 6,
    scoredLeads: 22,
  },
  ruleBreakdown: o.ruleBreakdown ?? [],
});

const scheme = (o: Partial<SchemeVersionConfig> = {}): SchemeVersionConfig => ({
  schemeId: o.schemeId ?? 1,
  version: o.version ?? 1,
  name: o.name ?? "September High Performer",
  scope: o.scope ?? null,
  eligibility:
    "eligibility" in o
      ? (o.eligibility ?? null)
      : { op: "AND", nodes: [{ metric: "points", operator: "gte", value: 7500 }] },
  reward:
    o.reward ??
    ({
      kind: "TIERED",
      tiers: [
        { min: 5000, amount: 2500 },
        { min: 7500, amount: 5000 },
        { min: 10000, amount: 10000 },
      ],
    } as unknown),
  currency: o.currency ?? "INR",
});

describe("evaluateScheme — one scheme, one employee", () => {
  it("ELIGIBLE → tier reward + full explanation", () => {
    const r = evaluateScheme(scheme(), emp());
    expect(r.eligibility).toBe("ELIGIBLE");
    expect(r.rewardKind).toBe("TIERED");
    expect(r.rewardAmount).toBe(5000);
    expect(r.explanation.checks).toHaveLength(1);
    expect(r.explanation.checks[0]).toMatchObject({
      metric: "points",
      value: 7500,
      actual: 8250,
      pass: true,
    });
    expect(r.explanation.reward.tier).toMatchObject({ min: 7500, amount: 5000 });
    expect(r.explanation.reason).toMatch(/tier/i);
  });

  it("NOT_ELIGIBLE → reward 0, failing condition named", () => {
    const r = evaluateScheme(scheme(), emp({ points: 3100 }));
    expect(r.eligibility).toBe("NOT_ELIGIBLE");
    expect(r.rewardAmount).toBe(0);
    expect(r.explanation.reason).toMatch(/points gte 7500 \(was 3100\)/);
  });

  it("OUT_OF_SCOPE → reward 0, scope reason", () => {
    const r = evaluateScheme(scheme({ scope: { processes: ["US"] } }), emp({ process: "IN" }));
    expect(r.eligibility).toBe("OUT_OF_SCOPE");
    expect(r.rewardAmount).toBe(0);
    expect(r.explanation.reason).toMatch(/scope/i);
  });

  it("scope by explicit userIds", () => {
    expect(
      evaluateScheme(scheme({ scope: { userIds: [7] } }), emp({ userId: 7 })).eligibility,
    ).toBe("ELIGIBLE");
    expect(
      evaluateScheme(scheme({ scope: { userIds: [999] } }), emp({ userId: 7 })).eligibility,
    ).toBe("OUT_OF_SCOPE");
  });

  it("no eligibility tree → eligible in scope (still explains the reward)", () => {
    const r = evaluateScheme(
      scheme({ eligibility: null, reward: { kind: "FIXED", amount: 1000 } }),
      emp({ points: 0 }),
    );
    expect(r.eligibility).toBe("ELIGIBLE");
    expect(r.rewardAmount).toBe(1000);
  });

  it("is deterministic — same inputs → identical result", () => {
    const a = evaluateScheme(scheme(), emp());
    for (let i = 0; i < 10; i++) expect(evaluateScheme(scheme(), emp())).toEqual(a);
  });
});

describe("combineResults — multiple schemes for one employee", () => {
  const mk = (
    schemeId: number,
    combineMode: "independent" | "exclusive" | "highest",
    priority: number,
    amount: number,
    eligibility: "ELIGIBLE" | "NOT_ELIGIBLE" = "ELIGIBLE",
  ): CombinableResult => ({
    combineMode,
    priority,
    evaluation: {
      schemeId,
      schemeVersion: 1,
      userId: 7,
      eligibility,
      rewardKind: "FIXED",
      rewardAmount: eligibility === "ELIGIBLE" ? amount : 0,
      rewardLabel: null,
      currency: "INR",
      points: 8250,
      explanation: {
        scheme: `S${schemeId}`,
        schemeId,
        schemeVersion: 1,
        eligibility,
        points: 8250,
        checks: [],
        reward: { kind: "FIXED", amount, label: null, tier: null, calc: "" },
        reason: "",
      },
    },
  });

  it("independent → every eligible scheme pays its own amount (no double-suppress)", () => {
    const out = combineResults([mk(1, "independent", 10, 2500), mk(2, "independent", 20, 1000)]);
    expect(out.every((o) => !o.superseded)).toBe(true);
    expect(out.reduce((a, o) => a + o.rewardAmount, 0)).toBe(3500);
  });

  it("exclusive → only the winner pays; losers → superseded, reward 0 (never double-pay)", () => {
    const out = combineResults([
      mk(1, "exclusive", 20, 5000),
      mk(2, "exclusive", 10, 1000), // lower priority number → wins the tie-break
      mk(3, "exclusive", 30, 9000),
    ]);
    const byId = new Map(out.map((o) => [o.schemeId, o]));
    expect(byId.get(2)!.superseded).toBe(false);
    expect(byId.get(2)!.rewardAmount).toBe(1000);
    expect(byId.get(1)!.superseded).toBe(true);
    expect(byId.get(1)!.rewardAmount).toBe(0);
    expect(byId.get(1)!.supersededBy).toBe(2);
    expect(byId.get(3)!.rewardAmount).toBe(0);
  });

  it("highest → the max-reward eligible scheme pays; the rest → 0", () => {
    const out = combineResults([
      mk(1, "highest", 10, 2500),
      mk(2, "highest", 20, 9000),
      mk(3, "highest", 30, 4000),
    ]);
    const byId = new Map(out.map((o) => [o.schemeId, o]));
    expect(byId.get(2)!.rewardAmount).toBe(9000);
    expect(byId.get(1)!.rewardAmount).toBe(0);
    expect(byId.get(3)!.rewardAmount).toBe(0);
  });

  it("independent + exclusive mix — independent still pays alongside the exclusive winner", () => {
    const out = combineResults([
      mk(1, "exclusive", 10, 5000),
      mk(2, "exclusive", 20, 3000),
      mk(3, "independent", 5, 1000),
    ]);
    const byId = new Map(out.map((o) => [o.schemeId, o]));
    expect(byId.get(1)!.rewardAmount).toBe(5000); // exclusive winner
    expect(byId.get(2)!.rewardAmount).toBe(0); // exclusive loser
    expect(byId.get(3)!.rewardAmount).toBe(1000); // independent — unaffected
  });

  it("output is sorted priority ASC then schemeId ASC — deterministic between runs", () => {
    const items = [
      mk(9, "independent", 30, 1),
      mk(3, "independent", 10, 1),
      mk(5, "independent", 10, 1),
    ];
    const a = combineResults(items).map((o) => o.schemeId);
    const b = combineResults([...items].reverse()).map((o) => o.schemeId);
    expect(a).toEqual([3, 5, 9]);
    expect(a).toEqual(b);
  });

  it("a NOT_ELIGIBLE exclusive scheme never becomes the winner", () => {
    const out = combineResults([
      mk(1, "exclusive", 10, 9000, "NOT_ELIGIBLE"),
      mk(2, "exclusive", 20, 2000),
    ]);
    const byId = new Map(out.map((o) => [o.schemeId, o]));
    expect(byId.get(2)!.rewardAmount).toBe(2000);
    expect(byId.get(1)!.rewardAmount).toBe(0);
  });
});
