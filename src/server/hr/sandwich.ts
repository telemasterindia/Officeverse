/**
 * Officeverse — approved-leave → leave_days planner (Phase 11). PURE.
 *
 * Expands each APPROVED leave request's [start, end] into ORIGINAL days, then
 * runs the ONE connected-non-working engine over the union of every approved
 * leave date to find SANDWICH days. Each sandwich day is attributed to the
 * NEAREST original leave date's request (tie → the earlier date) so the audit
 * trail always points back to a real leave record. The employee's original
 * request row is never touched — this is the derived, idempotent view.
 */
import { addCalendarDays, expandSandwich, type NonWorkingProvider } from "./non-working";

export interface ApprovedLeaveInput {
  id: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

export type PlannedLeaveDayType = "ORIGINAL" | "SANDWICH_WEEKEND" | "SANDWICH_HOLIDAY";

export interface PlannedLeaveDay {
  leaveRequestId: number;
  leaveDate: string;
  dayType: PlannedLeaveDayType;
  nonWorkingReason: string | null;
}

const HOLIDAY_REASONS = new Set(["US_FEDERAL", "INDIAN", "COMPANY", "WEEKLY_OFF"]);

function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const [a, b] = start <= end ? [start, end] : [end, start];
  for (let d = a; d <= b; d = addCalendarDays(d, 1)) out.push(d);
  return out;
}

function diffDays(a: string, b: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((p(a) - p(b)) / 86_400_000);
}

export interface LeaveDaysPlan {
  /** every planned day, flat */
  days: PlannedLeaveDay[];
  /** grouped by owning leave request — the recompute unit */
  byRequest: Map<number, PlannedLeaveDay[]>;
  /** union of ORIGINAL + SANDWICH dates (for counters) */
  allLeaveDates: string[];
}

export function planLeaveDays(
  approved: ApprovedLeaveInput[],
  provider: NonWorkingProvider,
): LeaveDaysPlan {
  const originalByDate = new Map<string, number>(); // date → owning request id
  const originalDates: string[] = [];
  // if two requests overlap a date, the earlier request id wins (deterministic)
  const sortedReqs = [...approved].sort(
    (x, y) => x.startDate.localeCompare(y.startDate) || x.id - y.id,
  );
  for (const req of sortedReqs) {
    for (const d of eachDate(req.startDate, req.endDate)) {
      if (!originalByDate.has(d)) {
        originalByDate.set(d, req.id);
        originalDates.push(d);
      }
    }
  }
  originalDates.sort();

  const days: PlannedLeaveDay[] = [];
  for (const d of originalDates) {
    days.push({
      leaveRequestId: originalByDate.get(d)!,
      leaveDate: d,
      dayType: "ORIGINAL",
      nonWorkingReason: null,
    });
  }

  const { sandwich } = expandSandwich(originalDates, provider);
  for (const s of sandwich) {
    // attribute to the nearest original leave date; tie → earlier date
    let bestDate = originalDates[0]!;
    let bestDist = Math.abs(diffDays(s.date, bestDate));
    for (const od of originalDates) {
      const dist = Math.abs(diffDays(s.date, od));
      if (dist < bestDist || (dist === bestDist && od < bestDate)) {
        bestDist = dist;
        bestDate = od;
      }
    }
    days.push({
      leaveRequestId: originalByDate.get(bestDate)!,
      leaveDate: s.date,
      dayType: HOLIDAY_REASONS.has(s.reason) ? "SANDWICH_HOLIDAY" : "SANDWICH_WEEKEND",
      nonWorkingReason: s.reason || null,
    });
  }

  const byRequest = new Map<number, PlannedLeaveDay[]>();
  for (const day of days) {
    const list = byRequest.get(day.leaveRequestId);
    if (list) list.push(day);
    else byRequest.set(day.leaveRequestId, [day]);
  }
  for (const list of byRequest.values())
    list.sort((x, y) => x.leaveDate.localeCompare(y.leaveDate));

  return {
    days: days.sort((x, y) => x.leaveDate.localeCompare(y.leaveDate)),
    byRequest,
    allLeaveDates: [...new Set(days.map((d) => d.leaveDate))].sort(),
  };
}
