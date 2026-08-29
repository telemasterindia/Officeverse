import { describe, expect, it } from "vitest";
import {
  PAYROLL_ROUNDING_POLICY,
  paiseToAmount,
  proratePaise,
  roundToPaise,
  sumPaise,
  toPaise,
  toSignedPaise,
} from "../hr/payroll-money";

describe("payroll money policy — one deterministic paise-based policy", () => {
  it("documents the policy", () => {
    expect(PAYROLL_ROUNDING_POLICY).toMatch(/integer paise/i);
    expect(PAYROLL_ROUNDING_POLICY).toMatch(/half-up/i);
  });

  it("toPaise — exact, drift-free", () => {
    expect(toPaise("30000")).toBe(3_000_000);
    expect(toPaise("30000.50")).toBe(3_000_050);
    expect(toPaise(30_000.5)).toBe(3_000_050);
    expect(toPaise("0")).toBe(0);
    // classic float-dust value
    expect(toPaise(0.1 + 0.2)).toBe(30);
  });

  it("toPaise rejects negative / non-finite", () => {
    expect(() => toPaise(-1)).toThrow();
    expect(() => toPaise(Number.NaN)).toThrow();
    expect(() => toPaise(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("toSignedPaise keeps the sign for adjustments", () => {
    expect(toSignedPaise(-250.75)).toBe(-25_075);
    expect(toSignedPaise(250.75)).toBe(25_075);
  });

  it("paiseToAmount round-trips to a decimal(12,2) string", () => {
    expect(paiseToAmount(3_000_050)).toBe("30000.50");
    expect(paiseToAmount(3_000_000)).toBe("30000.00");
    expect(paiseToAmount(5)).toBe("0.05");
    expect(paiseToAmount(-25_075)).toBe("-250.75");
    expect(() => paiseToAmount(1.5)).toThrow();
  });

  it("roundToPaise is half-up", () => {
    expect(roundToPaise(10.005)).toBe(1001);
    expect(roundToPaise(10.004)).toBe(1000);
    expect(roundToPaise(0)).toBe(0);
  });

  it("sumPaise is exact integer addition", () => {
    expect(sumPaise(3_000_000, 100_000, -50_000)).toBe(3_050_000);
    expect(() => sumPaise(1.5, 2)).toThrow();
  });

  it("proratePaise — deterministic half-up division", () => {
    // ₹30,000 for 10 of 31 days
    expect(proratePaise(3_000_000, 10, 31)).toBe(Math.round((3_000_000 * 10) / 31));
    // full or over-full period → the whole amount
    expect(proratePaise(3_000_000, 31, 31)).toBe(3_000_000);
    expect(proratePaise(3_000_000, 40, 31)).toBe(3_000_000);
    // zero numerator → zero
    expect(proratePaise(3_000_000, 0, 30)).toBe(0);
  });

  it("proratePaise guards its inputs", () => {
    expect(() => proratePaise(3_000_000, 5, 0)).toThrow();
    expect(() => proratePaise(3_000_000, -1, 30)).toThrow();
    expect(() => proratePaise(30_000.5, 5, 30)).toThrow();
  });
});
