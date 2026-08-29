import { describe, expect, it } from "vitest";
import {
  coveredCalendarDays,
  daysInMonth,
  prorateBaseSalary,
  type EmploymentPeriodLike,
} from "../hr/payroll-proration";

const P = (startDate: string, endDate: string | null = null): EmploymentPeriodLike => ({
  startDate,
  endDate,
  active: true,
});

describe("daysInMonth — 28 / 29 / 30 / 31 + leap years", () => {
  it("handles every month length", () => {
    expect(daysInMonth("2026-01")).toBe(31);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2024-02")).toBe(29); // leap
    expect(daysInMonth("2000-02")).toBe(29); // leap (÷400)
    expect(daysInMonth("1900-02")).toBe(28); // NOT leap (÷100 not ÷400)
    expect(daysInMonth("2026-04")).toBe(30);
    expect(daysInMonth("2026-12")).toBe(31);
  });
  it("rejects a bad month", () => {
    expect(() => daysInMonth("2026-13")).toThrow();
    expect(() => daysInMonth("nope")).toThrow();
  });
});

describe("coveredCalendarDays — overlap-safe, uses historical dates only", () => {
  it("full month when the period spans it", () => {
    expect(coveredCalendarDays("2026-02", [P("2025-01-01", null)])).toBe(28);
  });
  it("joined mid-month (Aug 16 → end) = 16 days", () => {
    expect(coveredCalendarDays("2026-08", [P("2026-08-16", null)])).toBe(16);
  });
  it("left mid-month (start → Aug 10) = 10 days", () => {
    expect(coveredCalendarDays("2026-08", [P("2026-01-01", "2026-08-10")])).toBe(10);
  });
  it("joined AND left in the same month (Aug 5 → Aug 20) = 16 days", () => {
    expect(coveredCalendarDays("2026-08", [P("2026-08-05", "2026-08-20")])).toBe(16);
  });
  it("no overlap with the month = 0", () => {
    expect(coveredCalendarDays("2026-08", [P("2026-09-01", null)])).toBe(0);
    expect(coveredCalendarDays("2026-08", [P("2026-01-01", "2026-07-31")])).toBe(0);
  });
  it("overlapping periods are merged, not double-counted", () => {
    expect(
      coveredCalendarDays("2026-08", [
        P("2026-08-01", "2026-08-15"),
        P("2026-08-10", "2026-08-20"),
      ]),
    ).toBe(20);
  });
  it("inactive periods are ignored", () => {
    expect(
      coveredCalendarDays("2026-08", [{ startDate: "2026-08-01", endDate: null, active: false }]),
    ).toBe(0);
  });
});

describe("prorateBaseSalary", () => {
  const base = 3_000_000; // ₹30,000 in paise

  it("no basis configured → NOT applied, full month payable (Phase-13 parity)", () => {
    const r = prorateBaseSalary({
      monthlyBasePaise: base,
      month: "2026-08",
      employmentPeriods: [P("2026-08-16")],
    });
    expect(r.applied).toBe(false);
    expect(r.payableBasePaise).toBe(base);
    expect(r.basis).toBeNull();
  });

  it("basis + no employment periods → NOT applied", () => {
    const r = prorateBaseSalary({
      monthlyBasePaise: base,
      month: "2026-08",
      employmentPeriods: [],
      basis: "CALENDAR_DAYS",
    });
    expect(r.applied).toBe(false);
    expect(r.payableBasePaise).toBe(base);
  });

  it("CALENDAR_DAYS — full month → full amount", () => {
    const r = prorateBaseSalary({
      monthlyBasePaise: base,
      month: "2026-08",
      employmentPeriods: [P("2025-01-01")],
      basis: "CALENDAR_DAYS",
    });
    expect(r).toMatchObject({
      applied: true,
      numerator: 31,
      denominator: 31,
      payableBasePaise: base,
    });
  });

  it("CALENDAR_DAYS — joined Aug 16 → 16/31 of ₹30,000", () => {
    const r = prorateBaseSalary({
      monthlyBasePaise: base,
      month: "2026-08",
      employmentPeriods: [P("2026-08-16")],
      basis: "CALENDAR_DAYS",
    });
    expect(r.applied).toBe(true);
    expect(r.numerator).toBe(16);
    expect(r.denominator).toBe(31);
    expect(r.payableBasePaise).toBe(Math.round((base * 16) / 31));
  });

  it("CALENDAR_DAYS — left Feb 10 in a NON-leap Feb → 10/28", () => {
    const r = prorateBaseSalary({
      monthlyBasePaise: base,
      month: "2026-02",
      employmentPeriods: [P("2020-01-01", "2026-02-10")],
      basis: "CALENDAR_DAYS",
    });
    expect(r.denominator).toBe(28);
    expect(r.numerator).toBe(10);
    expect(r.payableBasePaise).toBe(Math.round((base * 10) / 28));
  });

  it("CALENDAR_DAYS — joined + left same month → partial", () => {
    const r = prorateBaseSalary({
      monthlyBasePaise: base,
      month: "2024-02", // leap
      employmentPeriods: [P("2024-02-05", "2024-02-20")],
      basis: "CALENDAR_DAYS",
    });
    expect(r.denominator).toBe(29);
    expect(r.numerator).toBe(16);
    expect(r.payableBasePaise).toBe(Math.round((base * 16) / 29));
  });

  it("zero salary stays zero", () => {
    const r = prorateBaseSalary({
      monthlyBasePaise: 0,
      month: "2026-08",
      employmentPeriods: [P("2026-08-16")],
      basis: "CALENDAR_DAYS",
    });
    expect(r.payableBasePaise).toBe(0);
  });

  it("rejects a negative base and an unimplemented basis", () => {
    expect(() =>
      prorateBaseSalary({ monthlyBasePaise: -1, month: "2026-08", employmentPeriods: [] }),
    ).toThrow();
    expect(() =>
      prorateBaseSalary({
        monthlyBasePaise: base,
        month: "2026-08",
        employmentPeriods: [P("2026-08-01")],
        basis: "WORKING_DAYS" as never,
      }),
    ).toThrow(/not implemented/);
  });

  it("is deterministic", () => {
    const input = {
      monthlyBasePaise: base,
      month: "2026-08",
      employmentPeriods: [P("2026-08-16")],
      basis: "CALENDAR_DAYS" as const,
    };
    expect(prorateBaseSalary(input)).toEqual(prorateBaseSalary(input));
  });
});
