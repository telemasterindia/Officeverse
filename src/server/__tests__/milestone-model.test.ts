/**
 * Phase 10 Stage 4 — MILESTONE model. PURE.
 *
 * Every threshold / name / period / policy is configuration — the model just
 * normalises + validates it. No hard-coded business values.
 */
import { describe, expect, it } from "vitest";
import {
  isEvaluableType,
  isPointsType,
  isTeamType,
  normalizeMilestoneDraft,
  validateMilestoneDraft,
  type MilestoneDraft,
} from "../milestones/milestone-model";

const draft = (o: Partial<MilestoneDraft> = {}): MilestoneDraft => ({
  name: o.name ?? "10 Lead Acceptances",
  type: o.type ?? "INDIVIDUAL_COUNT",
  metric: "metric" in o ? o.metric : "LEAD_ACCEPTED",
  threshold: o.threshold ?? 10,
  effectiveFrom: o.effectiveFrom ?? "2026-09-01",
  ...(o.period ? { period: o.period } : {}),
  ...(o.triggerPolicy ? { triggerPolicy: o.triggerPolicy } : {}),
  ...(o.description !== undefined ? { description: o.description } : {}),
  ...(o.scope !== undefined ? { scope: o.scope } : {}),
  ...(o.priority !== undefined ? { priority: o.priority } : {}),
  ...(o.recognitionLevel ? { recognitionLevel: o.recognitionLevel } : {}),
  ...(o.effectiveUntil !== undefined ? { effectiveUntil: o.effectiveUntil } : {}),
});

describe("normalizeMilestoneDraft — total, defaults, never throws", () => {
  it("applies safe defaults (ALL_TIME period, ONCE policy, LEVEL_2)", () => {
    const n = normalizeMilestoneDraft(draft());
    expect(n.period).toBe("ALL_TIME");
    expect(n.triggerPolicy).toBe("ONCE");
    expect(n.recognitionLevel).toBe("LEVEL_2");
    expect(n.priority).toBe(100);
  });
  it("a POINTS milestone clears the metric (it sums the ledger)", () => {
    expect(
      normalizeMilestoneDraft(draft({ type: "INDIVIDUAL_POINTS", metric: "LEAD_ACCEPTED" })).metric,
    ).toBeNull();
  });
  it("strips control chars + markup from the name / description (no injection)", () => {
    const n = normalizeMilestoneDraft(
      draft({ name: "<b>Hack</b> & win", description: "line" + String.fromCharCode(7) + "two" }),
    );
    expect(n.name).not.toMatch(/[<>&]/);
    expect(n.name).toContain("Hack");
    expect(n.description).not.toContain(String.fromCharCode(7));
  });
  it("keeps only valid process codes in scope; empty → null", () => {
    expect(
      normalizeMilestoneDraft(draft({ scope: { processes: ["US", "bad!", "UK"] } })).scope,
    ).toEqual({
      processes: ["US", "UK"],
    });
    expect(normalizeMilestoneDraft(draft({ scope: { processes: [] } })).scope).toBeNull();
  });
  it("unknown enums fall back safely", () => {
    const n = normalizeMilestoneDraft(
      draft({
        type: "MADE_UP" as never,
        period: "YEARLY" as never,
        triggerPolicy: "SPAM" as never,
      }),
    );
    expect(n.type).toBe("INDIVIDUAL_COUNT");
    expect(n.period).toBe("ALL_TIME");
    expect(n.triggerPolicy).toBe("ONCE");
  });
});

describe("validateMilestoneDraft", () => {
  it("accepts a well-formed individual count milestone", () => {
    expect(validateMilestoneDraft(draft())).toEqual([]);
  });
  it("accepts a team points milestone with no metric", () => {
    expect(
      validateMilestoneDraft(draft({ type: "TEAM_POINTS", metric: null, threshold: 10000 })),
    ).toEqual([]);
  });
  it("rejects a non-positive / absurd threshold", () => {
    expect(validateMilestoneDraft(draft({ threshold: 0 }))).toContain("threshold_invalid");
    expect(validateMilestoneDraft(draft({ threshold: -5 }))).toContain("threshold_invalid");
    expect(validateMilestoneDraft(draft({ threshold: 999_999_999 }))).toContain(
      "threshold_invalid",
    );
  });
  it("requires a well-formed metric for COUNT / EVENT types", () => {
    expect(validateMilestoneDraft(draft({ metric: null }))).toContain("metric_required");
    expect(validateMilestoneDraft(draft({ metric: "lead accepted;" }))).toContain(
      "metric_malformed",
    );
  });
  it("flags a bad type / trigger policy / effective dates", () => {
    expect(validateMilestoneDraft(draft({ type: "X" as never }))).toContain("type_invalid");
    expect(validateMilestoneDraft(draft({ triggerPolicy: "X" as never }))).toContain(
      "trigger_policy_invalid",
    );
    expect(validateMilestoneDraft(draft({ effectiveFrom: "01/09/2026" }))).toContain(
      "effective_from_invalid",
    );
    expect(
      validateMilestoneDraft(draft({ effectiveFrom: "2026-09-10", effectiveUntil: "2026-09-01" })),
    ).toContain("effective_until_before_from");
  });
});

describe("type helpers", () => {
  it("classifies team / points / evaluable types", () => {
    expect(isTeamType("TEAM_COUNT")).toBe(true);
    expect(isTeamType("INDIVIDUAL_COUNT")).toBe(false);
    expect(isPointsType("TEAM_POINTS")).toBe(true);
    expect(isPointsType("TEAM_COUNT")).toBe(false);
    expect(isEvaluableType("INDIVIDUAL_EVENT")).toBe(true);
    expect(isEvaluableType("SALES_TARGET")).toBe(false); // reserved — never evaluated
  });
});
