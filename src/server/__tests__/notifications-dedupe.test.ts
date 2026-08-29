import { describe, expect, it } from "vitest";
import {
  emailDedupeKey,
  followUpEventDedupeKey,
  notificationDedupeKey,
  reminderDedupeKey,
  shiftEmailDedupeKey,
} from "../ids";
// Canonical shift helper — never re-implement date math in a test.
import { currentShiftDate } from "../time";

/** Epoch for an IST wall-clock time (IST = UTC+5:30, no DST). */
function istInstant(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - 5, mi - 30));
}

describe("notificationDedupeKey — derived from the event, stable across runs", () => {
  it("same event args → identical key (a re-run of the scheduler is a no-op)", () => {
    const a = notificationDedupeKey("followup.reminder", "FU_00004415", "2026-08-29T22:00");
    const b = notificationDedupeKey("followup.reminder", "FU_00004415", "2026-08-29T22:00");
    expect(a).toBe(b);
    expect(a).toBe("notif:followup.reminder:FU_00004415:2026-08-29T22:00");
  });

  it("different occurrence → different key", () => {
    const a = notificationDedupeKey("followup.reminder", "FU_00004415", "2026-08-29T22:00");
    const c = notificationDedupeKey("followup.reminder", "FU_00004415", "2026-08-30T22:00");
    expect(a).not.toBe(c);
  });

  it("does not embed the current time", () => {
    const k = notificationDedupeKey("system", "X", "2026-01-01T00:00");
    expect(k).not.toMatch(
      new RegExp(String(new Date().getFullYear()) + "-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d"),
    );
    expect(k).toBe("notif:system:X:2026-01-01T00:00");
  });
});

describe("followUpEventDedupeKey — follow-up CODE is stable across reschedules", () => {
  it("a reschedule only changes the occurrence portion, not the follow-up code", () => {
    const first = followUpEventDedupeKey("rescheduled", "FU_00004415", "2026-09-01 10:00:00");
    const second = followUpEventDedupeKey("rescheduled", "FU_00004415", "2026-09-03 14:00:00");
    expect(first).not.toBe(second);
    expect(first.startsWith("followup:FU_00004415:rescheduled:")).toBe(true);
    expect(second.startsWith("followup:FU_00004415:rescheduled:")).toBe(true);
  });

  it("terminal events get their own distinct keys", () => {
    const at = "2026-09-01 10:00:00";
    const keys = new Set([
      followUpEventDedupeKey("converted", "FU_1", at),
      followUpEventDedupeKey("completed", "FU_1", at),
      followUpEventDedupeKey("cancelled", "FU_1", at),
    ]);
    expect(keys.size).toBe(3);
  });
});

describe("emailDedupeKey — notification key + ':email' (one event → one email job)", () => {
  it("appends the suffix once and is idempotent", () => {
    const base = reminderDedupeKey("FU_00004415", 15, "2026-08-29 22:00:00");
    const email = emailDedupeKey(base);
    expect(email).toBe(`${base}:email`);
    expect(emailDedupeKey(email)).toBe(email); // not doubled
  });

  it("email key differs from its notification key", () => {
    const base = followUpEventDedupeKey("rescheduled", "FU_9", "2026-09-01 10:00:00");
    expect(emailDedupeKey(base)).not.toBe(base);
  });
});

describe("shift-based dedupe uses the CANONICAL shift date (US 21:00→06:00 IST)", () => {
  const table: Array<[string, Date, string]> = [
    ["28-Aug 23:59 IST", istInstant(2026, 8, 28, 23, 59), "2026-08-28"],
    ["29-Aug 00:01 IST", istInstant(2026, 8, 29, 0, 1), "2026-08-28"],
    ["29-Aug 05:59 IST", istInstant(2026, 8, 29, 5, 59), "2026-08-28"],
    ["29-Aug 06:00 IST", istInstant(2026, 8, 29, 6, 0), "2026-08-29"],
    ["29-Aug 21:00 IST", istInstant(2026, 8, 29, 21, 0), "2026-08-29"],
  ];
  for (const [label, instant, expectedShiftDate] of table) {
    it(`${label} → shift key carries ${expectedShiftDate}`, () => {
      const shiftDate = currentShiftDate("US", instant);
      expect(shiftDate).toBe(expectedShiftDate);
      // a per-user pre-shift email key is stable for the whole shift window
      expect(shiftEmailDedupeKey(20, shiftDate)).toBe(`shift:20:${expectedShiftDate}`);
    });
  }

  it("two instants inside the same shift produce the SAME key", () => {
    const a = currentShiftDate("US", istInstant(2026, 8, 29, 0, 1));
    const b = currentShiftDate("US", istInstant(2026, 8, 28, 23, 59));
    expect(shiftEmailDedupeKey(20, a)).toBe(shiftEmailDedupeKey(20, b));
  });
});
