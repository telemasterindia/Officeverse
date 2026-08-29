import { describe, expect, it } from "vitest";
import { classifyAttendance } from "../attendance/classify";

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

describe("US reporting-time boundary (frozen)", () => {
  it("check-in at 20:50 exactly → ON_TIME, 0 late minutes", () => {
    const c = cls(usIn("20:50:00"));
    expect(c.checkInStatus).toBe("ON_TIME");
    expect(c.lateMinutes).toBe(0);
  });
  it("early check-in 19:30 → ON_TIME (early is NOT late)", () => {
    expect(cls(usIn("19:30:00")).checkInStatus).toBe("ON_TIME");
  });
  it("20:51 → SHORT (1 late minute)", () => {
    const c = cls(usIn("20:51:00"));
    expect(c.checkInStatus).toBe("SHORT");
    expect(c.lateMinutes).toBe(1);
  });
  it("21:49 → still SHORT", () => {
    expect(cls(usIn("21:49:00")).checkInStatus).toBe("SHORT");
  });
});

describe("US late boundary (frozen)", () => {
  it("21:50 exactly → LATE (60 late minutes)", () => {
    const c = cls(usIn("21:50:00"));
    expect(c.checkInStatus).toBe("LATE");
    expect(c.lateMinutes).toBe(60);
    expect(c.status).toBe("LATE");
  });
  it("22:30 → LATE (100 late minutes)", () => {
    expect(cls(usIn("22:30:00")).lateMinutes).toBe(100);
  });
});

describe("US early-departure boundary (frozen)", () => {
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
  it("05:01 (59 min early) → SHORT", () => {
    expect(cls(usIn("20:45:00"), usOut("05:01:00")).checkOutStatus).toBe("SHORT");
  });
  it("05:00 (exactly 1h early) → EARLY_DEPARTURE", () => {
    const c = cls(usIn("20:45:00"), usOut("05:00:00"));
    expect(c.checkOutStatus).toBe("EARLY_DEPARTURE");
    expect(c.earlyDepartureMinutes).toBe(60);
    expect(c.status).toBe("EARLY_DEPARTURE");
  });
  it("03:00 (3h early) → EARLY_DEPARTURE, 180 minutes", () => {
    expect(cls(usIn("20:45:00"), usOut("03:00:00")).earlyDepartureMinutes).toBe(180);
  });
});

describe("US overall status", () => {
  it("on-time in + on-time out → ON_TIME", () => {
    expect(cls(usIn("20:40:00"), usOut("06:05:00")).status).toBe("ON_TIME");
  });
  it("late in overrides an otherwise-fine out", () => {
    expect(cls(usIn("22:00:00"), usOut("06:05:00")).status).toBe("LATE");
  });
  it("no facts → PENDING", () => {
    expect(cls().status).toBe("PENDING");
  });
  it("on-time check-in, shift still open → ON_TIME (recomputed later)", () => {
    expect(cls(usIn("20:40:00")).status).toBe("ON_TIME");
  });
});

describe("India shift — anchors recorded, classification PENDING", () => {
  const c = classifyAttendance({
    process: "IN",
    operationalDate: "2026-08-31",
    firstCheckInAt: "2026-08-31 09:45:00",
    lastCheckOutAt: "2026-08-31 18:20:00",
  });
  it("start 09:30, end 18:30 same day, no reporting time invented", () => {
    expect(c.shiftStartAt).toBe("2026-08-31 09:30:00");
    expect(c.shiftEndAt).toBe("2026-08-31 18:30:00");
    expect(c.reportingAt).toBe(c.shiftStartAt);
  });
  it("status PENDING, classificationPending true; raw minute facts still recorded", () => {
    expect(c.status).toBe("PENDING");
    expect(c.checkInStatus).toBe("PENDING");
    expect(c.classificationPending).toBe(true);
    expect(c.lateMinutes).toBe(15); // 15 min after shift start (raw fact only)
    expect(c.earlyDepartureMinutes).toBe(10);
  });
});
