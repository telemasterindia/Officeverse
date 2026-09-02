/**
 * Phase 8 — performance PERIOD resolution. PURE, deterministic, operational-date
 * only (never a browser clock).
 */
import { describe, expect, it } from "vitest";
import { customWindow, windowBounds } from "../gamification/leaderboard";
import { resolvePerformancePeriod } from "../gamification/performance";

describe("customWindow — explicit inclusive operational-date range", () => {
  it("accepts a valid YYYY-MM-DD range", () => {
    expect(customWindow("2026-08-01", "2026-08-31")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(customWindow("2026-08-15", "2026-08-15")).toEqual({
      from: "2026-08-15",
      to: "2026-08-15",
    });
  });
  it("rejects malformed dates and reversed ranges", () => {
    expect(() => customWindow("8/1/2026", "2026-08-31")).toThrow();
    expect(() => customWindow("2026-08-01", "")).toThrow();
    expect(() => customWindow("2026-08-31", "2026-08-01")).toThrow(/from/i);
  });
});

describe("resolvePerformancePeriod — maps to operational-date windows", () => {
  const anchor = "2026-03-10"; // a Tuesday

  it("today → the single anchor operational date", () => {
    expect(resolvePerformancePeriod(anchor, { period: "today" })).toEqual({
      period: "today",
      from: anchor,
      to: anchor,
      anchor,
    });
  });
  it("week → Mon..Sun ISO week of the anchor (same as windowBounds('weekly'))", () => {
    const w = windowBounds("weekly", anchor);
    const r = resolvePerformancePeriod(anchor, { period: "week" });
    expect({ from: r.from, to: r.to }).toEqual(w);
    expect(r.from).toBe("2026-03-09");
    expect(r.to).toBe("2026-03-15");
  });
  it("month → the calendar month of the anchor", () => {
    const r = resolvePerformancePeriod(anchor, { period: "month" });
    expect({ from: r.from, to: r.to }).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });
  it("custom → the explicit from..to", () => {
    const r = resolvePerformancePeriod(anchor, {
      period: "custom",
      from: "2026-01-05",
      to: "2026-02-06",
    });
    expect({ from: r.from, to: r.to }).toEqual({ from: "2026-01-05", to: "2026-02-06" });
  });
  it("custom without both bounds → HttpError(400)", () => {
    expect(() =>
      resolvePerformancePeriod(anchor, { period: "custom", from: "2026-01-05" }),
    ).toThrow(/custom period/i);
    expect(() => resolvePerformancePeriod(anchor, { period: "custom" })).toThrow();
  });
  it("an unknown / missing period → 'today' (deterministic default)", () => {
    expect(resolvePerformancePeriod(anchor, {}).period).toBe("today");
    expect(resolvePerformancePeriod(anchor, { period: "nope" }).period).toBe("today");
  });
  it("is deterministic — same anchor + input → same window every call", () => {
    const a = resolvePerformancePeriod(anchor, { period: "week" });
    for (let i = 0; i < 20; i++) {
      expect(resolvePerformancePeriod(anchor, { period: "week" })).toEqual(a);
    }
  });
});
