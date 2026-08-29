import { describe, expect, it } from "vitest";
import {
  bonusReasonText,
  computeRegularityBonus,
  REGULARITY_BONUS_AMOUNT,
  REGULARITY_RULE_VERSION,
} from "../hr/regularity";

const MONTH = "2026-08";
const calc = (leave: number, off: number) =>
  computeRegularityBonus({
    periodMonth: MONTH,
    approvedLeaveDaysInMonth: leave,
    effectiveOffCountInMonth: off,
  });

describe("₹1,000 Monthly Regularity Bonus — FROZEN RULE", () => {
  it("no leave and no Off → eligible, ₹1000", () => {
    const r = calc(0, 0);
    expect(r.eligible).toBe(true);
    expect(r.bonusAmount).toBe(REGULARITY_BONUS_AMOUNT);
    expect(r.bonusAmount).toBe(1000);
    expect(r.disqualifyingReasons).toEqual([]);
  });

  it("1 approved leave day → not eligible, ₹0", () => {
    const r = calc(1, 0);
    expect(r.eligible).toBe(false);
    expect(r.bonusAmount).toBe(0);
    expect(r.disqualifyingReasons).toEqual(["APPROVED_LEAVE"]);
  });

  it("a single sandwich-generated leave day still disqualifies (it is leave)", () => {
    // the caller counts ORIGINAL + SANDWICH leave_days together
    const r = calc(1, 0);
    expect(r.eligible).toBe(false);
  });

  it("1 Off from a Late conversion → not eligible, ₹0", () => {
    const r = calc(0, 1);
    expect(r.eligible).toBe(false);
    expect(r.bonusAmount).toBe(0);
    expect(r.disqualifyingReasons).toEqual(["OFF_RECORDED"]);
  });

  it("1 Off from a Short-attendance conversion → not eligible, ₹0", () => {
    // same code path — an Off is an Off regardless of its source counter
    expect(calc(0, 1).eligible).toBe(false);
  });

  it("both leave and Off → both reasons recorded", () => {
    const r = calc(2, 1);
    expect(r.eligible).toBe(false);
    expect(r.disqualifyingReasons).toEqual(["APPROVED_LEAVE", "OFF_RECORDED"]);
    expect(r.leaveCount).toBe(2);
    expect(r.offCount).toBe(1);
  });

  it("VOID Off / pending leave are the caller's job — a 0 count means eligible", () => {
    // if the caller has already excluded VOID Off + non-approved leave, 0/0 → ₹1000
    expect(calc(0, 0).bonusAmount).toBe(1000);
  });

  it("negative / fractional inputs are clamped", () => {
    expect(calc(-3, 0)).toMatchObject({ eligible: true, leaveCount: 0 });
    expect(calc(1.9, 0)).toMatchObject({ eligible: false, leaveCount: 1 });
  });

  it("is idempotent — same inputs, same result (recalculable)", () => {
    expect(calc(0, 0)).toEqual(calc(0, 0));
    expect(calc(3, 2)).toEqual(calc(3, 2));
  });

  it("stamps the rule version", () => {
    expect(calc(0, 0).calculationVersion).toBe(REGULARITY_RULE_VERSION);
  });
});

describe("bonusReasonText — clear employee-facing text", () => {
  it("eligible", () => {
    expect(bonusReasonText(calc(0, 0))).toBe("Eligible — no Leave and no Off this month.");
  });
  it("leave only", () => {
    expect(bonusReasonText(calc(1, 0))).toBe("Not eligible — Approved Leave recorded.");
  });
  it("off only", () => {
    expect(bonusReasonText(calc(0, 1))).toBe("Not eligible — Off recorded.");
  });
  it("both", () => {
    expect(bonusReasonText(calc(1, 1))).toBe(
      "Not eligible — Approved Leave recorded and Off recorded.",
    );
  });
});
