import { describe, expect, it } from "vitest";
import {
  assertPayrollTransition,
  canApprove,
  canLock,
  canRecalculate,
  canReopen,
  PAYROLL_STATUSES,
  type PayrollStatus,
} from "../hr/payroll";

describe("payroll lifecycle — DRAFT → CALCULATED → APPROVED → LOCKED", () => {
  it("only DRAFT / CALCULATED may be (re)calculated", () => {
    expect(canRecalculate("DRAFT")).toBe(true);
    expect(canRecalculate("CALCULATED")).toBe(true);
    expect(canRecalculate("APPROVED")).toBe(false);
    expect(canRecalculate("LOCKED")).toBe(false);
  });

  it("only CALCULATED may be approved", () => {
    expect(PAYROLL_STATUSES.filter(canApprove)).toEqual(["CALCULATED"]);
  });

  it("only APPROVED may be locked", () => {
    expect(PAYROLL_STATUSES.filter(canLock)).toEqual(["APPROVED"]);
  });

  it("only APPROVED / LOCKED may be reopened", () => {
    expect(PAYROLL_STATUSES.filter(canReopen)).toEqual(["APPROVED", "LOCKED"]);
  });
});

describe("assertPayrollTransition", () => {
  it("APPROVED cannot be silently recalculated", () => {
    expect(() => assertPayrollTransition("APPROVED", "calculate")).toThrow(/Cannot calculate/);
  });

  it("LOCKED cannot be recalculated, approved or locked again", () => {
    expect(() => assertPayrollTransition("LOCKED", "calculate")).toThrow();
    expect(() => assertPayrollTransition("LOCKED", "approve")).toThrow();
    expect(() => assertPayrollTransition("LOCKED", "lock")).toThrow();
  });

  it("LOCKED can be reopened (the only allowed change)", () => {
    expect(() => assertPayrollTransition("LOCKED", "reopen")).not.toThrow();
  });

  it("DRAFT cannot be approved or locked directly", () => {
    expect(() => assertPayrollTransition("DRAFT", "approve")).toThrow();
    expect(() => assertPayrollTransition("DRAFT", "lock")).toThrow();
  });

  it("the happy path passes each guard", () => {
    expect(() => assertPayrollTransition("DRAFT", "calculate")).not.toThrow();
    expect(() => assertPayrollTransition("CALCULATED", "approve")).not.toThrow();
    expect(() => assertPayrollTransition("APPROVED", "lock")).not.toThrow();
  });

  it("covers every declared status", () => {
    const all: PayrollStatus[] = ["DRAFT", "CALCULATED", "APPROVED", "LOCKED"];
    expect([...PAYROLL_STATUSES].sort()).toEqual([...all].sort());
  });
});
