import { describe, expect, it } from "vitest";
import { calculatePayroll, PAYROLL_CALC_VERSION } from "../hr/payroll";

const calc = (baseSalary: number, regularityBonus: number, leaveCount = 0, offCount = 0) =>
  calculatePayroll({ baseSalary, regularityBonus, leaveCount, offCount });

describe("calculatePayroll — calculatedSalary = baseSalary + regularityBonus, nothing else", () => {
  it("₹30,000 + ₹1,000 bonus → ₹31,000", () => {
    const r = calc(30_000, 1_000);
    expect(r.baseSalary).toBe(30_000);
    expect(r.regularityBonus).toBe(1_000);
    expect(r.calculatedSalary).toBe(31_000);
  });

  it("₹30,000 + ₹0 bonus → ₹30,000", () => {
    expect(calc(30_000, 0).calculatedSalary).toBe(30_000);
  });

  it("paise in the base salary are preserved exactly (no invented rounding)", () => {
    const r = calc(30_000.5, 1_000);
    expect(r.baseSalary).toBe(30_000.5);
    expect(r.calculatedSalary).toBe(31_000.5);
  });

  it("leave / Off counts are carried but never change the amount", () => {
    const withCounts = calc(30_000, 0, 4, 2);
    expect(withCounts.calculatedSalary).toBe(30_000);
    expect(withCounts.leaveCount).toBe(4);
    expect(withCounts.offCount).toBe(2);
  });

  it("stamps the calculation version", () => {
    expect(calc(1, 0).calculationVersion).toBe(PAYROLL_CALC_VERSION);
  });

  it("is deterministic / idempotent", () => {
    expect(calc(30_000, 1_000)).toEqual(calc(30_000, 1_000));
    expect(calc(42_500.25, 0)).toEqual(calc(42_500.25, 0));
  });
});

describe("calculatePayroll — input guards", () => {
  it("rejects a negative base salary", () => {
    expect(() => calc(-1, 0)).toThrow(/baseSalary/);
  });
  it("rejects a non-finite base salary", () => {
    expect(() => calc(Number.NaN, 0)).toThrow(/baseSalary/);
    expect(() => calc(Number.POSITIVE_INFINITY, 0)).toThrow(/baseSalary/);
  });
  it("rejects a negative bonus", () => {
    expect(() => calc(30_000, -1_000)).toThrow(/regularityBonus/);
  });
  it("rejects a non-finite bonus", () => {
    expect(() => calc(30_000, Number.NaN)).toThrow(/regularityBonus/);
  });
  it("clamps negative counts to zero", () => {
    const r = calc(30_000, 0, -5, -2);
    expect(r.leaveCount).toBe(0);
    expect(r.offCount).toBe(0);
  });
});
