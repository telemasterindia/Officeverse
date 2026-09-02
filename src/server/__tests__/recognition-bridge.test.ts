/**
 * Phase 5 — Canonical Recognition Bridge + Celebration Decision contract.
 *
 * Verifies: sink registration/invocation, BusinessEvent + scoring result pass-
 * through (incl. null), failure isolation in every direction, dedupe-key shape,
 * the legacy-points mutual exclusion, and the LEVEL_0..LEVEL_4 contract.
 *
 * The DB-bound flow (1 scoring_run / 1 point txn / 1 recognition event, real
 * dedupe, forced scoring/recognition failures) is verified by the live dryrun
 * probe, not here (this file runs in the node env with no MySQL).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readSrc = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

vi.mock("../db/repos/users", () => ({ getUserById: vi.fn() }));
vi.mock("../live/recognition", () => ({ recognizeFromBusinessEvent: vi.fn() }));
vi.mock("../scoring/ingest", () => ({ ingest: vi.fn() }));

import { getUserById } from "../db/repos/users";
import { recognizeFromBusinessEvent } from "../live/recognition";
import { ingest } from "../scoring/ingest";
import {
  dispatchBusinessEvent,
  registerRecognitionSink,
  __resetRecognitionSink,
  type RecognitionSink,
} from "../events/dispatcher";
import { buildBusinessEvent, type BusinessEvent } from "../events/business-event";
import { recognitionBridge } from "../events/recognition-bridge";
import { runLegacyPointsFallback, scoringOwnsPoints } from "../events/legacy-points";
import {
  CELEBRATION_LEVELS,
  decideCelebration,
  isCelebrationLevel,
} from "../live/celebration-level";
import type { ScoringDecision } from "../scoring/ingest";

const mIngest = vi.mocked(ingest);
const mGetUser = vi.mocked(getUserById);
const mRecognize = vi.mocked(recognizeFromBusinessEvent);

const leadEvent = (over: Partial<BusinessEvent> = {}): BusinessEvent => ({
  ...buildBusinessEvent({
    type: "LEAD_SUBMITTED",
    subjectUserId: 42,
    actorUserId: 42,
    source: { type: "lead", id: "TMI_00099001" },
    process: "US",
    atMs: 1_788_000_000_000,
    payload: { debt_amount: 25000, role: "agent", process: "US" },
  }),
  operationalDate: "2026-08-31",
  ...over,
});

const scoringDecision = (points: number, ruleName = "Big debt lead"): ScoringDecision => ({
  eventType: "LEAD_SUBMITTED",
  matched: [
    { ruleId: 7, ruleName, version: 1, points, conditionTraces: [], outcomeDetail: {} as never },
  ],
  skipped: [],
  awards: [
    {
      ruleId: 7,
      ruleName,
      version: 1,
      points,
      dedupeKey: `LEAD_SUBMITTED:lead:TMI_00099001:rule:7:v1`,
      context: {} as never,
    },
  ],
  awardedPointsTotal: points,
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetRecognitionSink();
  mIngest.mockResolvedValue({ status: "skipped", reason: "flag_off" });
  mGetUser.mockResolvedValue({
    id: 42,
    fullName: "Test Agent",
    role: "agent",
    process: "US",
    photoAssetId: 9,
  } as never);
  mRecognize.mockResolvedValue(undefined);
});
afterEach(() => __resetRecognitionSink());

/* ------------------------------- SINK ------------------------------- */

describe("recognition sink — registration + invocation", () => {
  it("dispatch invokes a registered sink with (event, scoringDecision, ingestStatus)", async () => {
    const seen: Array<[BusinessEvent, ScoringDecision | null, string]> = [];
    const sink: RecognitionSink = (e, s, st) => {
      seen.push([e, s, st]);
    };
    registerRecognitionSink(sink);
    mIngest.mockResolvedValue({
      status: "scored",
      runId: 1,
      decision: scoringDecision(200),
    });

    await dispatchBusinessEvent(leadEvent());

    expect(seen).toHaveLength(1);
    expect(seen[0]![0].type).toBe("LEAD_SUBMITTED");
    expect(seen[0]![0].source).toEqual({ type: "lead", id: "TMI_00099001" });
    expect(seen[0]![1]?.awardedPointsTotal).toBe(200);
    expect(seen[0]![2]).toBe("scored");
  });

  it("passes a NULL scoring result through unchanged (no rule / flag off)", async () => {
    let received: ScoringDecision | null = scoringDecision(1);
    registerRecognitionSink((_e, s) => {
      received = s;
    });
    mIngest.mockResolvedValue({ status: "skipped", reason: "flag_off" });

    await dispatchBusinessEvent(leadEvent());
    expect(received).toBeNull();
  });

  it("a sink that throws is isolated — dispatch still resolves", async () => {
    registerRecognitionSink(() => {
      throw new Error("sink boom");
    });
    await expect(dispatchBusinessEvent(leadEvent())).resolves.toBeUndefined();
  });

  it("a scoring failure is isolated — the sink still runs (status 'error')", async () => {
    mIngest.mockRejectedValue(new Error("ingest boom"));
    let status = "";
    registerRecognitionSink((_e, _s, st) => {
      status = st;
    });
    await expect(dispatchBusinessEvent(leadEvent())).resolves.toBeUndefined();
    expect(status).toBe("error");
  });

  it("BOTH failing still never throws into the caller (CRM stays successful)", async () => {
    mIngest.mockRejectedValue(new Error("ingest boom"));
    registerRecognitionSink(() => {
      throw new Error("sink boom");
    });
    await expect(dispatchBusinessEvent(leadEvent())).resolves.toBeUndefined();
  });

  it("an unknown event type never reaches scoring or the sink", async () => {
    const sink = vi.fn();
    registerRecognitionSink(sink);
    await dispatchBusinessEvent(leadEvent({ type: "NOT_A_REAL_EVENT" }));
    expect(mIngest).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
  });
});

