/**
 * Officeverse — attendance classification (Phase 10 · rules updated in Phase 23).
 * PURE. No DB. No timezone engine of its own — it reuses the canonical
 * `shiftWindow()` + `istWallClockToEpochMs()`.
 *
 * ============================ BUSINESS RULES ============================
 * Employee-facing operational classification: NORMAL · SHORT LATE · LATE
 * ("Short Late" = a MINOR late arrival — NOT "Short Leave", NOT an HR Leave.)
 *
 * US SHIFT (21:00–06:00 IST), reporting 20:50:
 *   check-in  < 21:00            → NORMAL      (early check-in is never late)
 *   check-in  21:00 .. 21:10     → SHORT LATE  (10-minute window)
 *   check-in  ≥ 21:11            → LATE
 *   e.g. 20:59 NORMAL · 21:00 SHORT LATE · 21:10 SHORT LATE · 21:11 LATE
 *
 * INDIA SHIFT (09:30–18:30 IST), reporting 09:30:
 *   check-in  < 09:40            → NORMAL
 *   check-in  09:40 .. 09:50     → SHORT LATE  (10-minute window)
 *   check-in  ≥ 09:51            → LATE
 *   e.g. 09:39 NORMAL · 09:40 SHORT LATE · 09:50 SHORT LATE · 09:51 LATE
 *
 * The SHORT LATE window is MAXIMUM 10 MINUTES for both processes.
 *
 * Check-out / early-departure rules are UNCHANGED from Phase 10 (US only):
 *   check-out ≥ 06:00           → ON TIME
 *   < 1h before shift end       → SHORT ATTENDANCE
 *   ≥ 1h before shift end       → EARLY DEPARTURE
 *
 * NOT here (HR phases): 2 late = 1 off, 3 short-late = 1 off, leave, sandwich,
 * holidays, regularity bonus, salary, incentives, absence processing.
 */
import { shiftWindow } from "@/lib/officeverse/shift";
import type { ProcessCode } from "@/lib/officeverse/types";
import { addDaysYMD, istWallClockToEpochMs } from "../time";

/**
 * Per-process late rules. `reportingHHMM` is displayed on the attendance row;
 * classification is anchored on the two cut-offs. A process without an entry
 * here (UK / AU) stays PENDING — no rule is invented.
 */
export const LATE_RULES: Partial<
  Record<ProcessCode, { reportingHHMM: string; shortLateFromHHMM: string; lateFromHHMM: string }>
> = {
  US: { reportingHHMM: "20:50", shortLateFromHHMM: "21:00", lateFromHHMM: "21:11" },
  IN: { reportingHHMM: "09:30", shortLateFromHHMM: "09:40", lateFromHHMM: "09:51" },
};

/** kept for backwards compatibility with existing imports */
export const US_REPORTING_HHMM = "20:50";
export const US_LATE_HHMM = "21:11";
/** early logout of this many minutes or more before shift end → EARLY DEPARTURE */
export const EARLY_DEPARTURE_GRACE_MIN = 60;

export type LateClass = "NORMAL" | "SHORT_LATE" | "LATE" | "PENDING";

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
  /** business-facing check-in classification */
  lateClass: LateClass;
  /** true when the process has no frozen reporting-time rules (UK / AU) */
  classificationPending: boolean;
}

const wall = (ymd: string, hhmm: string): string => `${ymd} ${hhmm}:00`;
const diffMin = (aMs: number, bMs: number): number => Math.round((aMs - bMs) / 60_000);

/** Pure helper — the exact NORMAL / SHORT LATE / LATE decision for one check-in. */
export function classifyLate(
  process: ProcessCode,
  operationalDate: string,
  firstCheckInAt: string | null | undefined,
): LateClass {
  const rule = LATE_RULES[process];
  if (!rule) return "PENDING";
  if (!firstCheckInAt) return "PENDING";
  const inMs = istWallClockToEpochMs(firstCheckInAt);
  const shortFromMs = istWallClockToEpochMs(wall(operationalDate, rule.shortLateFromHHMM));
  const lateFromMs = istWallClockToEpochMs(wall(operationalDate, rule.lateFromHHMM));
  if (inMs < shortFromMs) return "NORMAL";
  if (inMs < lateFromMs) return "SHORT_LATE";
  return "LATE";
}

const CHECKIN_FROM_LATE: Record<Exclude<LateClass, "PENDING">, CheckInStatus> = {
  NORMAL: "ON_TIME",
  SHORT_LATE: "SHORT",
  LATE: "LATE",
};

export function classifyAttendance(input: ClassifyInput): AttendanceClassification {
  const { process, operationalDate: d } = input;
  const w = shiftWindow(process);
  const rule = LATE_RULES[process];

  const shiftStartAt = wall(d, w.start);
  const shiftEndAt = wall(w.overnight ? addDaysYMD(d, 1) : d, w.end);
  const reportingAt = rule ? wall(d, rule.reportingHHMM) : shiftStartAt;

  const endMs = istWallClockToEpochMs(shiftEndAt);
  const reportMs = istWallClockToEpochMs(reportingAt);

  const inMs = input.firstCheckInAt ? istWallClockToEpochMs(input.firstCheckInAt) : null;
  const outMs = input.lastCheckOutAt ? istWallClockToEpochMs(input.lastCheckOutAt) : null;

  // raw minute facts (kept for every process)
  const lateMinutes = inMs == null ? 0 : Math.max(0, diffMin(inMs, reportMs));
  const earlyDepartureMinutes = outMs == null ? 0 : Math.max(0, diffMin(endMs, outMs));

  const lateClass = classifyLate(process, d, input.firstCheckInAt);

  let checkInStatus: CheckInStatus = "PENDING";
  if (lateClass !== "PENDING") checkInStatus = CHECKIN_FROM_LATE[lateClass];

  let checkOutStatus: CheckOutStatus = "PENDING";
  if (rule && outMs != null) {
    checkOutStatus =
      earlyDepartureMinutes <= 0
        ? "ON_TIME"
        : earlyDepartureMinutes < EARLY_DEPARTURE_GRACE_MIN
          ? "SHORT"
          : "EARLY_DEPARTURE";
  }

  // Overall status = the most severe of the two ends. A still-open check-out
  // (PENDING) is not yet a problem; the row is recomputed on the next activity.
  let status: AttendanceStatus;
  if (!rule || (inMs == null && outMs == null)) {
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
    lateClass,
    classificationPending: !rule,
  };
}
