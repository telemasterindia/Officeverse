import { describe, expect, it } from "vitest";
// Import the CANONICAL helper — do not re-implement date math in the test.
import { currentShiftDate, shiftDateIST, toScheduledWallClock } from "../time";

/** Epoch for an IST wall-clock time (IST = UTC+5:30, no DST). */
function istInstant(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - 5, mi - 30));
}

describe("follow-up capture date uses the canonical shift date (US 21:00→06:00 IST)", () => {
  const table: Array<[string, Date, string]> = [
    ["28-Aug 23:59 IST", istInstant(2026, 8, 28, 23, 59), "2026-08-28"],
    ["29-Aug 00:01 IST", istInstant(2026, 8, 29, 0, 1), "2026-08-28"],
    ["29-Aug 05:59 IST", istInstant(2026, 8, 29, 5, 59), "2026-08-28"],
    ["29-Aug 06:00 IST", istInstant(2026, 8, 29, 6, 0), "2026-08-29"],
    ["29-Aug 21:00 IST", istInstant(2026, 8, 29, 21, 0), "2026-08-29"],
  ];
  for (const [label, instant, expected] of table) {
    it(label, () => {
      expect(currentShiftDate("US", instant)).toBe(expected);
      expect(shiftDateIST(instant, "US")).toBe(expected);
    });
  }
});

describe("scheduled callback time keeps ORDINARY calendar semantics (not shifted)", () => {
  it("stores the literal chosen date + time as an IST wall-clock string", () => {
    expect(toScheduledWallClock("2026-09-14", "10:00")).toBe("2026-09-14 10:00:00");
    // a 2 AM callback is NOT rolled back to the previous shift date
    expect(toScheduledWallClock("2026-09-15", "02:00")).toBe("2026-09-15 02:00:00");
  });
  it("pads single-digit hour/minute", () => {
    expect(toScheduledWallClock("2026-09-14", "9:5")).toBe("2026-09-14 09:05:00");
  });
});
