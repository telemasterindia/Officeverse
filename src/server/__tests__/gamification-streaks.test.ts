import { describe, expect, it } from "vitest";
import {
  advanceStreak,
  daysBetween,
  effectiveCurrent,
  GAMIFICATION_STREAK_TYPES,
  type StreakState,
} from "../gamification/streaks";

const fresh: StreakState = { currentCount: 0, bestCount: 0, lastOperationalDate: null };

describe("ACCEPTED_LEAD_STREAK — consecutive operational days with an accepted lead", () => {
  it("Phase 20 ships exactly one streak type (not attendance)", () => {
    expect([...GAMIFICATION_STREAK_TYPES]).toEqual(["ACCEPTED_LEAD_STREAK"]);
  });

  it("first qualifying day starts the streak at 1", () => {
    const s = advanceStreak(fresh, "2026-03-10");
    expect(s).toMatchObject({ currentCount: 1, bestCount: 1, changed: true, broke: false });
  });

  it("the next operational day increments", () => {
    const s = advanceStreak(
      { currentCount: 3, bestCount: 3, lastOperationalDate: "2026-03-10" },
      "2026-03-11",
    );
    expect(s).toMatchObject({ currentCount: 4, bestCount: 4, changed: true, broke: false });
  });

  it("a second accepted lead the SAME operational day is idempotent (no increment)", () => {
    const s = advanceStreak(
      { currentCount: 4, bestCount: 4, lastOperationalDate: "2026-03-11" },
      "2026-03-11",
    );
    expect(s).toMatchObject({ currentCount: 4, changed: false, broke: false });
  });

  it("a missed qualifying day breaks the streak back to 1 and keeps best", () => {
    const s = advanceStreak(
      { currentCount: 6, bestCount: 6, lastOperationalDate: "2026-03-11" },
      "2026-03-13",
    );
    expect(s).toMatchObject({ currentCount: 1, bestCount: 6, changed: true, broke: true });
  });

  it("an out-of-order earlier date also resets (never trusts a stale/rogue date)", () => {
    const s = advanceStreak(
      { currentCount: 5, bestCount: 5, lastOperationalDate: "2026-03-11" },
      "2026-03-05",
    );
    expect(s).toMatchObject({ currentCount: 1, broke: true });
  });

  it("no grace period — a one-day gap is still a break", () => {
    const s = advanceStreak(
      { currentCount: 9, bestCount: 9, lastOperationalDate: "2026-03-10" },
      "2026-03-12",
    );
    expect(s.currentCount).toBe(1);
  });

  it("rejects a non-ISO operational date", () => {
    expect(() => advanceStreak(fresh, "March 10")).toThrow();
  });
});

describe("effectiveCurrent — a stale streak reads as 0 without a write", () => {
  it("still current on the same or next day", () => {
    const st: StreakState = { currentCount: 4, bestCount: 7, lastOperationalDate: "2026-03-10" };
    expect(effectiveCurrent(st, "2026-03-10")).toBe(4);
    expect(effectiveCurrent(st, "2026-03-11")).toBe(4);
  });
  it("collapses to 0 once a qualifying day is missed", () => {
    const st: StreakState = { currentCount: 4, bestCount: 7, lastOperationalDate: "2026-03-10" };
    expect(effectiveCurrent(st, "2026-03-12")).toBe(0);
  });
  it("is 0 when there is no history", () => {
    expect(effectiveCurrent(fresh, "2026-03-12")).toBe(0);
  });
});

describe("daysBetween is calendar-accurate and UTC-safe", () => {
  it("counts whole days across a month boundary", () => {
    expect(daysBetween("2026-02-27", "2026-03-01")).toBe(2);
    expect(daysBetween("2026-03-01", "2026-02-27")).toBe(-2);
  });
});

describe("US overnight — the operational date, not the calendar date, drives the streak", () => {
  it("two accepted leads on the same US shift (crossing IST midnight) do not double-count", () => {
    // The service derives operationalDate via currentShiftDate('US', ...). Here we
    // simulate: both events resolve to the SAME shift date "2026-03-10".
    const first = advanceStreak(fresh, "2026-03-10");
    const second = advanceStreak(
      {
        currentCount: first.currentCount,
        bestCount: first.bestCount,
        lastOperationalDate: first.lastOperationalDate,
      },
      "2026-03-10",
    );
    expect(second.currentCount).toBe(1);
    expect(second.changed).toBe(false);
  });
});
