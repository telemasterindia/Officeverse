/**
 * Officeverse — US Federal holiday calendar RULES (Phase 12). PURE. No DB.
 *
 * The 11 US federal holidays are generated from the OFFICIAL definitions —
 * fixed-date, "nth weekday", and "last weekday" — for any year, plus the
 * federal weekend-observance rule (Saturday → observed the Friday before,
 * Sunday → observed the Monday after). No dates are hard-coded.
 *
 * These feed `holidays` as holiday_type = "US_FEDERAL", applies_to_process =
 * "US". `observed_date` is stored when it differs from the actual date so the
 * sandwich engine counts the effective day once and the record stays auditable.
 */

export function dayOfWeekUTC(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0=Sun … 6=Sat
}

function ymd(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

/** The date of the `n`-th `weekday` (0=Sun … 6=Sat) of `month` in `year`. */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (weekday - firstDow + 7) % 7;
  return ymd(year, month, 1 + offset + (n - 1) * 7);
}

/** The date of the LAST `weekday` of `month` in `year`. */
export function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  const back = (lastDow - weekday + 7) % 7;
  return ymd(year, month, lastDay - back);
}

/** Federal weekend-observance rule. */
export function federalObservedDate(actualYMD: string): string {
  const dow = dayOfWeekUTC(actualYMD);
  const [y, m, d] = actualYMD.split("-").map(Number);
  if (dow === 6) return ymd(y!, m!, d! - 1); // Saturday → Friday
  if (dow === 0) return ymd(y!, m!, d! + 1); // Sunday → Monday
  return actualYMD;
}

export interface FederalHoliday {
  name: string;
  actualDate: string;
  observedDate: string;
  observed: boolean; // observedDate !== actualDate
}

const MON = 1;
const THU = 4;

/** All 11 US federal holidays for `year`, rule-derived. */
export function usFederalHolidays(year: number): FederalHoliday[] {
  const defs: Array<{ name: string; actual: string }> = [
    { name: "New Year's Day", actual: ymd(year, 1, 1) },
    { name: "Birthday of Martin Luther King, Jr.", actual: nthWeekdayOfMonth(year, 1, MON, 3) },
    { name: "Washington's Birthday", actual: nthWeekdayOfMonth(year, 2, MON, 3) },
    { name: "Memorial Day", actual: lastWeekdayOfMonth(year, 5, MON) },
    { name: "Juneteenth National Independence Day", actual: ymd(year, 6, 19) },
    { name: "Independence Day", actual: ymd(year, 7, 4) },
    { name: "Labor Day", actual: nthWeekdayOfMonth(year, 9, MON, 1) },
    { name: "Columbus Day", actual: nthWeekdayOfMonth(year, 10, MON, 2) },
    { name: "Veterans Day", actual: ymd(year, 11, 11) },
    { name: "Thanksgiving Day", actual: nthWeekdayOfMonth(year, 11, THU, 4) },
    { name: "Christmas Day", actual: ymd(year, 12, 25) },
  ];
  return defs.map((h) => {
    const observedDate = federalObservedDate(h.actual);
    return {
      name: h.name,
      actualDate: h.actual,
      observedDate,
      observed: observedDate !== h.actual,
    };
  });
}
