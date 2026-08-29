/**
 * Officeverse — turn holiday ROWS into the effective non-working-day map that
 * the Phase-11 connected-non-working engine consumes (Phase 12). PURE.
 *
 *   - only ACTIVE holidays
 *   - a holiday applies to a process when applies_to_process IS NULL
 *     (company-wide) OR equals that process
 *   - the EFFECTIVE date is observed_date ?? holiday_date, so an actual date on
 *     a weekend + its observed weekday are never both counted as one holiday
 *
 * There is NO new sandwich algorithm here — this only supplies data to the
 * existing `holidayAwareProvider` / `expandSandwich`.
 */

export interface HolidayRowLike {
  holidayDate: string;
  observedDate: string | null;
  holidayType: string;
  appliesToProcess: string | null;
  active: boolean;
}

export function effectiveHolidayDate(
  row: Pick<HolidayRowLike, "holidayDate" | "observedDate">,
): string {
  return row.observedDate ?? row.holidayDate;
}

export function holidayAppliesToProcess(
  row: Pick<HolidayRowLike, "appliesToProcess">,
  process: string,
): boolean {
  return row.appliesToProcess == null || row.appliesToProcess === process;
}

/** effective "YYYY-MM-DD" → { reason } for the given process. Inactive + other-
 *  process holidays are excluded. */
export function buildHolidayMap(
  rows: HolidayRowLike[],
  process: string,
): Map<string, { reason: string }> {
  const map = new Map<string, { reason: string }>();
  for (const row of rows) {
    if (!row.active) continue;
    if (!holidayAppliesToProcess(row, process)) continue;
    map.set(effectiveHolidayDate(row), { reason: row.holidayType });
  }
  return map;
}