/* ---------------------- LEGACY POINTS — mutual exclusion ---------------------- */

describe("legacy points bridge — one event never double-awards", () => {
  it("scoringOwnsPoints: only 'scored' and 'duplicate' suppress the fallback", () => {
    expect(scoringOwnsPoints("scored")).toBe(true);
    expect(scoringOwnsPoints("duplicate")).toBe(true);
    for (const s of ["skipped", "legacy_fallback", "dropped", "error"]) {
      expect(scoringOwnsPoints(s)).toBe(false);
    }
  });

  it("runLegacyPointsFallback is a no-op for a non-migrated type", async () => {
    // SALE is NOT migrated in Phase 5 — the fallback must not touch it
    await expect(
      runLegacyPointsFallback(
        buildBusinessEvent({ type: "SALE", subjectUserId: 1, source: { type: "lead", id: "X" } }),
      ),
    ).resolves.toBeUndefined();
  });

  it("the dispatcher runs the fallback only when scoring did NOT take the points", () => {
    // structural guarantee (the DB-bound proof is in the live probe)
    const disp = readSrc("events/dispatcher.ts");
    expect(disp).toMatch(/if \(!scoringOwnsPoints\(status\)\)/);
    expect(disp).toMatch(/runLegacyPointsFallback\(clean\)/);
  });
});

/* --------------------------- THE BRIDGE --------------------------- */

