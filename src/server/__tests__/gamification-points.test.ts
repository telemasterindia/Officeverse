import { describe, expect, it } from "vitest";
import {
  AUTO_AWARD_EVENTS,
  DEFAULT_POINT_RULES,
  dedupeKeyFor,
  isGamificationEvent,
  resolvePoints,
  reversalDedupeKey,
  totalPoints,
  type PointRuleLike,
} from "../gamification/points";

describe("gamification points — rules are data-driven, never hard-coded", () => {
  it("every default rule ships at 0 points (Admin configures the value)", () => {
    expect(DEFAULT_POINT_RULES.length).toBeGreaterThan(0);
    for (const r of DEFAULT_POINT_RULES) {
      expect(r.points).toBe(0);
      expect(r.enabled).toBe(true);
    }
    // ADMIN_ADJUSTMENT is not a configurable earn-rule
    expect(DEFAULT_POINT_RULES.some((r) => r.event === "ADMIN_ADJUSTMENT")).toBe(false);
  });

  it("resolvePoints returns 0 for missing / disabled / non-positive rules", () => {
    const rules: PointRuleLike[] = [
      { event: "LEAD_SUBMITTED", points: 5, enabled: true },
      { event: "LEAD_ACCEPTED", points: 10, enabled: false },
      { event: "SALE", points: -3, enabled: true },
    ];
    expect(resolvePoints(rules, "LEAD_SUBMITTED")).toBe(5);
    expect(resolvePoints(rules, "LEAD_ACCEPTED")).toBe(0); // disabled
    expect(resolvePoints(rules, "SALE")).toBe(0); // negative
    expect(resolvePoints(rules, "TEAM_MILESTONE")).toBe(0); // missing
  });

  it("resolvePoints truncates fractional configured values", () => {
    expect(resolvePoints([{ event: "SALE", points: 7.9, enabled: true }], "SALE")).toBe(7);
  });

  it("follow-up activity is never an auto-award event", () => {
    for (const e of AUTO_AWARD_EVENTS) {
      expect(e).not.toMatch(/follow|view|open|click|edit/i);
    }
    expect(isGamificationEvent("FOLLOW_UP_OPENED")).toBe(false);
    expect(AUTO_AWARD_EVENTS).not.toContain("ADMIN_ADJUSTMENT");
  });
});

describe("gamification points — idempotency key is deterministic", () => {
  it("same business event → identical dedupe key (refresh / retry / dup webhook)", () => {
    const a = dedupeKeyFor("LEAD_ACCEPTED", "lead", 4210);
    const b = dedupeKeyFor("LEAD_ACCEPTED", "lead", "4210");
    expect(a).toBe(b);
    expect(a).toBe("LEAD_ACCEPTED:lead:4210");
  });

  it("different event / reference → different key", () => {
    expect(dedupeKeyFor("SALE", "lead", 1)).not.toBe(dedupeKeyFor("LEAD_ACCEPTED", "lead", 1));
    expect(dedupeKeyFor("SALE", "lead", 1)).not.toBe(dedupeKeyFor("SALE", "lead", 2));
  });

  it("missing reference collapses to a stable 'none' token", () => {
    expect(dedupeKeyFor("TEAM_MILESTONE", null, null)).toBe("TEAM_MILESTONE:none:none");
  });

  it("reversal key is one-per-transaction", () => {
    expect(reversalDedupeKey(99)).toBe("REVERSAL:99");
    expect(reversalDedupeKey(99)).toBe(reversalDedupeKey(99));
  });
});

describe("gamification points — total derived from the immutable ledger", () => {
  it("sums ACTIVE rows only; REVERSED rows (original + mirror) drop out", () => {
    // award +10, then reverse it: original flips to REVERSED, a -10 mirror is appended REVERSED
    const rows = [
      { points: 10, status: "ACTIVE" },
      { points: 5, status: "ACTIVE" },
    ];
    expect(totalPoints(rows)).toBe(15);

    const afterReversal = [
      { points: 10, status: "REVERSED" }, // original, flipped
      { points: -10, status: "REVERSED" }, // appended mirror
      { points: 5, status: "ACTIVE" },
    ];
    expect(totalPoints(afterReversal)).toBe(5); // dropped by exactly the original amount, once
  });
});
