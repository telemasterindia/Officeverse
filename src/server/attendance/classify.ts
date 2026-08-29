/**
 * Officeverse — attendance classification (Phase 10). PURE. No DB.
 *
 * FROZEN BUSINESS RULES — US SHIFT (21:00–06:00 IST):
 *   Reporting time            20:50 IST
 *   check-in ≤ 20:50          ON TIME            (early check-in is NOT late)
 *   20:51 – 21:49             SHORT ATTENDANCE
 *   ≥ 21:50                   LATE
 *   Shift end                 06:00 IST
 *   check-out ≥ 06:00         ON TIME
 *   < 1h before end (05:00–)  SHORT ATTENDANCE
 *   ≥ 1h before end (< 05:00) EARLY DEPARTURE  (grouped with the "late category")
 *
 * INDIA SHIFT (09:30–18:30 IST): no reporting time is defined — status stays
 * PENDING (business clarification required). Raw minute facts are still
 * recorded (minutes after shift start / before shift end).
 *
 * NOT implemented here (deferred to the HR phase): 2 late = 1 off,
 * 3 short = 1 off, leave, sandwich, holidays, regularity bonus, salary,
 * incentives, absence processing.
 */
import { shiftWindow } from "@/lib/officeverse/shift";
import type { ProcessCode } from "@/lib/officeverse/types";
import { addDaysYMD, istWallClockToEpochMs } from "../time";

/** US reporting time — the on-time cutoff (minutes since midnight IST) */
export const US_REPORTING_HHMM = "20:50";
/** US late cutoff — at/after this, the check-in is LATE not SHORT */
export const US_LATE_HHMM = "21:50";
/** early logout of this many minutes or more before shift end → EARLY DEPARTURE */
export const EARLY_DEPARTURE_GRACE_MIN = 60;

export type CheckInStatus = "ON_TIME" | "SHORT" | "LATE" | "PENDING";
export type CheckOutStatus = "ON_TIME" | "SHORT" | "EARLY_DEPARTURE" | "PENDING";
export type AttendanceStatus =
  "ON_TIME" | "SHORT_ATTENDANCE" | "LATE" | "EARLY_DEPARTURE" | "PENDING";

export interface ClassifyInput {
  process: ProcessCode;
  /** operational SHIFT DATE, "YYYY-MM-DD" (from shiftDateIST) */
  operationalDate: string;
  /** IST wall-clock "YYYY-MM-DD HH:MM:SS", server-derived */
  firstCheckInAt?: string | null;
  lastCheckOutAt?: string | null;
}

export interface AttendanceClassification {
  reportingAt: string;
  shiftStartAt: string;
  shiftEndAt: string;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  checkInStatus: CheckInStatus;
  checkOutStatus: CheckOutStatus;
  status: AttendanceStatus;
  shortAttendance: boolean;
  /** true when the process has no frozen reporting-time rules (India, etc.) */
  classificationPending: boolean;
}

const wall = (ymd: string, hhmm: string): string => `${ymd} ${hhmm}:00`;
const diffMin = (aMs: number, bMs: number): number => Math.round((aMs - bMs) / 60_000);

export function classifyAttendance(input: ClassifyInput): AttendanceClassification {
  const { process, operationalDate: d } = input;
  const w = shiftWindow(process);
  const isUS = process === "US";

  const shiftStartAt = wall(d, w.start);
  const shiftEndAt = wall(w.overnight ? addDaysYMD(d, 1) : d, w.end);
  const reportingAt = isUS ? wall(d, US_REPORTING_HHMM) : shiftStartAt;

  const startMs = istWallClockToEpochMs(shiftStartAt);
  const endMs = istWallClockToEpochMs(shiftEndAt);
  const reportMs = istWallClockToEpochMs(reportingAt);
  const usLateMs = isUS ? istWallClockToEpochMs(wall(d, US_LATE_HHMM)) : reportMs;

  const inMs = input.firstCheckInAt ? istWallClockToEpochMs(input.firstCheckInAt) : null;
  const outMs = input.lastCheckOutAt ? istWallClockToEpochMs(input.lastCheckOutAt) : null;

  // raw minute facts (kept for every process)
  const lateMinutes = inMs == null ? 0 : Math.max(0, diffMin(inMs, reportMs));
  const earlyDepartureMinutes = outMs == null ? 0 : Math.max(0, diffMin(endMs, outMs));

  let checkInStatus: CheckInStatus = "PENDING";
  let checkOutStatus: CheckOutStatus = "PENDING";

  if (isUS) {
    if (inMs != null) {
      // ≤ 20:50 ON TIME · 20:51–21:49 SHORT · ≥ 21:50 LATE (early check-in is not late)
      checkInStatus = inMs <= reportMs ? "ON_TIME" : inMs < usLateMs ? "SHORT" : "LATE";
    }
    if (outMs != null) {
      // ≥ 06:00 ON TIME · <1h early SHORT · ≥1h early EARLY DEPARTURE
      checkOutStatus =
        earlyDepartureMinutes <= 0
          ? "ON_TIME"
          : earlyDepartureMinutes < EARLY_DEPARTURE_GRACE_MIN
            ? "SHORT"
            : "EARLY_DEPARTURE";
    }
  }

  // Overall status = the most severe of the two ends. A still-open check-out
  // (PENDING) is not yet a problem; the row is recomputed on the next activity.
  let status: AttendanceStatus;
  if (!isUS || (inMs == null && outMs == null)) {
    status = "PENDING";
  } else if (checkInStatus === "LATE") {
    status = "LATE";
  } else if (checkOutStatus === "EARLY_DEPARTURE") {
    status = "EARLY_DEPARTURE";
  } else if (checkInStatus === "SHORT" || checkOutStatus === "SHORT") {
    status = "SHORT_ATTENDANCE";
  } else if (checkInStatus === "ON_TIME") {
    status = "ON_TIME";
  } else {
    status = "PENDING";
  }

  return {
    reportingAt,
    shiftStartAt,
    shiftEndAt,
    lateMinutes,
    earlyDepartureMinutes,
    checkInStatus,
    checkOutStatus,
    status,
    shortAttendance: status === "SHORT_ATTENDANCE",
    classificationPending: !isUS,
  };
}
