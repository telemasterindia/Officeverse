import { describe, expect, it } from "vitest";
import {
  calendarDaysInMonth,
  computeLateDeduction,
  computeLateUnits,
  computeRegularityBonusV2,
  perDaySalary,
  LATE_UNITS_THRESHOLD,
  REGULARITY_BONUS_AMOUNT,
} from "../hr/late-units";

describe("Late Units — Owner-confirmed rule (Admin UAT Batch-2 §5)", () => {
  const cases: [string, number, number, number, boolean][] = [
    // label, shortLate, late, expectedUnits, thresholdReached
    ["1 Short Late", 1, 0, 1.0, false],
    ["2 Short Lates", 2, 0, 2.0, false],
    ["1 Late", 0, 1, 1.5, false],
    ["1 Short Late + 1 Late", 1, 1, 2.5, false],
    ["2 Short Lates + 1 Late", 2, 1, 3.5, true],
    ["3 Short Lates", 3, 0, 3.0, true],
    ["2 Lates", 0, 2, 3.0, true],
    ["nothing", 0, 0, 0, false],
    ["4 Lates", 0, 4, 6.0, true],
  ];

  it.each(cases)("%s → %d units, cut=%s", (_label, s, l, units, reached) => {
    const r = computeLateUnits({ shortLateCount: s, lateCount: l });
    expect(r.lateUnits).toBe(units);
    expect(r.thresholdReached).toBe(reached);
    expect(r.salaryCutDays).toBe(reached ? 1 : 0);
    expect(r.bonusBlockedByLate).toBe(reached);
  });

  it("the threshold is exactly 3 total units", () => {
    expect(LATE_UNITS_THRESHOLD).toBe(3);
    expect(computeLateUnits({ shortLateCount: 2, lateCount: 0 }).thresholdReached).toBe(false); // 2.0
    expect(computeLateUnits({ shortLateCount: 3, lateCount: 0 }).thresholdReached).toBe(true); // 3.0
    expect(computeLateUnits({ shortLateCount: 0, lateCount: 2 }).thresholdReached).toBe(true); // 3.0
  });

  it("never treats a lone Late or a lone Short Late as a cut", () => {
    expect(computeLateUnits({ shortLateCount: 0, lateCount: 1 }).salaryCutDays).toBe(0);
    expect(computeLateUnits({ shortLateCount: 1, lateCount: 0 }).salaryCutDays).toBe(0);
    expect(computeLateUnits({ shortLateCount: 1, lateCount: 1 }).salaryCutDays).toBe(0);
  });

  it("negative / junk counts are floored to 0", () => {
    expect(computeLateUnits({ shortLateCount: -5, lateCount: NaN }).lateUnits).toBe(0);
  });
});

describe("per-day salary — base ÷ ACTUAL calendar days of the month", () => {
  it("uses the month being calculated, not a fixed divisor", () => {
    expect(calendarDaysInMonth("2026-08")).toBe(31);
    expect(calendarDaysInMonth("2026-09")).toBe(30);
    expect(calendarDaysInMonth("2026-02")).toBe(28);
    expect(calendarDaysInMonth("2024-02")).toBe(29); // leap year
  });

  it("31000 in August → 1000/day; 30000 in September → 1000/day; 28000 in Feb → 1000/day", () => {
    expect(perDaySalary(31000, "2026-08")).toBe(1000);
    expect(perDaySalary(30000, "2026-09")).toBe(1000);
    expect(perDaySalary(28000, "2026-02")).toBe(1000);
    expect(perDaySalary(29000, "2024-02")).toBe(1000);
  });

  it("rounds to paise", () => {
    // 50000 / 31 = 1612.903225... → 1612.90
    expect(perDaySalary(50000, "2026-08")).toBe(1612.9);
  });
});

describe("computeLateDeduction — the 1-day cut amount", () => {
  it("2 Lates in August, base 31000 → 1-day cut of ₹1000, bonus blocked", () => {
    const r = computeLateDeduction({
      monthlyBaseSalary: 31000,
      month: "2026-08",
      shortLateCount: 0,
      lateCount: 2,
    });
    expect(r.lateUnits).toBe(3.0);
    expect(r.salaryCutDays).toBe(1);
    expect(r.lateDeductionAmount).toBe(1000);
    expect(r.bonusBlockedByLate).toBe(true);
  });

  it("1 Short + 1 Late in September, base 60000 → NO cut", () => {
    const r = computeLateDeduction({
      monthlyBaseSalary: 60000,
      month: "2026-09",
      shortLateCount: 1,
      lateCount: 1,
    });
    expect(r.lateUnits).toBe(2.5);
    expect(r.salaryCutDays).toBe(0);
    expect(r.lateDeductionAmount).toBe(0);
  });

  it("2 Short + 1 Late in February 2026, base 56000 → 1-day cut of ₹2000", () => {
    const r = computeLateDeduction({
      monthlyBaseSalary: 56000,
      month: "2026-02",
      shortLateCount: 2,
      lateCount: 1,
    });
    expect(r.lateUnits).toBe(3.5);
    expect(r.perDaySalary).toBe(2000); // 56000 / 28
    expect(r.lateDeductionAmount).toBe(2000);
  });
});

describe("computeRegularityBonusV2 — ₹1,000 unless (≥3 late units) OR (approved leave/absence)", () => {
  it("no lateness, no leave → ₹1,000", () => {
    const r = computeRegularityBonusV2({
      lateThresholdReached: false,
      hasApprovedLeaveOrAbsence: false,
    });
    expect(r.eligible).toBe(true);
    expect(r.amount).toBe(REGULARITY_BONUS_AMOUNT);
    expect(r.amount).toBe(1000);
  });

  it("3 late units → no bonus", () => {
    const r = computeRegularityBonusV2({
      lateThresholdReached: true,
      hasApprovedLeaveOrAbsence: false,
    });
    expect(r.eligible).toBe(false);
    expect(r.amount).toBe(0);
    expect(r.reasons).toContain("LATE_UNITS_THRESHOLD");
  });

  it("approved leave/absence alone → no bonus even with 0 late units", () => {
    const r = computeRegularityBonusV2({
      lateThresholdReached: false,
      hasApprovedLeaveOrAbsence: true,
    });
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("APPROVED_LEAVE_OR_ABSENCE");
  });

  it("2 Short Lates (< 3 units) + no leave → ₹1,000 (NOT an automatic bonus loss)", () => {
    const units = computeLateUnits({ shortLateCount: 2, lateCount: 0 });
    const r = computeRegularityBonusV2({
      lateThresholdReached: units.thresholdReached,
      hasApprovedLeaveOrAbsence: false,
    });
    expect(r.amount).toBe(1000);
  });
});
