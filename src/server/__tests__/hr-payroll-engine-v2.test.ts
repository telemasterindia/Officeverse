import { describe, expect, it } from "vitest";
import { calculateMonthlyPayroll, calculatePayroll, PAYROLL_CALC_VERSION_V2 } from "../hr/payroll";

const M = "2026-08";

describe("calculateMonthlyPayroll — breakdown engine", () => {
  it("with NO Phase-16 term → EXACTLY Phase-13: gross = base + bonus", () => {
    const r = calculateMonthlyPayroll({
      month: M,
      monthlyBaseSalary: 30_000,
      regularityBonus: 1_000,
    });
    expect(r.calculatedSalary).toBe("31000.00");
    expect(r.payableBaseSalary).toBe("30000.00");
    expect(r.prorationApplied).toBe(false);
    // parity with the retained Phase-13 engine
    expect(Number(r.calculatedSalary)).toBe(
      calculatePayroll({ baseSalary: 30_000, regularityBonus: 1_000, leaveCount: 0, offCount: 0 })
        .calculatedSalary,
    );
    expect(r.calculationVersion).toBe(PAYROLL_CALC_VERSION_V2);
  });

  it("₹30,000 + ₹0 bonus → ₹30,000", () => {
    expect(
      calculateMonthlyPayroll({ month: M, monthlyBaseSalary: 30_000, regularityBonus: 0 })
        .calculatedSalary,
    ).toBe("30000.00");
  });

  it("proration (joined Aug 16) reduces the payable base and the gross", () => {
    const r = calculateMonthlyPayroll({
      month: M,
      monthlyBaseSalary: 31_000,
      regularityBonus: 0,
      employmentPeriods: [{ startDate: "2026-08-16", endDate: null, active: true }],
      prorationBasis: "CALENDAR_DAYS",
    });
    expect(r.prorationApplied).toBe(true);
    expect(r.prorationNumerator).toBe(16);
    expect(r.prorationDenominator).toBe(31);
    expect(r.payableBaseSalary).toBe("16000.00"); // 31000 * 16 / 31
    expect(r.calculatedSalary).toBe("16000.00");
  });

  it("HR-typed adjustments move the gross (earning adds, deduction subtracts)", () => {
    const earn = calculateMonthlyPayroll({
      month: M,
      monthlyBaseSalary: 30_000,
      regularityBonus: 1_000,
      adjustmentsTotal: 500,
    });
    expect(earn.calculatedSalary).toBe("31500.00");
    const deduct = calculateMonthlyPayroll({
      month: M,
      monthlyBaseSalary: 30_000,
      regularityBonus: 1_000,
      adjustmentsTotal: -1_250.5,
    });
    expect(deduct.adjustmentsTotal).toBe("-1250.50");
    expect(deduct.calculatedSalary).toBe("29749.50");
  });

  it("overtime minutes are carried but the amount stays ₹0 (no rate configured)", () => {
    const r = calculateMonthlyPayroll({
      month: M,
      monthlyBaseSalary: 30_000,
      regularityBonus: 0,
      approvedOvertimeMinutes: 240,
      overtimeAmount: 0,
    });
    expect(r.approvedOvertimeMinutes).toBe(240);
    expect(r.overtimeAmount).toBe("0.00");
    expect(r.calculatedSalary).toBe("30000.00");
  });

  it("unpaid-leave and Off deductions default to ₹0 (rate undefined)", () => {
    const r = calculateMonthlyPayroll({
      month: M,
      monthlyBaseSalary: 30_000,
      regularityBonus: 0,
      unpaidLeaveDays: 3,
      activeOffDays: 2,
    });
    expect(r.unpaidLeaveDays).toBe(3);
    expect(r.unpaidLeaveDeduction).toBe("0.00");
    expect(r.offDeduction).toBe("0.00");
    expect(r.calculatedSalary).toBe("30000.00");
  });

  it("a supplied (future) unpaid/off deduction rate would reduce the gross", () => {
    const r = calculateMonthlyPayroll({
      month: M,
      monthlyBaseSalary: 30_000,
      regularityBonus: 0,
      unpaidLeaveDeduction: 1_000,
      offDeduction: 500,
    });
    expect(r.calculatedSalary).toBe("28500.00");
  });

  it("gross is never negative", () => {
    const r = calculateMonthlyPayroll({
      month: M,
      monthlyBaseSalary: 100,
      regularityBonus: 0,
      adjustmentsTotal: -9_999,
    });
    expect(Number(r.calculatedSalary)).toBe(0);
  });

  it("rejects negative / non-finite base + bonus + deductions", () => {
    expect(() =>
      calculateMonthlyPayroll({ month: M, monthlyBaseSalary: -1, regularityBonus: 0 }),
    ).toThrow();
    expect(() =>
      calculateMonthlyPayroll({ month: M, monthlyBaseSalary: 1, regularityBonus: Number.NaN }),
    ).toThrow();
    expect(() =>
      calculateMonthlyPayroll({
        month: M,
        monthlyBaseSalary: 1,
        regularityBonus: 0,
        unpaidLeaveDeduction: -5,
      }),
    ).toThrow();
    expect(() =>
      calculateMonthlyPayroll({ month: "nope", monthlyBaseSalary: 1, regularityBonus: 0 }),
    ).toThrow();
  });

  it("is deterministic / idempotent", () => {
    const input = {
      month: M,
      monthlyBaseSalary: 42_500.25,
      regularityBonus: 1_000,
      employmentPeriods: [{ startDate: "2026-08-10", endDate: null, active: true }],
      prorationBasis: "CALENDAR_DAYS" as const,
      adjustmentsTotal: -333.33,
    };
    expect(calculateMonthlyPayroll(input)).toEqual(calculateMonthlyPayroll(input));
  });

  it("carries NO incentive / commission / tax / statutory field", () => {
    const r = calculateMonthlyPayroll({
      month: M,
      monthlyBaseSalary: 30_000,
      regularityBonus: 1_000,
    });
    const keys = Object.keys(r).join(" ").toLowerCase();
    expect(keys).not.toMatch(/incentive|commission|\btax\b|\bpf\b|esi|tds|statutory/);
  });
});
