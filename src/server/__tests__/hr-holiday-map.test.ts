import { describe, expect, it } from "vitest";
import {
  buildHolidayMap,
  effectiveHolidayDate,
  holidayAppliesToProcess,
  type HolidayRowLike,
} from "../hr/holiday-map";
import { expandSandwich, holidayAwareProvider } from "../hr/non-working";

function row(p: Partial<HolidayRowLike>): HolidayRowLike {
  return {
    holidayDate: "2026-01-15",
    observedDate: null,
    holidayType: "COMPANY",
    appliesToProcess: null,
    active: true,
    ...p,
  };
}

describe("effectiveHolidayDate — observed date wins, never double-counts", () => {
  it("uses observedDate when present", () => {
    expect(effectiveHolidayDate({ holidayDate: "2026-07-04", observedDate: "2026-07-03" })).toBe(
      "2026-07-03",
    );
  });
  it("falls back to holidayDate when observedDate is null", () => {
    expect(effectiveHolidayDate({ holidayDate: "2026-07-04", observedDate: null })).toBe(
      "2026-07-04",
    );
  });
});

describe("holidayAppliesToProcess", () => {
  it("null applies_to_process = company-wide (every process)", () => {
    expect(holidayAppliesToProcess({ appliesToProcess: null }, "US")).toBe(true);
    expect(holidayAppliesToProcess({ appliesToProcess: null }, "IN")).toBe(true);
  });
  it("scoped holiday only applies to its own process", () => {
    expect(holidayAppliesToProcess({ appliesToProcess: "US" }, "US")).toBe(true);
    expect(holidayAppliesToProcess({ appliesToProcess: "US" }, "IN")).toBe(false);
  });
});

describe("buildHolidayMap", () => {
  it("keeps company-wide + own-process, drops other-process", () => {
    const map = buildHolidayMap(
      [
        row({ holidayDate: "2026-01-10", appliesToProcess: null }),
        row({ holidayDate: "2026-01-11", appliesToProcess: "US", holidayType: "US_FEDERAL" }),
        row({ holidayDate: "2026-01-12", appliesToProcess: "IN", holidayType: "INDIAN" }),
      ],
      "US",
    );
    expect([...map.keys()].sort()).toEqual(["2026-01-10", "2026-01-11"]);
    expect(map.get("2026-01-11")).toEqual({ reason: "US_FEDERAL" });
  });

  it("excludes inactive holidays", () => {
    const map = buildHolidayMap([row({ holidayDate: "2026-01-10", active: false })], "US");
    expect(map.size).toBe(0);
  });

  it("maps a weekend-observed holiday to its OBSERVED date only (no double count)", () => {
    const map = buildHolidayMap(
      [row({ holidayDate: "2026-07-04", observedDate: "2026-07-03", holidayType: "US_FEDERAL" })],
      "US",
    );
    expect([...map.keys()]).toEqual(["2026-07-03"]);
    expect(map.has("2026-07-04")).toBe(false);
  });
});

describe("real holiday rows feed the EXISTING Phase-11 sandwich engine", () => {
  // no second sandwich algorithm — buildHolidayMap only supplies data to
  // holidayAwareProvider / expandSandwich
  it("leave + company holiday + weekend all connect", () => {
    // Thu 2026-01-15 leave, Fri 2026-01-16 company holiday, Sat/Sun weekend,
    // Mon 2026-01-19 leave
    const map = buildHolidayMap([row({ holidayDate: "2026-01-16" })], "US");
    const res = expandSandwich(["2026-01-15", "2026-01-19"], holidayAwareProvider(map));
    expect(res.sandwich.map((s) => s.date)).toEqual([
      "2026-01-16", // company holiday
      "2026-01-17", // Saturday
      "2026-01-18", // Sunday
    ]);
  });

  it("an ordinary working day still breaks the chain", () => {
    const map = buildHolidayMap([row({ holidayDate: "2026-01-16" })], "US");
    // leave Thu 15, holiday Fri 16, then WORKING Mon 19, leave Tue 20
    const res = expandSandwich(["2026-01-15", "2026-01-20"], holidayAwareProvider(map));
    expect(res.sandwich.map((s) => s.date)).toEqual(["2026-01-16", "2026-01-17", "2026-01-18"]);
    expect(res.timeline["2026-01-19"]).toBe("WORKING");
  });

  it("a holiday scoped to the OTHER process does not create a sandwich day", () => {
    const map = buildHolidayMap(
      [row({ holidayDate: "2026-01-16", appliesToProcess: "IN", holidayType: "INDIAN" })],
      "US",
    );
    const res = expandSandwich(["2026-01-15", "2026-01-19"], holidayAwareProvider(map));
    // only the weekend connects; Fri 16 is WORKING for the US process
    expect(res.sandwich.map((s) => s.date)).toEqual(["2026-01-17", "2026-01-18"]);
    expect(res.timeline["2026-01-16"]).toBe("WORKING");
  });
});
