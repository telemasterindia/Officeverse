import { describe, expect, it } from "vitest";
import {
  closePreviousAt,
  selectVersionForDate,
  wouldOverlap,
  type RuleVersionLike,
} from "../scoring/versions";

const V = (
  version: number,
  effectiveFrom: string,
  effectiveUntil: string | null,
): RuleVersionLike => ({ version, effectiveFrom, effectiveUntil });

describe("scoring versions — selection is keyed on operationalDate", () => {
  const versions = [V(1, "2026-08-01", "2026-09-01"), V(2, "2026-09-01", null)];

  it("an August event scores under v1", () => {
    expect(selectVersionForDate(versions, "2026-08-15")?.version).toBe(1);
  });
  it("a September event scores under v2", () => {
    expect(selectVersionForDate(versions, "2026-09-15")?.version).toBe(2);
  });
  it("the boundary date belongs to the NEW version (half-open window)", () => {
    expect(selectVersionForDate(versions, "2026-09-01")?.version).toBe(2);
  });
  it("a date before any version → undefined (no accidental scoring)", () => {
    expect(selectVersionForDate(versions, "2026-07-31")).toBeUndefined();
  });
  it("a malformed operationalDate → undefined", () => {
    expect(selectVersionForDate(versions, "not-a-date")).toBeUndefined();
  });
});

describe("scoring versions — defensive overlap resolution", () => {
  it("if two versions overlap a date, the HIGHER version wins", () => {
    const overlapping = [V(1, "2026-08-01", null), V(2, "2026-08-01", null)];
    expect(selectVersionForDate(overlapping, "2026-08-10")?.version).toBe(2);
  });
});

describe("scoring versions — save-time window discipline", () => {
  it("wouldOverlap detects an open window that a new start would collide with", () => {
    expect(wouldOverlap([V(1, "2026-08-01", null)], "2026-09-01")).toBe(true);
  });
  it("closePreviousAt returns a copy, does not mutate the original", () => {
    const open = V(1, "2026-08-01", null);
    const closed = closePreviousAt(open, "2026-09-01");
    expect(closed.effectiveUntil).toBe("2026-09-01");
    expect(open.effectiveUntil).toBeNull();
  });
});
