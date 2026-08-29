import { describe, expect, it } from "vitest";
import { classifyAttendance, classifyLate } from "../attendance/classify";

const D = "2026-08-28"; // US shift date (shift runs into 2026-08-29)
const usIn = (hhmmss: string) => `${D} ${hhmmss}`;
const usOut = (hhmmss: string) => `2026-08-29 ${hhmmss}`;

function cls(firstCheckInAt?: string, lastCheckOutAt?: string) {
  return classifyAttendance({
    process: "US",
    operationalDate: D,
    ...(firstCheckInAt ? { firstCheckInAt } : {}),
    ...(lastCheckOutAt ? { lastCheckOutAt } : {}),
  });
}

describe("US shift anchors", () => {
  it("reporting 20:50, start 21:00, end next-day 06:00", () => {
    const c = cls();
    expect(c.reportingAt).toBe("2026-08-28 20:50:00");
    expect(c.shiftStartAt).toBe("2026-08-28 21:00:00");
    expect(c.shiftEndAt).toBe("2026-08-29 06:00:00");
    expect(c.classificationPending).toBe(false);
  });
});

describe("US check-in classification — 10-minute Short Late window (Phase 23 §8)", () => {
  it("8:59 PM → NORMAL", () => {
    expect(classifyLate("US", D, usIn("20:59:00"))).toBe("NORMAL");
    expect(cls(usIn("20:59:00")).checkInStatus).toBe("ON_TIME");
    expect(cls(usIn("20:59:00")).lateClass).toBe("NORMAL");
  });
  it("early check-in 7:30 PM → NORMAL (early is never late)", () => {
    expect(cls(usIn("19:30:00")).lateClass).toBe("NORMAL");
  });
  it("9:00 PM → SHORT LATE", () => {
    expect(classifyLate("US", D, usIn("21:00:00"))).toBe("SHORT_LATE");
    expect(cls(usIn("21:00:00")).checkInStatus).toBe("SHORT");
    expect(cls(usIn("21:00:00")).lateClass).toBe("SHORT_LATE");
  });
  it("9:10 PM → SHORT LATE (last minute of the window)", () => {
    expect(classifyLate("US", D, usIn("21:10:00"))).toBe("SHORT_LATE");
    expect(cls(usIn("21:10:59")).lateClass).toBe("SHORT_LATE");
  });
  it("9:11 PM → LATE", () => {
    expect(classifyLate("US", D, usIn("21:11:00"))).toBe("LATE");
    expect(cls(usIn("21:11:00")).checkInStatus).toBe("LATE");
    expect(cls(usIn("21:11:00")).lateClass).toBe("LATE");
    expect(cls(usIn("21:11:00")).status).toBe("LATE");
  });
  it("the Short Late window is at most 10 minutes wide", () => {
    // 21:00 .. 21:10 inclusive is SHORT_LATE; 21:11 is LATE
    for (const m of [0, 1, 5, 9, 10]) {
      const hh = 21;
      const mm = String(m).padStart(2, "0");
      expect(classifyLate("US", D, usIn(`${hh}:${mm}:00`))).toBe("SHORT_LATE");
    }
  });
  it("raw lateMinutes are still measured from the 20:50 reporting time", () => {
    expect(cls(usIn("21:00:00")).lateMinutes).toBe(10);
    expect(cls(usIn("21:11:00")).lateMinutes).toBe(21);
  });
});

describe("US early-departure boundary (unchanged from Phase 10)", () => {
  it("check-out ≥ 06:00 → ON_TIME, 0 early minutes", () => {
    expect(cls(usIn("20:45:00"), usOut("06:00:00")).checkOutStatus).toBe("ON_TIME");
    expect(cls(usIn("20:45:00"), usOut("06:20:00")).earlyDepartureMinutes).toBe(0);
  });
  it("05:30 (30 min early, <1h) → SHORT", () => {
    const c = cls(usIn("20:45:00"), usOut("05:30:00"));
    expect(c.checkOutStatus).toBe("SHORT");
    expect(c.earlyDepartureMinutes).toBe(30);
    expect(c.status).toBe("SHORT_ATTENDANCE");
  });
  it("05:00 (exactly 1h early) → EARLY_DEPARTURE", () => {
    const c = cls(usIn("20:45:00"), usOut("05:00:00"));
    expect(c.checkOutStatus).toBe("EARLY_DEPARTURE");
    expect(c.status).toBe("EARLY_DEPARTURE");
  });
});

describe("US overall status", () => {
  it("normal in + on-time out → ON_TIME", () => {
    expect(cls(usIn("20:40:00"), usOut("06:05:00")).status).toBe("ON_TIME");
  });
  it("late in overrides an otherwise-fine out", () => {
    expect(cls(usIn("22:00:00"), usOut("06:05:00")).status).toBe("LATE");
  });
  it("no facts → PENDING", () => {
    expect(cls().status).toBe("PENDING");
    expect(cls().lateClass).toBe("PENDING");
  });
});

describe("India check-in classification — 10-minute Short Late window (Phase 23 §9)", () => {
  const DI = "2026-08-31";
  const inAt = (hhmmss: string) => `${DI} ${hhmmss}`;
  const c = (t: string) =>
    classifyAttendance({ process: "IN", operationalDate: DI, firstCheckInAt: inAt(t) });

  it("anchors: start 09:30, end 18:30 same day, reporting 09:30, no longer PENDING", () => {
    const a = c("09:35:00");
    expect(a.shiftStartAt).toBe("2026-08-31 09:30:00");
    expect(a.shiftEndAt).toBe("2026-08-31 18:30:00");
    expect(a.classificationPending).toBe(false);
  });
  it("9:39 AM → NORMAL", () => {
    expect(classifyLate("IN", DI, inAt("09:39:00"))).toBe("NORMAL");
    expect(c("09:39:00").lateClass).toBe("NORMAL");
  });
  it("9:40 AM → SHORT LATE", () => {
    expect(classifyLate("IN", DI, inAt("09:40:00"))).toBe("SHORT_LATE");
    expect(c("09:40:00").status).toBe("SHORT_ATTENDANCE");
  });
  it("9:50 AM → SHORT LATE", () => {
    expect(classifyLate("IN", DI, inAt("09:50:00"))).toBe("SHORT_LATE");
  });
  it("9:51 AM → LATE", () => {
    expect(classifyLate("IN", DI, inAt("09:51:00"))).toBe("LATE");
    expect(c("09:51:00").status).toBe("LATE");
    expect(c("09:51:00").lateClass).toBe("LATE");
  });
  it("raw lateMinutes measured from the 09:30 reporting time", () => {
    expect(c("09:45:00").lateMinutes).toBe(15);
  });
});

describe("processes without a frozen rule stay PENDING (no invented rule)", () => {
  it("UK → PENDING", () => {
    expect(classifyLate("UK", "2026-08-31", "2026-08-31 10:00:00")).toBe("PENDING");
    const a = classifyAttendance({
      process: "UK",
      operationalDate: "2026-08-31",
      firstCheckInAt: "2026-08-31 10:00:00",
    });
    expect(a.status).toBe("PENDING");
    expect(a.classificationPending).toBe(true);
  });
});
