import { describe, expect, it } from "vitest";
import {
  dayOfWeek,
  expandSandwich,
  holidayAwareProvider,
  isWeekend,
  weekendProvider,
} from "../hr/non-working";

// 2026-01-01 is a Thursday → 01-02 Fri, 01-03 Sat, 01-04 Sun, 01-05 Mon, 01-06 Tue
const FRI = "2026-01-02";
const SAT = "2026-01-03";
const SUN = "2026-01-04";
const MON = "2026-01-05";
const TUE = "2026-01-06";

describe("calendar helpers", () => {
  it("day of week + weekend detection", () => {
    expect(dayOfWeek(FRI)).toBe(5);
    expect(dayOfWeek(SAT)).toBe(6);
    expect(dayOfWeek(SUN)).toBe(0);
    expect(isWeekend(SAT)).toBe(true);
    expect(isWeekend(SUN)).toBe(true);
    expect(isWeekend(FRI)).toBe(false);
  });
});

const sw = (dates: string[]) => expandSandwich(dates, weekendProvider).sandwich.map((s) => s.date);

describe("weekend sandwich (frozen examples)", () => {
  it("#1  Fri LEAVE + Sat + Sun + Mon present → Sat, Sun count", () => {
    expect(sw([FRI])).toEqual([SAT, SUN]);
  });
  it("#2  Fri present + Sat + Sun + Mon LEAVE → Sat, Sun count", () => {
    expect(sw([MON])).toEqual([SAT, SUN]);
  });
  it("#3  Fri LEAVE + Sat + Sun + Mon LEAVE → Sat, Sun count (4 total with the two leaves)", () => {
    expect(sw([FRI, MON])).toEqual([SAT, SUN]);
  });
});

describe("a working day breaks the chain", () => {
  it("Fri LEAVE + Sat + Sun + Mon present + Tue LEAVE → only Sat/Sun (Friday block); Tue stays separate", () => {
    const res = expandSandwich([FRI, TUE], weekendProvider);
    expect(res.sandwich.map((s) => s.date)).toEqual([SAT, SUN]);
    expect(res.timeline[MON]).toBe("WORKING");
  });
});

describe("reasons are recorded for the audit trail", () => {
  it("Saturday / Sunday reasons", () => {
    const res = expandSandwich([FRI], weekendProvider);
    expect(res.sandwich).toEqual([
      { date: SAT, reason: "SATURDAY" },
      { date: SUN, reason: "SUNDAY" },
    ]);
  });
});

describe("holiday sandwich — ONE generic engine, deterministic fixtures only", () => {
  // fixture "holidays" — NOT real 2026 dates, just deterministic test data
  const WED = "2026-01-07";
  const THU = "2026-01-08";
  const FRI2 = "2026-01-09";
  const holMap = new Map([
    [WED, { reason: "US_FEDERAL" }],
    [THU, { reason: "US_FEDERAL" }],
    [FRI2, { reason: "COMPANY" }],
  ]);
  const provider = holidayAwareProvider(holMap);

  it("Leave + holiday block → connected holiday dates included", () => {
    // TUE leave, WED/THU/FRI2 holidays, then next MON leave
    const TUE0 = "2026-01-06";
    const MON2 = "2026-01-12";
    const res = expandSandwich([TUE0, MON2], provider);
    expect(res.sandwich.map((s) => s.date)).toEqual([
      WED,
      THU,
      FRI2,
      "2026-01-10", // Saturday
      "2026-01-11", // Sunday
    ]);
  });

  it("holiday + weekend at BOTH boundaries of a single leave day is all included", () => {
    // WED/THU are holidays before, FRI2 + weekend after; leave lands on THU only
    const res = expandSandwich([THU], provider);
    expect(res.sandwich.map((s) => s.date)).toEqual([
      WED, // connects right to THU
      FRI2, // connects left to THU
      "2026-01-10", // Saturday
      "2026-01-11", // Sunday
    ]);
  });
});
