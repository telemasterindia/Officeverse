import { describe, expect, it } from "vitest";
import { dryRun } from "../scoring/dry-run";
import { normalizeBusinessEvent, type BusinessEvent } from "../events/business-event";
import { evaluateScoring, type EvaluableRule } from "../scoring/ingest";

function evt(payload: Record<string, string | number | boolean | null>): BusinessEvent {
  const n = normalizeBusinessEvent({
    type: "LEAD_SUBMITTED",
    occurredAtMs: 1_788_000_000_000,
    operationalDate: "2026-08-31",
    subjectUserId: 5,
    actorUserId: 5,
    source: { type: "lead", id: "DR-1" },
    payload,
  });
  if (!n.ok) throw new Error(n.reason);
  return n.event;
}

const hypotheticalRule: EvaluableRule = {
  ruleId: 1,
  ruleName: "Debt >= 20,000 → 200",
  event: "LEAD_SUBMITTED",
  priority: 100,
  ruleMatchingMode: "FIRST_MATCH",
  appliesTo: null,
  version: 1,
  conditionTree: { field: "debt_amount", operator: "gte", value: 20000, valueType: "money" },
  outcome: { kind: "FLAT", points: 200 },
};

describe("scoring dry run — same evaluator, zero side effects", () => {
  it("evaluates a supplied hypothetical rule set without any DB", async () => {
    const r = await dryRun(evt({ debt_amount: 23000, state: "CA" }), [hypotheticalRule]);
    expect(r.ok).toBe(true);
    expect(r.ruleSource).toBe("supplied");
    expect(r.decision?.awardedPointsTotal).toBe(200);
  });

  it("returns per-node condition results + failure reasons", async () => {
    const r = await dryRun(evt({ debt_amount: 100 }), [hypotheticalRule]);
    expect(r.decision?.awards).toEqual([]);
    expect(r.decision?.skipped[0]?.conditionTraces?.some((t) => t.reason === "not_gte")).toBe(true);
  });

  it("produces the exact same decision as the live evaluator", async () => {
    const e = evt({ debt_amount: 50000, state: "CA" });
    const viaDry = await dryRun(e, [hypotheticalRule]);
    const viaLive = evaluateScoring(e, [hypotheticalRule]);
    expect(JSON.stringify(viaDry.decision)).toBe(JSON.stringify(viaLive));
  });

  it("is side-effect free — repeated runs never diverge", async () => {
    const e = evt({ debt_amount: 33333 });
    const first = JSON.stringify((await dryRun(e, [hypotheticalRule])).decision);
    for (let i = 0; i < 20; i++) {
      expect(JSON.stringify((await dryRun(e, [hypotheticalRule])).decision)).toBe(first);
    }
  });

  it("the dry-run source file never imports a ledger / run writer", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "..", "scoring", "dry-run.ts"), "utf8");
    expect(src).not.toMatch(/insertRun|awardScored|insertPointTransaction/);
  });

  it("rejects an unknown event type cleanly", async () => {
    const bad = { ...evt({ debt_amount: 1 }), type: "NOPE" } as BusinessEvent;
    const r = await dryRun(bad, [hypotheticalRule]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unknown_event_type");
  });
});
