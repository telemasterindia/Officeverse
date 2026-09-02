/**
 * Phase 9 — INCENTIVE ENGINE authorization + validation + versioning.
 *
 *   create / edit / enable-disable / dry-run / calculate / review  → Admin + Closer
 *   approve / finalize / reverse                                    → Admin ONLY
 *   an Agent sees ONLY their own incentive results
 *   HR keeps its EXISTING gamification read — it is NOT given Operations control
 *
 * No DB in this test env → every service gates the role FIRST, then reports
 * `dbUnavailable` / throws 503. A denied role therefore always throws 403 first.
 */
import { describe, expect, it } from "vitest";
import { HttpError } from "../http-error";
import {
  approveIncentiveResult,
  calculateIncentives,
  createIncentiveScheme,
  dryRunIncentive,
  finalizeIncentiveResult,
  listIncentiveResults,
  listIncentiveSchemes,
  myIncentive,
  reverseIncentiveResult,
  reviewIncentiveResult,
  setIncentiveSchemeEnabled,
  updateIncentiveScheme,
  validateSchemeDraft,
  type SchemeDraft,
} from "../incentive/service";
import { selectVersionForDate } from "../scoring/versions";

const U = (id: number, role: "admin" | "agent" | "closer" | "hr") => ({
  id,
  role,
  process: "IN" as const,
});
const admin = U(1, "admin");
const closer = U(2, "closer");
const agent = U(3, "agent");
const hr = U(4, "hr");

async function code(p: Promise<unknown>): Promise<number | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
}

const draft: SchemeDraft = {
  name: "September High Performer",
  periodType: "monthly",
  priority: 100,
  combineMode: "independent",
  eligibility: { op: "AND", nodes: [{ metric: "points", operator: "gte", value: 7500 }] },
  reward: {
    kind: "TIERED",
    tiers: [
      { min: 5000, amount: 2500 },
      { min: 7500, amount: 5000 },
    ],
  },
  effectiveFrom: "2026-09-01",
};

describe("scheme management — Admin + Closer only", () => {
  const calls = (u: ReturnType<typeof U>) => [
    listIncentiveSchemes(u),
    createIncentiveScheme(u, draft),
    updateIncentiveScheme(u, 1, { ...draft, effectiveFrom: "2026-10-01" }),
    setIncentiveSchemeEnabled(u, 1, true),
  ];

  it("Admin and Closer pass the role gate (then hit dbUnavailable, never 403)", async () => {
    for (const u of [admin, closer]) for (const c of calls(u)) expect(await code(c)).not.toBe(403);
  });
  it("Agent and HR are denied every scheme-management call (403)", async () => {
    for (const u of [agent, hr]) for (const c of calls(u)) expect(await code(c)).toBe(403);
  });
});

describe("dry-run + calculate — Admin + Closer only", () => {
  const dry = (u: ReturnType<typeof U>) =>
    dryRunIncentive(u, { schemeId: 1, userId: 9, period: "monthly" });
  const calc = (u: ReturnType<typeof U>) =>
    calculateIncentives(u, { schemeId: 1, period: "monthly" });

  it("Admin + Closer may dry-run and calculate", async () => {
    for (const u of [admin, closer]) {
      expect(await code(dry(u))).not.toBe(403);
      expect(await code(calc(u))).not.toBe(403);
    }
  });
  it("Agent + HR may not dry-run or calculate (403)", async () => {
    for (const u of [agent, hr]) {
      expect(await code(dry(u))).toBe(403);
      expect(await code(calc(u))).toBe(403);
    }
  });
});

