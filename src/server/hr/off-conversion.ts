/**
 * Officeverse — Late / Short-Attendance → Off conversion (Phase 11). PURE.
 *
 * FROZEN BUSINESS RULES:
 *   2 LATE               = 1 OFF   (LATE_CONVERSION)
 *   3 SHORT ATTENDANCE   = 1 OFF   (SHORT_ATTENDANCE_CONVERSION)
 *
 * The two counters are ALWAYS separate — 1 Late + 2 Short never becomes 1 Off.
 * Conversion is a floor division, so it is naturally idempotent: the same
 * monthly counts always yield the same deterministic list of Off records.
 * The service diffs this plan against the persisted rows (keyed by
 * user+type+month+index) so re-running never double-converts.
 */

export const LATE_PER_OFF = 2;
export const SHORT_PER_OFF = 3;

export type OffConversionType = "LATE_CONVERSION" | "SHORT_ATTENDANCE_CONVERSION";

export interface PlannedOff {
  offType: OffConversionType;
  /** 1-based ordinal within (user, offType, month) */
  offIndex: number;
  /** qualifying events consumed (2 for Late, 3 for Short) */
  sourceCount: number;
  sourceDescription: string;
}

export function lateOffs(lateCount: number): number {
  return Math.floor(Math.max(0, Math.trunc(lateCount)) / LATE_PER_OFF);
}

export function shortOffs(shortCount: number): number {
  return Math.floor(Math.max(0, Math.trunc(shortCount)) / SHORT_PER_OFF);
}

export interface OffPlanInput {
  periodMonth: string; // "YYYY-MM"
  lateCount: number;
  shortCount: number;
}

export interface OffPlan {
  lateCount: number;
  shortCount: number;
  lateOffCount: number;
  shortOffCount: number;
  records: PlannedOff[];
}

export function planOffRecords(input: OffPlanInput): OffPlan {
  const lateCount = Math.max(0, Math.trunc(input.lateCount));
  const shortCount = Math.max(0, Math.trunc(input.shortCount));
  const lateOffCount = lateOffs(lateCount);
  const shortOffCount = shortOffs(shortCount);

  const records: PlannedOff[] = [];
  for (let i = 1; i <= lateOffCount; i++) {
    records.push({
      offType: "LATE_CONVERSION",
      offIndex: i,
      sourceCount: LATE_PER_OFF,
      sourceDescription: `${LATE_PER_OFF} Late in ${input.periodMonth} (conversion #${i})`,
    });
  }
  for (let i = 1; i <= shortOffCount; i++) {
    records.push({
      offType: "SHORT_ATTENDANCE_CONVERSION",
      offIndex: i,
      sourceCount: SHORT_PER_OFF,
      sourceDescription: `${SHORT_PER_OFF} Short Attendance in ${input.periodMonth} (conversion #${i})`,
    });
  }

  return { lateCount, shortCount, lateOffCount, shortOffCount, records };
}
