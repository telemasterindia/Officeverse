import { describe, expect, it } from "vitest";
import {
  SHIFTS,
  isWithinShift,
  shiftDateIST,
  shiftMinutes,
  shiftWindow,
} from "@/lib/officeverse/shift";

/** epoch for an IST wall-clock time (IST = UTC+5:30, no DST) */
function ist(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - 5, mi - 30));
}

describe("canonical SHIFTS config", () => {
  it("US = 21:00–06:00, crosses midnight", () => {
    expect(SHIFTS.US).toMatchObject({ start: "21:00", end: "06:00", crossesMidnight: true });
    expect(shiftMinutes("US")).toEqual({ start: 1260, end: 360, crossesMidnight: true });
  });
  it("INDIA = 09:30–18:30, same day", () => {
    expect(SHIFTS.IN).toMatchObject({ start: "09:30", end: "18:30", crossesMidnight: false });
    expect(shiftMinutes("IN")).toEqual({ start: 570, end: 1110, crossesMidnight: false });
  });
  it("every SHIFTS entry names Asia/Kolkata and matches shiftWindow()", () => {
    for (const p of ["US", "UK", "IN", "AU"] as const) {
      expect(SHIFTS[p].tz).toBe("Asia/Kolkata");
      const w = shiftWindow(p);
      expect(SHIFTS[p].start).toBe(w.start);
      expect(SHIFTS[p].end).toBe(w.end);
      expect(SHIFTS[p].crossesMidnight).toBe(w.overnight);
    }
  });
});

describe("isWithinShift — US overnight (21:00 → 06:00, end exclusive)", () => {
  const cases: Array<[string, Date, boolean]> = [
    ["US 21:00", ist(2026, 8, 28, 21, 0), true],
    ["US 23:59", ist(2026, 8, 28, 23, 59), true],
    ["US 00:00", ist(2026, 8, 29, 0, 0), true],
    ["US 02:00", ist(2026, 8, 29, 2, 0), true],
    ["US 05:59", ist(2026, 8, 29, 5, 59), true],
    ["US 06:00 (over)", ist(2026, 8, 29, 6, 0), false],
    ["US 12:00 (off)", ist(2026, 8, 29, 12, 0), false],
    ["US 20:59 (pre)", ist(2026, 8, 29, 20, 59), false],
  ];
  for (const [label, when, expected] of cases) {
    it(`${label} → ${expected}`, () => expect(isWithinShift(when, "US")).toBe(expected));
  }
});

describe("isWithinShift — India same-day (09:30 → 18:30, end exclusive)", () => {
  const cases: Array<[string, Date, boolean]> = [
    ["IN 09:29", ist(2026, 8, 31, 9, 29), false],
    ["IN 09:30", ist(2026, 8, 31, 9, 30), true],
    ["IN 13:00", ist(2026, 8, 31, 13, 0), true],
    ["IN 18:29", ist(2026, 8, 31, 18, 29), true],
    ["IN 18:30 (over)", ist(2026, 8, 31, 18, 30), false],
    ["IN 02:00 (off)", ist(2026, 8, 31, 2, 0), false],
  ];
  for (const [label, when, expected] of cases) {
    it(`${label} → ${expected}`, () => expect(isWithinShift(when, "IN")).toBe(expected));
  }
});

describe("shiftDateIST — US overnight operational date (unchanged)", () => {
  it("Fri 21:00 → Fri; Sat 02:00 & 05:59 → Fri; Sat 21:00 → Sat", () => {
    expect(shiftDateIST(ist(2026, 8, 28, 21, 0), "US")).toBe("2026-08-28"); // Friday
    expect(shiftDateIST(ist(2026, 8, 29, 2, 0), "US")).toBe("2026-08-28");
    expect(shiftDateIST(ist(2026, 8, 29, 5, 59), "US")).toBe("2026-08-28");
    expect(shiftDateIST(ist(2026, 8, 29, 21, 0), "US")).toBe("2026-08-29"); // Saturday
  });
  it("India (non-overnight) shift date == the calendar date", () => {
    expect(shiftDateIST(ist(2026, 8, 31, 9, 30), "IN")).toBe("2026-08-31");
    expect(shiftDateIST(ist(2026, 8, 31, 18, 29), "IN")).toBe("2026-08-31");
  });
});
