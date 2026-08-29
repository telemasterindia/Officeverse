/**
 * Officeverse — salary proration engine (Phase 16). PURE, deterministic.
 * NEVER reads the current date — proration is driven by historical employment
 * dates and the payroll month only.
 *
 * BUSINESS DECISION STILL OPEN: the proration DENOMINATOR (calendar days vs
 * working days vs scheduled working days) has not been defined by the business.
 * This engine therefore takes the basis as an EXPLICIT parameter and the only
 * fully-specified basis — CALENDAR_DAYS (all days in the month) — is
 * implemented. When no basis is supplied, `applied` is false and the full
 * monthly base is payable (no behavioural change vs Phase 13).
 */

export const PRORATION_BASES = ["CALENDAR_DAYS"] as const;
export type ProrationBasis = (typeof PRORATION_BASES)[number];

export interface EmploymentPeriodLike {
  /** inclusive first day worked, "YYYY-MM-DD" */
  startDate: string;
  /** inclusive last day worked, or null = still employed */
  endDate: string | null;
  active: boolean;
}

/* ------------------------------- calendar --------------------------- */

/** days in "YYYY-MM" (handles 28/29/30/31 + leap years). */
export function daysInMonth(month: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error("month must be YYYY-MM");
  const y = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) throw new Error("month out of range");
  return new Date(Date.UTC(y, mm, 0)).getUTCDate();
}

function monthBounds(month: string): { first: string; last: string } {
  return { first: `${month}-01`, last: `${month}-${String(daysInMonth(month)).padStart(2, "0")}` };
}

/**
 * Count the calendar days of `month` covered by ANY active employment period.
 * Overlapping periods are merged so a day is never counted twice.
 */
export function coveredCalendarDays(month: string, periods: EmploymentPeriodLike[]): number {
  const { first, last } = monthBounds(month);
  const clamped = periods
    .filter((p) => p.active && /^\d{4}-\d{2}-\d{2}$/.test(p.startDate))
    .map((p) => {
      const s = p.startDate < first ? first : p.startDate;
      const e = p.endDate == null || p.endDate > last ? last : p.endDate;
      return { s, e };
    })
    .filter((r) => r.s <= r.e)
    .sort((a, b) => a.s.localeCompare(b.s));

  let covered = 0;
  let cursor: string | null = null; // last day already counted
  for (const { s, e } of clamped) {
    const from = cursor && s <= cursor ? nextDay(cursor) : s;
    if (from > e) continue;
    covered += dayDiffInclusive(from, e);
    cursor = e;
  }
  return covered;
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}
function dayDiffInclusive(from: string, to: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((p(to) - p(from)) / 86_400_000) + 1;
}

/* ------------------------------ proration -------------------------- */

export interface ProrationInput {
  /** full-month base salary in integer PAISE */
  monthlyBasePaise: number;
  month: string; // "YYYY-MM"
  employmentPeriods: EmploymentPeriodLike[];
  /** omit / null → no proration is applied */
  basis?: ProrationBasis | null | undefined;
}

export interface ProrationResult {
  /** integer paise actually payable for the month */
  payableBasePaise: number;
  applied: boolean;
  basis: ProrationBasis | null;
  numerator: number; // days present
  denominator: number; // days in the basis
}

export function prorateBaseSalary(input: ProrationInput): ProrationResult {
  if (!Number.isInteger(input.monthlyBasePaise) || input.monthlyBasePaise < 0) {
    throw new Error("monthlyBasePaise must be a non-negative integer");
  }
  const noProration: ProrationResult = {
    payableBasePaise: input.monthlyBasePaise,
    applied: false,
    basis: null,
    numerator: 0,
    denominator: 0,
  };

  if (!input.basis) return noProration;
  if (input.basis !== "CALENDAR_DAYS") {
    // other bases are an undefined business decision — do not guess
    throw new Error(`proration basis "${input.basis}" is not implemented`);
  }
  const periods = (input.employmentPeriods ?? []).filter((p) => p.active);
  if (periods.length === 0) return noProration; // nothing to prorate against

  const denominator = daysInMonth(input.month);
  const numerator = coveredCalendarDays(input.month, periods);

  if (numerator >= denominator) {
    return {
      payableBasePaise: input.monthlyBasePaise,
      applied: true,
      basis: "CALENDAR_DAYS",
      numerator,
      denominator,
    };
  }
  const payable =
    numerator <= 0 ? 0 : Math.round((input.monthlyBasePaise * numerator) / denominator);
  return {
    payableBasePaise: payable,
    applied: true,
    basis: "CALENDAR_DAYS",
    numerator,
    denominator,
  };
}
