import { describe, expect, it } from "vitest";
import { periodFirstDay, pickEffectiveProfile, type EffectiveProfileLike } from "../hr/payroll";

const P = (o: Partial<EffectiveProfileLike> & { id: number }): EffectiveProfileLike => ({
  baseSalary: "30000.00",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  active: true,
  ...o,
});

describe("periodFirstDay", () => {
  it("returns the 1st of the month", () => {
    expect(periodFirstDay("2026-08")).toBe("2026-08-01");
  });
});

describe("pickEffectiveProfile — effective-dated base salary (salary history)", () => {
  it("returns null when nothing is in effect yet", () => {
    expect(pickEffectiveProfile([P({ id: 1, effectiveFrom: "2026-09-01" })], "2026-08")).toBeNull();
  });

  it("₹30,000 from Aug, raised to ₹35,000 from Sep — August keeps ₹30,000", () => {
    const profiles = [
      P({ id: 1, baseSalary: "30000.00", effectiveFrom: "2026-08-01", effectiveTo: "2026-08-31" }),
      P({ id: 2, baseSalary: "35000.00", effectiveFrom: "2026-09-01" }),
    ];
    expect(pickEffectiveProfile(profiles, "2026-08")?.baseSalary).toBe("30000.00");
    expect(pickEffectiveProfile(profiles, "2026-09")?.baseSalary).toBe("35000.00");
    expect(pickEffectiveProfile(profiles, "2026-10")?.baseSalary).toBe("35000.00");
  });

  it("also works when the earlier profile was left open-ended (no effectiveTo)", () => {
    const profiles = [
      P({ id: 1, baseSalary: "30000.00", effectiveFrom: "2026-08-01", effectiveTo: null }),
      P({ id: 2, baseSalary: "35000.00", effectiveFrom: "2026-09-01", effectiveTo: null }),
    ];
    // on 2026-08-01 both start <= day, but #2 hasn't started; latest eligible start wins
    expect(pickEffectiveProfile(profiles, "2026-08")?.id).toBe(1);
    expect(pickEffectiveProfile(profiles, "2026-09")?.id).toBe(2);
  });

  it("ignores inactive profiles", () => {
    const profiles = [
      P({ id: 1, baseSalary: "30000.00", effectiveFrom: "2026-08-01" }),
      P({ id: 2, baseSalary: "99999.00", effectiveFrom: "2026-08-01", active: false }),
    ];
    expect(pickEffectiveProfile(profiles, "2026-08")?.id).toBe(1);
  });

  it("uses the FIRST day of the month — a raise dated mid-August does not apply to August", () => {
    const profiles = [
      P({ id: 1, baseSalary: "30000.00", effectiveFrom: "2026-07-01" }),
      P({ id: 2, baseSalary: "40000.00", effectiveFrom: "2026-08-15" }),
    ];
    expect(pickEffectiveProfile(profiles, "2026-08")?.baseSalary).toBe("30000.00");
  });

  it("deterministic tie-break on id when two share an effectiveFrom", () => {
    const profiles = [
      P({ id: 5, effectiveFrom: "2026-08-01", baseSalary: "1.00" }),
      P({ id: 9, effectiveFrom: "2026-08-01", baseSalary: "2.00" }),
    ];
    expect(pickEffectiveProfile(profiles, "2026-08")?.id).toBe(9);
  });
});
