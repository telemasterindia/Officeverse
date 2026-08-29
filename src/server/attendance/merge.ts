/**
 * Officeverse — session interval merge for attendance duration (Phase 10). PURE.
 *
 * Multiple browser/device sessions overlap. Their union — not their sum — is the
 * real time an employee was present, so overlapping sessions never double-count.
 */

export interface Interval {
  startMs: number;
  endMs: number;
}

/** Total minutes covered by the UNION of the given intervals (rounded down). */
export function mergedMinutes(intervals: Interval[]): number {
  return Math.floor(mergedMs(intervals) / 60_000);
}

/** Total milliseconds covered by the union of the given intervals. */
export function mergedMs(intervals: Interval[]): number {
  const clean = intervals
    .filter((i) => Number.isFinite(i.startMs) && Number.isFinite(i.endMs) && i.endMs > i.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (clean.length === 0) return 0;

  let total = 0;
  let curStart = clean[0]!.startMs;
  let curEnd = clean[0]!.endMs;
  for (let i = 1; i < clean.length; i++) {
    const iv = clean[i]!;
    if (iv.startMs <= curEnd) {
      if (iv.endMs > curEnd) curEnd = iv.endMs;
    } else {
      total += curEnd - curStart;
      curStart = iv.startMs;
      curEnd = iv.endMs;
    }
  }
  total += curEnd - curStart;
  return total;
}
