/**
 * Officeverse — gamification STREAK foundation (Phase 20). PURE.
 *
 * Phase 20 ships ONE streak type: ACCEPTED_LEAD_STREAK —
 *   "consecutive OPERATIONAL days with at least one accepted lead".
 *
 * The operational date is the server-authoritative SHIFT date (see
 * src/server/time.ts — a US overnight event at 02:00 IST belongs to the prior
 * calendar day). This pure function just receives that "YYYY-MM-DD" string and
 * does calendar-consecutive maths; the SERVICE derives the date.
 *
 * NOT attendance. A login / opening the CRM is never a streak event.
 * No grace period unless one is explicitly configured (none is).
 */

export const GAMIFICATION_STREAK_TYPES = ["ACCEPTED_LEAD_STREAK"] as const;
export type GamificationStreakType = (typeof GAMIFICATION_STREAK_TYPES)[number];

function ymdToUTC(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

/** whole calendar days from a → b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((ymdToUTC(b) - ymdToUTC(a)) / 86_400_000);
}

export interface StreakState {
  currentCount: number;
  bestCount: number;
  /** last operational date that satisfied the streak, or null */
  lastOperationalDate: string | null;
}

export interface StreakAdvance extends StreakState {
  /** did this call move the streak? (false for a same-day repeat) */
  changed: boolean;
  /** did the streak reset because a qualifying day was missed? */
  broke: boolean;
}

/**
 * Fold one qualifying event (on `todayOperationalDate`) into the streak.
 *   - first ever qualifying day → current = 1
 *   - same operational date as last → no change (idempotent; a duplicate
 *     accepted-lead the same day does NOT increment)
 *   - exactly the next calendar day → current += 1
 *   - a gap (>= 2 days), or an out-of-order earlier date → reset to 1 (break)
 *   - bestCount always tracks the max current seen
 */
export function advanceStreak(state: StreakState, todayOperationalDate: string): StreakAdvance {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayOperationalDate)) {
    throw new Error("todayOperationalDate must be YYYY-MM-DD");
  }
  const best0 = Math.max(0, Math.trunc(state.bestCount));
  const last = state.lastOperationalDate;

  if (!last) {
    return {
      currentCount: 1,
      bestCount: Math.max(best0, 1),
      lastOperationalDate: todayOperationalDate,
      changed: true,
      broke: false,
    };
  }

  const gap = daysBetween(last, todayOperationalDate);

  if (gap === 0) {
    // same operational day — nothing to do
    return {
      currentCount: Math.max(1, Math.trunc(state.currentCount)),
      bestCount: best0,
      lastOperationalDate: last,
      changed: false,
      broke: false,
    };
  }

  if (gap === 1) {
    const current = Math.max(1, Math.trunc(state.currentCount)) + 1;
    return {
      currentCount: current,
      bestCount: Math.max(best0, current),
      lastOperationalDate: todayOperationalDate,
      changed: true,
      broke: false,
    };
  }

  // gap >= 2 (missed a qualifying day) OR an earlier/out-of-order date → reset
  return {
    currentCount: 1,
    bestCount: Math.max(best0, 1),
    lastOperationalDate: todayOperationalDate,
    changed: true,
    broke: true,
  };
}

/**
 * Is the streak already broken as of `asOfOperationalDate` (i.e. more than one
 * day has passed with no qualifying event)? Used by a read/leaderboard view so
 * a stale `currentCount` is shown as 0.
 */
export function effectiveCurrent(state: StreakState, asOfOperationalDate: string): number {
  if (!state.lastOperationalDate) return 0;
  const gap = daysBetween(state.lastOperationalDate, asOfOperationalDate);
  if (gap <= 1) return Math.max(0, Math.trunc(state.currentCount));
  return 0;
}
