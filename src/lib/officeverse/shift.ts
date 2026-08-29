/**
 * Operational SHIFT DATE — the one canonical answer to "which business day is
 * this?" for an IST-run call centre.
 *
 * Rule: the shift date is always the calendar date on which the shift STARTS.
 * The US process runs an overnight shift (21:00–06:00 IST), so any timestamp
 * from 00:00 to 05:59 IST belongs to the PREVIOUS calendar day's shift. Never
 * derive the operational date from the raw browser calendar date after midnight.
 *
 * Every feature that needs the operational business date (lead creation date,
 * follow-up capture date, agent activity, reporting…) must call `shiftDateIST()`.
 * Do not add competing per-component date math.
 */
import { PROCESSES } from "./data";
import type { ProcessCode } from "./types";

const IST_TZ = "Asia/Kolkata";

/** Parse `PROCESSES[code].hours` ("21:00 – 06:00 IST") into start/end "HH:mm". */
export function shiftWindow(process: ProcessCode): {
  start: string;
  end: string;
  overnight: boolean;
} {
  const raw = PROCESSES[process].hours;
  const m = raw.match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/);
  const start = m?.[1] ?? "21:00";
  const end = m?.[2] ?? "06:00";
  return { start, end, overnight: end < start };
}

/** IST wall-clock parts of an absolute instant. */
export function istParts(instant: number | Date = Date.now()): {
  date: string;
  hour: number;
  minute: number;
} {
  const ms = instant instanceof Date ? instant.getTime() : instant;
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const hourRaw = g("hour");
  return {
    date: `${g("year")}-${g("month")}-${g("day")}`,
    hour: hourRaw === "24" ? 0 : Number(hourRaw),
    minute: Number(g("minute")),
  };
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + delta)).toISOString().slice(0, 10);
}

/**
 * The operational SHIFT DATE ("YYYY-MM-DD") for an instant — the calendar date
 * the current shift started (IST). For an overnight process, timestamps before
 * the shift's end hour roll back to the previous day.
 *
 *   28-Aug 23:59 IST → 2026-08-28
 *   29-Aug 00:01 IST → 2026-08-28
 *   29-Aug 05:59 IST → 2026-08-28
 *   29-Aug 21:00 IST → 2026-08-29
 */
export function shiftDateIST(
  instant: number | Date = Date.now(),
  process: ProcessCode = "US",
): string {
  const { date, hour } = istParts(instant);
  const { end, overnight } = shiftWindow(process);
  if (!overnight) return date;
  const endHour = Number(end.slice(0, 2));
  return hour < endHour ? addDays(date, -1) : date;
}

/* ------------------------------------------------------------------ *
 *  Canonical structured shift definitions (Phase 9A)                 *
 *                                                                    *
 *  ONE source of truth. `shiftWindow()` (which parses the display    *
 *  string in PROCESSES) is the underlying parser; SHIFTS is the      *
 *  structured view every presence / attendance / reporting feature   *
 *  should read. Officeverse canonical timings (IST):                 *
 *    US    21:00 – 06:00  (crosses midnight)                         *
 *    INDIA 09:30 – 18:30  (same day)                                 *
 * ------------------------------------------------------------------ */

export interface ShiftDef {
  process: ProcessCode;
  name: string;
  /** IANA timezone the start/end are expressed in */
  tz: string;
  /** "HH:MM" 24h */
  start: string;
  /** "HH:MM" 24h — EXCLUSIVE end */
  end: string;
  crossesMidnight: boolean;
}

const IST = IST_TZ;

function shiftDef(process: ProcessCode): ShiftDef {
  const w = shiftWindow(process);
  return {
    process,
    name: PROCESSES[process].shift,
    tz: IST,
    start: w.start,
    end: w.end,
    crossesMidnight: w.overnight,
  };
}

export const SHIFTS: Record<ProcessCode, ShiftDef> = {
  US: shiftDef("US"),
  UK: shiftDef("UK"),
  IN: shiftDef("IN"),
  AU: shiftDef("AU"),
};

function hhmmToMinutes(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/** Start/end of the shift as minutes-since-midnight IST. */
export function shiftMinutes(process: ProcessCode = "US"): {
  start: number;
  end: number;
  crossesMidnight: boolean;
} {
  const w = shiftWindow(process);
  return {
    start: hhmmToMinutes(w.start),
    end: hhmmToMinutes(w.end),
    crossesMidnight: w.overnight,
  };
}

/**
 * Does an instant fall INSIDE the operational shift window (IST)?
 * End is exclusive: US 06:00 and India 18:30 are OUTSIDE the shift.
 *
 *   US    21:00 → true · 23:59 → true · 02:00 → true · 05:59 → true · 06:00 → false
 *   INDIA 09:30 → true · 18:29 → true · 18:30 → false · 09:29 → false
 */
export function isWithinShift(
  instant: number | Date = Date.now(),
  process: ProcessCode = "US",
): boolean {
  const { hour, minute } = istParts(instant);
  const nowMin = hour * 60 + minute;
  const { start, end, crossesMidnight } = shiftMinutes(process);
  if (crossesMidnight) {
    // [start, 24:00) ∪ [00:00, end)
    return nowMin >= start || nowMin < end;
  }
  return nowMin >= start && nowMin < end;
}