describe("result lifecycle — review = Ops, approve/finalize/reverse = Admin only", () => {
  it("Closer may REVIEW (Ops) but NOT approve / finalize / reverse", async () => {
    expect(await code(reviewIncentiveResult(closer, 1))).not.toBe(403);
    expect(await code(approveIncentiveResult(closer, 1))).toBe(403);
    expect(await code(finalizeIncentiveResult(closer, 1))).toBe(403);
    expect(await code(reverseIncentiveResult(closer, 1))).toBe(403);
  });
  it("Admin may drive every transition", async () => {
    for (const c of [
      reviewIncentiveResult(admin, 1),
      approveIncentiveResult(admin, 1),
      finalizeIncentiveResult(admin, 1),
      reverseIncentiveResult(admin, 1),
    ])
      expect(await code(c)).not.toBe(403);
  });
  it("Agent + HR may not transition a result at all (403)", async () => {
    for (const u of [agent, hr]) {
      expect(await code(reviewIncentiveResult(u, 1))).toBe(403);
      expect(await code(approveIncentiveResult(u, 1))).toBe(403);
      expect(await code(finalizeIncentiveResult(u, 1))).toBe(403);
    }
  });
});

describe("reading results — Agent self-only, Ops full, HR unchanged", () => {
  it("Admin + Closer + HR get the full view (selfOnly = false)", async () => {
    for (const u of [admin, closer, hr]) {
      const r = await listIncentiveResults(u, {});
      expect(r.selfOnly).toBe(false);
    }
  });
  it("an Agent is forced to their own results (selfOnly = true)", async () => {
    const r = await listIncentiveResults(agent, { userId: 999 });
    expect(r.selfOnly).toBe(true);
  });
  it("myIncentive is a self view — never throws 403 for an agent", async () => {
    expect(await code(myIncentive(agent, { period: "monthly" }))).not.toBe(403);
  });
});

describe("validateSchemeDraft — scheme validation", () => {
  it("accepts a well-formed draft", () => {
    expect(validateSchemeDraft(draft)).toEqual([]);
  });
  it("flags a blank name", () => {
    expect(validateSchemeDraft({ ...draft, name: "  " })).toContain("name_invalid");
  });
  it("flags a bad period type", () => {
    expect(validateSchemeDraft({ ...draft, periodType: "yearly" as never })).toContain(
      "period_type_invalid",
    );
  });
  it("flags a non-YMD effectiveFrom", () => {
    expect(validateSchemeDraft({ ...draft, effectiveFrom: "01/09/2026" })).toContain(
      "effective_from_invalid",
    );
  });
  it("flags an out-of-range priority and a bad combine mode", () => {
    expect(validateSchemeDraft({ ...draft, priority: -5 })).toContain("priority_out_of_range");
    expect(validateSchemeDraft({ ...draft, combineMode: "stack" as never })).toContain(
      "combine_mode_invalid",
    );
  });
  it("bubbles eligibility + reward errors with a prefix", () => {
    const errs = validateSchemeDraft({
      ...draft,
      eligibility: { metric: "points", operator: "≥", value: 1 } as never,
      reward: { kind: "TIERED", tiers: [] },
    });
    expect(errs.some((e) => e.startsWith("eligibility:"))).toBe(true);
    expect(errs).toContain("reward:tiered_no_tiers");
  });
});

describe("effective-date versioning — historical results keep their version", () => {
  // schemes are versioned exactly like scoring rules: half-open windows, higher version wins
  const versions = [
    { version: 1, effectiveFrom: "2026-09-01", effectiveUntil: "2026-10-01" },
    { version: 2, effectiveFrom: "2026-10-01", effectiveUntil: null },
  ];
  it("a September period start selects v1; an October start selects v2", () => {
    expect(selectVersionForDate(versions, "2026-09-15")?.version).toBe(1);
    expect(selectVersionForDate(versions, "2026-09-30")?.version).toBe(1);
    expect(selectVersionForDate(versions, "2026-10-01")?.version).toBe(2);
    expect(selectVersionForDate(versions, "2026-11-20")?.version).toBe(2);
  });
  it("before any version → none", () => {
    expect(selectVersionForDate(versions, "2026-08-31")).toBeUndefined();
  });
});
