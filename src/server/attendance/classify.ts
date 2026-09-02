/**
 * Officeverse — attendance classification (Phase 10 · rules updated in Phase 23).
 * PURE. No DB. No timezone engine of its own — it reuses the canonical
 * `shiftWindow()` + `istWallClockToEpochMs()`.
 *
 * ============================ BUSINESS RULES ============================
 * Employee-facing operational classification: NORMAL · SHORT LATE · LATE
 * ("Short Late" = a MINOR late arrival — NOT "Short Leave", NOT an HR Leave.)
 *
 * Admin UAT Batch-2 §5 — Owner-confirmed check-in boundaries:
 *
 * US SHIFT (21:00–06:00 IST), reporting 20:50:
 *   check-in  ≤ 20:50            → NORMAL (ON-TIME)
 *   check-in  20:51 .. 21:30     → SHORT LATE   (1 Late Unit)
 *   check-in  ≥ 21:31            → LATE          (1.5 Late Units)
 *
 * INDIA SHIFT (09:30–18:30 IST), reporting 09:30:
 *   check-in  ≤ 09:30            → NORMAL
 *   check-in  09:31 .. 10:00     → SHORT LATE   (1 Late Unit)
 *   check-in  ≥ 10:01            → LATE          (1.5 Late Units)
 *
 * The Late-Unit weighting + the 3-unit threshold + the per-day salary cut live
 * in `src/server/hr/late-units.ts` — NOT here (this file is attendance only).
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

export interface LateRule {
  reportingHHMM: string;
  shortLateFromHHMM: string;
  lateFromHHMM: string;
}

/**
 * Per-process late rules. `reportingHHMM` is displayed on the attendance row;
 * classification is anchored on the two cut-offs. A process without an entry
 * here (UK / AU) stays PENDING — no rule is invented.
 */
export const LATE_RULES: Partial<Record<ProcessCode, LateRule>> = {
  // Admin UAT Batch-2 §5 — Owner-confirmed boundaries.
  US: { reportingHHMM: "20:50", shortLateFromHHMM: "20:51", lateFromHHMM: "21:31" },
  IN: { reportingHHMM: "09:30", shortLateFromHHMM: "09:31", lateFromHHMM: "10:01" },
};

/**
 * Admin UAT Batch-2 follow-up §1 — a per-(process, operational-date) shift
 * override. `startHHMM`/`endHHMM` replace the default window; the three late
 * boundaries are optional and, when omitted, are DERIVED from the start time in
 * the same shape as the frozen defaults (see `deriveLateRule`).
 */
export interface ShiftOverrideInput {
  startHHMM: string;
  endHHMM: string;
  reportingHHMM?: string | null;
  shortLateFromHHMM?: string | null;
  lateFromHHMM?: string | null;
}

/** Canonical strict 24-hour "HH:MM" (00:00–23:59). Shared by the shift-override
 *  service + form so both sides accept EXACTLY the same representation. */
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHHMM = (v: string): boolean => HHMM_RE.test(v);

/** minutes-of-day math on an "HH:MM" string, wrapping within a 24h day. */
function shiftHHMM(hhmm: string, deltaMin: number): string {
  const [h = "0", m = "0"] = hhmm.split(":");
  let total = (Number(h) * 60 + Number(m) + deltaMin) % 1440;
  if (total < 0) total += 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Default late boundaries for a shift that starts at `startHHMM`. Reproduces the
 * frozen constants: US start 21:00 → reporting 20:50 / short 20:51 / late 21:31;
 * IN start 09:30 → reporting 09:30 / short 09:31 / late 10:01.
 *   reporting     = start − 10m  (US)  |  start  (everyone else)
 *   short-late-at = reporting + 1m
 *   late-at       = start + 31m
 */
export function deriveLateRule(process: ProcessCode, startHHMM: string): LateRule {
  const reporting = process === "US" ? shiftHHMM(startHHMM, -10) : startHHMM;
  return {
    reportingHHMM: reporting,
    shortLateFromHHMM: shiftHHMM(reporting, 1),
    lateFromHHMM: shiftHHMM(startHHMM, 31),
  };
}

/**
 * The EFFECTIVE shift window + late rule for one classification: the Admin
 * override when supplied, else the frozen default. A process with neither an
 * override nor a `LATE_RULES` entry (UK / AU) resolves `rule = null` → PENDING.
 */
export function resolveShift(
  process: ProcessCode,
  override?: ShiftOverrideInput | null,
): { start: string; end: string; overnight: boolean; rule: LateRule | null; overridden: boolean } {
  if (override) {
    const derived = deriveLateRule(process, override.startHHMM);
    const reporting = override.reportingHHMM || derived.reportingHHMM;
    return {
      start: override.startHHMM,
      end: override.endHHMM,
      overnight: override.endHHMM < override.startHHMM,
      rule: {
        reportingHHMM: reporting,
        shortLateFromHHMM: override.shortLateFromHHMM || shiftHHMM(reporting, 1),
        lateFromHHMM: override.lateFromHHMM || derived.lateFromHHMM,
      },
      overridden: true,
    };
  }
  const w = shiftWindow(process);
  return {
    start: w.start,
    end: w.end,
    overnight: w.overnight,
    rule: LATE_RULES[process] ?? null,
    overridden: false,
  };
}

/** kept for backwards compatibility with existing imports */
export const US_REPORTING_HHMM = "20:50";
export const US_LATE_HHMM = "21:31";
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
  /** Admin UAT Batch-2 follow-up §1 — the effective shift for THIS date, when
   *  an Admin has configured an override. Omitted → the frozen default. */
  shiftOverride?: ShiftOverrideInput | null;
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
  shiftOverride?: ShiftOverrideInput | null,
): LateClass {
  const rule = resolveShift(process, shiftOverride).rule;
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
  const eff = resolveShift(process, input.shiftOverride);
  const rule = eff.rule;

  const shiftStartAt = wall(d, eff.start);
  const shiftEndAt = wall(eff.overnight ? addDaysYMD(d, 1) : d, eff.end);
  const reportingAt = rule ? wall(d, rule.reportingHHMM) : shiftStartAt;

  const endMs = istWallClockToEpochMs(shiftEndAt);
  const reportMs = istWallClockToEpochMs(reportingAt);

  const inMs = input.firstCheckInAt ? istWallClockToEpochMs(input.firstCheckInAt) : null;
  const outMs = input.lastCheckOutAt ? istWallClockToEpochMs(input.lastCheckOutAt) : null;

  // raw minute facts (kept for every process)
  const lateMinutes = inMs == null ? 0 : Math.max(0, diffMin(inMs, reportMs));
  const earlyDepartureMinutes = outMs == null ? 0 : Math.max(0, diffMin(endMs, outMs));

  const lateClass = classifyLate(process, d, input.firstCheckInAt, input.shiftOverride);

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
