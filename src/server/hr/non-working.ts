/**
 * Officeverse — generic CONNECTED NON-WORKING-BLOCK engine (Phase 11). PURE.
 *
 * ONE algorithm for every "sandwich" case (weekend, holiday, weekend+holiday,
 * consecutive company non-working days). It is calendar-driven, not hard-coded
 * around specific weekdays.
 *
 * A non-working day is "sandwich" leave iff it is connected — through non-
 * working days ONLY — to an APPROVED leave date on its left OR its right.
 * An ordinary working day between two leaves breaks the chain: the two leave
 * events stay separate.
 *
 *   Fri LEAVE · Sat WE · Sun WE · Mon PRESENT      → Sat, Sun count
 *   Fri PRESENT · Sat WE · Sun WE · Mon LEAVE      → Sat, Sun count
 *   Fri LEAVE · Sat WE · Sun WE · Mon LEAVE        → Sat, Sun count (4 total)
 *   Fri LEAVE · Sat WE · Sun WE · Mon PRESENT · Tue LEAVE → Sat, Sun count for
 *     the Friday block only; Monday working, Tuesday separate.
 *
 * Holidays are just non-working days supplied by the provider — Phase 11 ships
 * the abstraction with ZERO real dates (weekends work with no data).
 */

/** UTC-safe day of week: 0 = Sunday … 6 = Saturday */
export function dayOfWeek(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

export function isWeekend(ymd: string): boolean {
  const w = dayOfWeek(ymd);
  return w === 0 || w === 6;
}

export function addCalendarDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + delta)).toISOString().slice(0, 10);
}

export interface NonWorkingInfo {
  nonWorking: boolean;
  /** SATURDAY / SUNDAY / US_FEDERAL / COMPANY / … — for the audit trail */
  reason: string;
}
export type NonWorkingProvider = (ymd: string) => NonWorkingInfo;

/** Weekend-only provider — always available, needs no data. */
export const weekendProvider: NonWorkingProvider = (ymd) => {
  const w = dayOfWeek(ymd);
  if (w === 0) return { nonWorking: true, reason: "SUNDAY" };
  if (w === 6) return { nonWorking: true, reason: "SATURDAY" };
  return { nonWorking: false, reason: "" };
};

/** Weekend OR a supplied holiday map ("YYYY-MM-DD" → { reason }). */
export function holidayAwareProvider(
  holidays: ReadonlyMap<string, { reason: string }>,
): NonWorkingProvider {
  return (ymd) => {
    const we = weekendProvider(ymd);
    if (we.nonWorking) return we;
    const h = holidays.get(ymd);
    return h ? { nonWorking: true, reason: h.reason } : { nonWorking: false, reason: "" };
  };
}

export type DayClass = "LEAVE" | "NON_WORKING" | "WORKING";

export interface SandwichDay {
  date: string;
  reason: string;
}

export interface SandwichResult {
  sandwich: SandwichDay[];
  timeline: Record<string, DayClass>;
}

const DEFAULT_WINDOW_DAYS = 14;

export function expandSandwich(
  leaveDates: Iterable<string>,
  provider: NonWorkingProvider = weekendProvider,
  opts: { windowDays?: number } = {},
): SandwichResult {
  const leave = new Set([...leaveDates]);
  if (leave.size === 0) return { sandwich: [], timeline: {} };

  const sorted = [...leave].sort();
  const window = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const lo = addCalendarDays(sorted[0]!, -window);
  const hi = addCalendarDays(sorted[sorted.length - 1]!, window);

  const timeline: Record<string, DayClass> = {};
  for (let d = lo; d <= hi; d = addCalendarDays(d, 1)) {
    timeline[d] = leave.has(d) ? "LEAVE" : provider(d).nonWorking ? "NON_WORKING" : "WORKING";
  }

  const connectsToLeave = (from: string, step: 1 | -1): boolean => {
    let cur = addCalendarDays(from, step);
    while (cur >= lo && cur <= hi) {
      const cls = timeline[cur];
      if (cls === "LEAVE") return true;
      if (cls === "NON_WORKING") {
        cur = addCalendarDays(cur, step);
        continue;
      }
      return false; // WORKING → chain broken
    }
    return false;
  };

  const sandwich: SandwichDay[] = [];
  for (let d = lo; d <= hi; d = addCalendarDays(d, 1)) {
    if (timeline[d] !== "NON_WORKING") continue;
    if (connectsToLeave(d, -1) || connectsToLeave(d, 1)) {
      sandwich.push({ date: d, reason: provider(d).reason });
    }
  }

  return { sandwich, timeline };
}