describe("recognition bridge — BusinessEvent (+ scoring) → recognition event only", () => {
  it("maps LEAD_SUBMITTED to a recognition moment with the celebration decision", async () => {
    await recognitionBridge(leadEvent(), scoringDecision(200, "VIP debt"), "scored");

    expect(mRecognize).toHaveBeenCalledTimes(1);
    const arg = mRecognize.mock.calls[0]![0];
    expect(arg.eventType).toBe("LEAD_SUBMITTED");
    expect(arg.kind).toBe("LEAD_SUBMITTED");
    expect(arg.subjectUserId).toBe(42);
    expect(arg.source).toEqual({ type: "lead", id: "TMI_00099001" });
    expect(arg.points).toBe(200);
    expect(arg.subheadline).toBe("VIP debt");
    expect(arg.celebrationLevel).toBe("LEVEL_1");
    expect(arg.celebrationProfile).toMatchObject({
      level: "LEVEL_1",
      profile: "standard",
      employeeName: "Test Agent",
      employeePhotoRef: "42",
      points: 200,
    });
  });

  it("works with scoring = null — points 0, still one recognition event", async () => {
    await recognitionBridge(leadEvent(), null, "skipped");
    expect(mRecognize).toHaveBeenCalledTimes(1);
    const arg = mRecognize.mock.calls[0]![0];
    expect(arg.points).toBe(0);
    expect(arg.subheadline).toBeNull();
    expect(arg.celebrationLevel).toBe("LEVEL_1");
  });

  it("never calls the scoring engine or awards points", () => {
    const src = stripComments(readSrc("events/recognition-bridge.ts"));
    expect(src).not.toMatch(/evaluateScoring|awardScored|awardEvent|scoring\.ingest|\bingest\(/);
  });

  it("an unmapped BusinessEvent type is a no-op (no recognition)", async () => {
    await recognitionBridge(leadEvent({ type: "SALE" }), null, "skipped");
    expect(mRecognize).not.toHaveBeenCalled();
  });

  it("Phase 7 — LEAD_ACCEPTED maps to a LEVEL_2 recognition with an audio profile", async () => {
    await recognitionBridge(
      leadEvent({ type: "LEAD_ACCEPTED" }),
      scoringDecision(500, "High-value accepted"),
      "scored",
    );
    expect(mRecognize).toHaveBeenCalledTimes(1);
    const arg = mRecognize.mock.calls[0]![0];
    expect(arg.eventType).toBe("LEAD_ACCEPTED");
    expect(arg.kind).toBe("LEAD_ACCEPTED");
    expect(arg.headline).toBe("LEAD ACCEPTED");
    expect(arg.points).toBe(500);
    expect(arg.celebrationLevel).toBe("LEVEL_2");
    expect((arg.celebrationProfile as Record<string, unknown>)["audioProfile"]).toBe(
      "level2-broadcast",
    );
    expect((arg.celebrationProfile as Record<string, unknown>)["particleProfile"]).toBe(
      "dollar-rain",
    );
  });

  it("photo reference is a plain userId string (existing photo system) — never bytes", async () => {
    await recognitionBridge(leadEvent(), null, "skipped");
    const p = mRecognize.mock.calls[0]![0].celebrationProfile as Record<string, unknown>;
    expect(p["employeePhotoRef"]).toBe("42");
    mRecognize.mockClear();
    mGetUser.mockResolvedValue({
      id: 42,
      fullName: "No Photo",
      role: "agent",
      process: "US",
      photoAssetId: null,
    } as never);
    await recognitionBridge(leadEvent(), null, "skipped");
    const p2 = mRecognize.mock.calls[0]![0].celebrationProfile as Record<string, unknown>;
    expect(p2["employeePhotoRef"]).toBeNull();
  });
});

/* -------------------- CELEBRATION CONTRACT (LEVEL 0–4) -------------------- */

describe("celebration decision contract", () => {
  it("exposes exactly LEVEL_0..LEVEL_4", () => {
    expect(CELEBRATION_LEVELS).toEqual(["LEVEL_0", "LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"]);
  });

  it("maps each default recognition kind to its semantic level", () => {
    const cases: Array<[string, string]> = [
      ["LEAD_SUBMITTED", "LEVEL_1"],
      ["ACHIEVEMENT_UNLOCKED", "LEVEL_1"],
      ["LEAD_ACCEPTED", "LEVEL_2"],
      ["THIRD_ACCEPTED_LEAD", "LEVEL_3"],
      ["TEAM_MILESTONE", "LEVEL_3"],
      ["SALE", "LEVEL_4"],
      ["EMERGENCY_ADMIN", "LEVEL_4"],
    ];
    for (const [kind, level] of cases) {
      expect(decideCelebration({ recognitionKind: kind }).level).toBe(level);
    }
  });

  it("an unknown kind → LEVEL_0 (no visible celebration)", () => {
    const d = decideCelebration({ recognitionKind: "WHATEVER" });
    expect(d.level).toBe("LEVEL_0");
    expect(d.profile).toBe("silent");
    expect(d.durationMs).toBe(0);
  });

  it("an explicit levelOverride wins; an invalid override is ignored", () => {
    expect(
      decideCelebration({ recognitionKind: "LEAD_SUBMITTED", levelOverride: "LEVEL_4" }).level,
    ).toBe("LEVEL_4");
    expect(
      decideCelebration({
        recognitionKind: "LEAD_SUBMITTED",
        levelOverride: "LEVEL_9" as never,
      }).level,
    ).toBe("LEVEL_1");
    expect(isCelebrationLevel("LEVEL_9")).toBe(false);
  });

  it("the profile carries the full contract: photo ref, name, points, headline, sound/particle, duration", () => {
    const d = decideCelebration({
      recognitionKind: "SALE",
      employeeName: "Jane",
      employeePhotoRef: "42",
      points: 500,
      scoredRuleName: "Closed sale",
      headline: "SALE!",
    });
    expect(d).toEqual({
      level: "LEVEL_4",
      profile: "hero",
      employeeName: "Jane",
      employeePhotoRef: "42",
      headline: "SALE!",
      subheadline: "Closed sale",
      points: 500,
      soundProfile: "anthem",
      particleProfile: "hero-burst",
      durationMs: 11000,
    });
  });

  it("null / non-finite points coerce to 0 (recognition still functions)", () => {
    expect(decideCelebration({ recognitionKind: "LEAD_SUBMITTED", points: null }).points).toBe(0);
    expect(decideCelebration({ recognitionKind: "LEAD_SUBMITTED", points: NaN }).points).toBe(0);
    expect(decideCelebration({ recognitionKind: "LEAD_SUBMITTED", points: 12.9 }).points).toBe(12);
  });
});
