import { afterEach, describe, expect, it } from "vitest";
import { isScoringEngineEnabled, SCORING_ENGINE_FLAG } from "../scoring/flags";
import { ingest } from "../scoring/ingest";
import { normalizeBusinessEvent, type BusinessEvent } from "../events/business-event";

const original = process.env[SCORING_ENGINE_FLAG];
afterEach(() => {
  if (original === undefined) delete process.env[SCORING_ENGINE_FLAG];
  else process.env[SCORING_ENGINE_FLAG] = original;
});

function evt(): BusinessEvent {
  const n = normalizeBusinessEvent({
    type: "LEAD_SUBMITTED",
    occurredAtMs: 1_788_000_000_000,
    operationalDate: "2026-08-31",
    subjectUserId: 1,
    actorUserId: 1,
    source: { type: "lead", id: "FLAG-1" },
    payload: { debt_amount: 25000 },
  });
  if (!n.ok) throw new Error(n.reason);
  return n.event;
}

describe("scoring flag — default OFF, opt-in only", () => {
  it("unset → OFF", () => {
    delete process.env[SCORING_ENGINE_FLAG];
    expect(isScoringEngineEnabled()).toBe(false);
  });
  it("'false' / '0' / 'no' → OFF", () => {
    for (const v of ["false", "0", "no", "", "off"]) {
      process.env[SCORING_ENGINE_FLAG] = v;
      expect(isScoringEngineEnabled()).toBe(false);
    }
  });
  it("'true' / '1' / 'yes' / 'on' → ON", () => {
    for (const v of ["true", "1", "yes", "on", "ENABLED"]) {
      process.env[SCORING_ENGINE_FLAG] = v;
      expect(isScoringEngineEnabled()).toBe(true);
    }
  });
});

describe("scoring flag — ingest is inert while OFF", () => {
  it("ingest short-circuits with reason 'flag_off' and touches nothing", async () => {
    delete process.env[SCORING_ENGINE_FLAG];
    const out = await ingest(evt());
    expect(out).toEqual({ status: "skipped", reason: "flag_off" });
  });

  it("a disabled future event type is skipped before the flag even matters", async () => {
    process.env[SCORING_ENGINE_FLAG] = "true";
    const n = normalizeBusinessEvent({
      type: "FOLLOW_UP_COMPLETED",
      occurredAtMs: 1_788_000_000_000,
      operationalDate: "2026-08-31",
      subjectUserId: 1,
      actorUserId: 1,
      source: { type: "follow_up", id: "FU-1" },
      payload: {},
    });
    expect(n.ok).toBe(true);
    if (n.ok) {
      const out = await ingest(n.event);
      expect(out).toEqual({ status: "skipped", reason: "event_not_enabled_for_scoring" });
    }
  });
});
