import { describe, expect, it } from "vitest";
import {
  dayOfWeekUTC,
  federalObservedDate,
  lastWeekdayOfMonth,
  nthWeekdayOfMonth,
  usFederalHolidays,
} from "../hr/us-federal";

const MON = 1;
const THU = 4;

describe("date-rule helpers (no hard-coded holiday dates)", () => {
  it("dayOfWeekUTC", () => {
    expect(dayOfWeekUTC("2026-01-01")).toBe(4); // Thursday
    expect(dayOfWeekUTC("2026-07-04")).toBe(6); // Saturday
    expect(dayOfWeekUTC("2026-07-05")).toBe(0); // Sunday
  });

  it("nthWeekdayOfMonth — 3rd Monday of Jan 2026 = MLK Day", () => {
    expect(nthWeekdayOfMonth(2026, 1, MON, 3)).toBe("2026-01-19");
  });

  it("nthWeekdayOfMonth — 4th Thursday of Nov 2026 = Thanksgiving", () => {
    expect(nthWeekdayOfMonth(2026, 11, THU, 4)).toBe("2026-11-26");
  });

  it("nthWeekdayOfMonth — 1st Monday of Sep 2026 = Labor Day", () => {
    expect(nthWeekdayOfMonth(2026, 9, MON, 1)).toBe("2026-09-07");
  });

  it("lastWeekdayOfMonth — last Monday of May 2026 = Memorial Day", () => {
    expect(lastWeekdayOfMonth(2026, 5, MON)).toBe("2026-05-25");
  });

  it("lastWeekdayOfMonth — last Monday of May 2024 (5 Mondays that month)", () => {
    expect(lastWeekdayOfMonth(2024, 5, MON)).toBe("2024-05-27");
  });
});

describe("federal weekend-observance rule", () => {
  it("Saturday holiday → observed the Friday before", () => {
    expect(federalObservedDate("2026-07-04")).toBe("2026-07-03");
  });
  it("Sunday holiday → observed the Monday after", () => {
    // Christmas 2022 fell on a Sunday → federally observed Monday Dec 26 2022
    expect(dayOfWeekUTC("2022-12-25")).toBe(0);
    expect(federalObservedDate("2022-12-25")).toBe("2022-12-26");
  });
  it("weekday holiday → observed on the same day", () => {
    expect(federalObservedDate("2026-01-01")).toBe("2026-01-01");
  });
});

describe("usFederalHolidays(year) — 11 rule-derived holidays", () => {
  const h2026 = usFederalHolidays(2026);

  it("produces exactly the 11 federal holidays", () => {
    expect(h2026).toHaveLength(11);
    expect(h2026.map((h) => h.name)).toEqual([
      "New Year's Day",
      "Birthday of Martin Luther King, Jr.",
      "Washington's Birthday",
      "Memorial Day",
      "Juneteenth National Independence Day",
      "Independence Day",
      "Labor Day",
      "Columbus Day",
      "Veterans Day",
      "Thanksgiving Day",
      "Christmas Day",
    ]);
  });

  it("2026 Independence Day (Sat) is observed on Fri Jul 3 and flagged observed", () => {
    const jul4 = h2026.find((h) => h.name === "Independence Day")!;
    expect(jul4.actualDate).toBe("2026-07-04");
    expect(jul4.observedDate).toBe("2026-07-03");
    expect(jul4.observed).toBe(true);
  });

  it("2026 New Year's Day (Thu) is not observed on a different day", () => {
    const nyd = h2026.find((h) => h.name === "New Year's Day")!;
    expect(nyd.actualDate).toBe("2026-01-01");
    expect(nyd.observedDate).toBe("2026-01-01");
    expect(nyd.observed).toBe(false);
  });

  it("nth-weekday holidays never move (already on a weekday)", () => {
    for (const name of [
      "Birthday of Martin Luther King, Jr.",
      "Washington's Birthday",
      "Memorial Day",
      "Labor Day",
      "Columbus Day",
      "Thanksgiving Day",
    ]) {
      const h = h2026.find((x) => x.name === name)!;
      expect(h.observed).toBe(false);
      expect(h.observedDate).toBe(h.actualDate);
    }
  });

  it("is deterministic — same year in, same result out", () => {
    expect(usFederalHolidays(2026)).toEqual(h2026);
  });

  it("works for an arbitrary year without hard-coding (2030)", () => {
    const h2030 = usFederalHolidays(2030);
    expect(h2030).toHaveLength(11);
    // Jul 4 2030 is a Thursday
    const jul4 = h2030.find((h) => h.name === "Independence Day")!;
    expect(jul4.observed).toBe(false);
  });
});
