import { describe, expect, it } from "vitest";
import {
  currentShiftDate,
  epochMsToIstWallClock,
  istWallClockToEpochMs,
  minutesUntilIST,
  nextShiftStartIST,
  nowIST,
  shiftEndForStart,
  shiftDateIST,
  wallParts,
} from "../time";

/** Epoch for an IST wall-clock time (IST = UTC+5:30, no DST). */
function istInstant(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - 5, mi - 30));
}

describe("shift date (Phase 7 — canonical, US 21:00→06:00 IST)", () => {
  const cases: Array<[string, Date, string]> = [
    ["28-Aug 21:00 → shift start day", istInstant(2026, 8, 28, 21, 0), "2026-08-28"],
    ["28-Aug 23:59", istInstant(2026, 8, 28, 23, 59), "2026-08-28"],
    [
      "29-Aug 00:01 (after midnight, still 28-Aug shift)",
      istInstant(2026, 8, 29, 0, 1),
      "2026-08-28",
    ],
    ["29-Aug 05:59 (last minute of 28-Aug shift)", istInstant(2026, 8, 29, 5, 59), "2026-08-28"],
    ["29-Aug 06:00 (new shift date)", istInstant(2026, 8, 29, 6, 0), "2026-08-29"],
    ["29-Aug 21:00 (next shift starts)", istInstant(2026, 8, 29, 21, 0), "2026-08-29"],
    [
      "29-Aug 14:00 (between shifts → upcoming shift date)",
      istInstant(2026, 8, 29, 14, 0),
      "2026-08-29",
    ],
  ];
  for (const [label, instant, expected] of cases) {
    it(label, () => {
      expect(shiftDateIST(instant, "US")).toBe(expected);
      expect(currentShiftDate("US", instant)).toBe(expected);
    });
  }
});

describe("nowIST", () => {
  it("formats as IST wall-clock 'YYYY-MM-DD HH:MM:SS'", () => {
    expect(nowIST(istInstant(2026, 8, 28, 21, 0))).toBe("2026-08-28 21:00:00");
    expect(nowIST(istInstant(2026, 1, 5, 3, 7))).toBe("2026-01-05 03:07:00");
  });
});

describe("istWallClockToEpochMs / epochMsToIstWallClock", () => {
  it("round-trips a wall-clock string", () => {
    const s = "2026-09-14 10:00:00";
    expect(epochMsToIstWallClock(istWallClockToEpochMs(s))).toBe(s);
  });
  it("treats the value as IST regardless of a trailing offset", () => {
    expect(istWallClockToEpochMs("2026-09-14T10:00+05:30")).toBe(
      istWallClockToEpochMs("2026-09-14 10:00:00"),
    );
  });
  it("rejects a non-wall-clock string", () => {
    expect(() => istWallClockToEpochMs("nope")).toThrow();
  });
});

describe("minutesUntilIST", () => {
  it("is positive before, negative after, zero at", () => {
    expect(minutesUntilIST("2026-09-14 10:00:00", "2026-09-14 09:45:00")).toBe(15);
    expect(minutesUntilIST("2026-09-14 10:00:00", "2026-09-14 10:03:00")).toBe(-3);
    expect(minutesUntilIST("2026-09-14 10:00:00", "2026-09-14 10:00:00")).toBe(0);
  });
});

describe("nextShiftStartIST / shiftEndForStart", () => {
  it("returns today's start when it is still in the future", () => {
    expect(nextShiftStartIST("US", istInstant(2026, 8, 28, 20, 0))).toBe("2026-08-28 21:00:00");
  });
  it("returns tomorrow's start once today's has passed", () => {
    expect(nextShiftStartIST("US", istInstant(2026, 8, 28, 22, 0))).toBe("2026-08-29 21:00:00");
  });
  it("computes the overnight shift end", () => {
    expect(shiftEndForStart("2026-08-28 21:00:00", "US")).toBe("2026-08-29 06:00:00");
  });
});

describe("wallParts", () => {
  it("splits date and HH:MM", () => {
    expect(wallParts("2026-09-14 10:30:00")).toEqual({ date: "2026-09-14", time: "10:30" });
    expect(wallParts("2026-09-14T10:30")).toEqual({ date: "2026-09-14", time: "10:30" });
  });
});
