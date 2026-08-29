import { describe, expect, it } from "vitest";
import { holidayAwareProvider, weekendProvider } from "../hr/non-working";
import { planLeaveDays } from "../hr/sandwich";

const FRI = "2026-01-02";
const SAT = "2026-01-03";
const SUN = "2026-01-04";
const MON = "2026-01-05";
const TUE = "2026-01-06";

describe("planLeaveDays — ORIGINAL + SANDWICH, audit-attributed", () => {
  it("single Friday leave → ORIGINAL Fri + SANDWICH_WEEKEND Sat/Sun, all owned by that request", () => {
    const plan = planLeaveDays([{ id: 7, startDate: FRI, endDate: FRI }], weekendProvider);
    expect(plan.days).toEqual([
      { leaveRequestId: 7, leaveDate: FRI, dayType: "ORIGINAL", nonWorkingReason: null },
      {
        leaveRequestId: 7,
        leaveDate: SAT,
        dayType: "SANDWICH_WEEKEND",
        nonWorkingReason: "SATURDAY",
      },
      {
        leaveRequestId: 7,
        leaveDate: SUN,
        dayType: "SANDWICH_WEEKEND",
        nonWorkingReason: "SUNDAY",
      },
    ]);
    expect(plan.allLeaveDates).toEqual([FRI, SAT, SUN]);
    // audit: every sandwich day points back to a real leave request
    expect(plan.byRequest.get(7)).toHaveLength(3);
  });

  it("Friday leave + Monday leave → 4 counted days, sandwich attributed to the nearest request", () => {
    const plan = planLeaveDays(
      [
        { id: 1, startDate: FRI, endDate: FRI },
        { id: 2, startDate: MON, endDate: MON },
      ],
      weekendProvider,
    );
    const map = Object.fromEntries(plan.days.map((d) => [d.leaveDate, d]));
    expect(map[FRI]!.dayType).toBe("ORIGINAL");
    expect(map[MON]!.dayType).toBe("ORIGINAL");
    expect(map[SAT]!.dayType).toBe("SANDWICH_WEEKEND"); // nearer to FRI (id 1)
    expect(map[SAT]!.leaveRequestId).toBe(1);
    expect(map[SUN]!.leaveRequestId).toBe(2); // nearer to MON
    expect(plan.allLeaveDates).toEqual([FRI, SAT, SUN, MON]);
  });

  it("a working day between two leaves keeps them separate (no merge)", () => {
    const plan = planLeaveDays(
      [
        { id: 1, startDate: FRI, endDate: FRI },
        { id: 2, startDate: TUE, endDate: TUE },
      ],
      weekendProvider,
    );
    // Sat/Sun belong to the Friday block only; Monday (working) is NOT counted
    expect(plan.allLeaveDates).toEqual([FRI, SAT, SUN, TUE]);
    expect(plan.days.some((d) => d.leaveDate === MON)).toBe(false);
  });

  it("holiday sandwich uses the SAME engine → SANDWICH_HOLIDAY day type", () => {
    const WED = "2026-01-07";
    const provider = holidayAwareProvider(new Map([[WED, { reason: "COMPANY" }]]));
    // leave Tue + leave Thu, Wed is a company holiday between
    const plan = planLeaveDays(
      [
        { id: 5, startDate: TUE, endDate: TUE },
        { id: 6, startDate: "2026-01-08", endDate: "2026-01-08" },
      ],
      provider,
    );
    const wed = plan.days.find((d) => d.leaveDate === WED)!;
    expect(wed.dayType).toBe("SANDWICH_HOLIDAY");
    expect(wed.nonWorkingReason).toBe("COMPANY");
  });

  it("no approved leave → no leave days", () => {
    expect(planLeaveDays([], weekendProvider).days).toEqual([]);
  });
});
