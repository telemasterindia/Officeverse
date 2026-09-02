import { describe, expect, it } from "vitest";
import {
  buildBusinessEvent,
  normalizeBusinessEvent,
  type BusinessEvent,
} from "../events/business-event";

const base = (over: Partial<BusinessEvent> = {}): unknown => ({
  type: "LEAD_SUBMITTED",
  occurredAtMs: 1_788_000_000_000,
  operationalDate: "2026-08-31",
  subjectUserId: 42,
  actorUserId: 42,
  source: { type: "lead", id: "TEST-001" },
  payload: { debt_amount: 23000, state: "CA" },
  ...over,
});

describe("BusinessEvent — envelope validation", () => {
  it("accepts a well-formed event and keeps whitelisted payload keys", () => {
    const r = normalizeBusinessEvent(base());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.event.payload).toEqual({ debt_amount: 23000, state: "CA" });
      expect(r.droppedKeys).toEqual([]);
    }
  });

  it("rejects a malformed envelope (bad operationalDate)", () => {
    const r = normalizeBusinessEvent(base({ operationalDate: "31-08-2026" }));
    expect(r.ok).toBe(false);
  });

  it("drops an unknown event type (never scored)", () => {
    const r = normalizeBusinessEvent(base({ type: "SOMETHING_ELSE" }));
    expect(r).toEqual({ ok: false, reason: "unknown_event_type" });
  });

  it("strips a payload key the field registry does not allow for this event", () => {
    const r = normalizeBusinessEvent(
      base({ payload: { debt_amount: 100, disposition: "x", bogus: 1 } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.event.payload)).toEqual(["debt_amount"]);
      expect(r.droppedKeys.sort()).toEqual(["bogus", "disposition"]);
    }
  });

  it("coerces a wrong-typed value to null and records it", () => {
    const r = normalizeBusinessEvent(
      base({ payload: { debt_amount: "not-a-number", state: "CA" } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.event.payload["debt_amount"]).toBeNull();
      expect(r.nulledKeys).toEqual(["debt_amount"]);
      expect(r.event.payload["state"]).toBe("CA");
    }
  });

  it("coerces a numeric string debt amount to a number", () => {
    const r = normalizeBusinessEvent(base({ payload: { debt_amount: "19999.99" } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.payload["debt_amount"]).toBe(19999.99);
  });

  it("a client cannot smuggle a point amount / rank / sale flag — not whitelisted", () => {
    const r = normalizeBusinessEvent(base({ payload: { points: 9999, rank: 1, isSale: true } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.payload).toEqual({});
  });
});

describe("BusinessEvent — server-controlled timestamps", () => {
  it("buildBusinessEvent stamps occurredAtMs + operationalDate from the server", () => {
    const evt = buildBusinessEvent({
      type: "SALE",
      subjectUserId: 7,
      source: { type: "lead", id: "L1" },
      process: "US",
      atMs: 1_788_000_000_000,
    });
    expect(evt.occurredAtMs).toBe(1_788_000_000_000);
    expect(evt.operationalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(evt.actorUserId).toBeNull();
  });

  it("defaults atMs to now when not supplied", () => {
    const before = Date.now();
    const evt = buildBusinessEvent({
      type: "SALE",
      subjectUserId: 1,
      source: { type: "lead", id: "L" },
    });
    expect(evt.occurredAtMs).toBeGreaterThanOrEqual(before);
  });
});
