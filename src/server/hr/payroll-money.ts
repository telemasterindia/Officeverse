/**
 * Officeverse — the ONE payroll rounding + money policy (Phase 16). PURE.
 *
 * POLICY (explicit, deterministic, documented in the payroll UI + tests):
 *   - every payroll component is computed in INTEGER PAISE (₹1 = 100 paise);
 *     there is no floating-point arithmetic on rupee values in the engine.
 *   - a value that carries a sub-paise fraction (only a proration division can)
 *     is rounded HALF-UP to the nearest paise.
 *   - all components use the SAME rounding; the final gross is the exact
 *     integer-paise sum of the rounded components (no separate final rounding).
 *
 * `decimal(12,2)` DB columns store the paise value as a "12345.67" string.
 */

export const PAYROLL_ROUNDING_POLICY =
  "All amounts are computed in integer paise. Sub-paise fractions (only from proration) are rounded half-up to the nearest paise. The gross is the exact sum of the rounded components.";

/** "30000" | "30000.5" | 30000.5 → 3000050 (paise). Rejects non-finite / < 0. */
export function toPaise(rupees: string | number): number {
  const n = typeof rupees === "string" ? Number(rupees) : rupees;
  if (!Number.isFinite(n)) throw new Error("amount must be a finite number");
  if (n < 0) throw new Error("amount must be >= 0");
  // scale by 100 then round half-up to kill binary-float dust (e.g. 30000.5*100)
  return Math.round(n * 100 + Number.EPSILON);
}

/** signed rupee value → paise (used for adjustments, which may be negative). */
export function toSignedPaise(rupees: string | number): number {
  const n = typeof rupees === "string" ? Number(rupees) : rupees;
  if (!Number.isFinite(n)) throw new Error("amount must be a finite number");
  const sign = n < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(n) * 100 + Number.EPSILON);
}

/** paise → "12345.67" (exactly 2 dp), suitable for a decimal(12,2) column. */
export function paiseToAmount(paise: number): string {
  if (!Number.isInteger(paise)) throw new Error("paise must be an integer");
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}

/** round a rupee amount that may carry sub-paise → whole paise (HALF-UP). */
export function roundToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) throw new Error("amount must be a finite number");
  const sign = rupees < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(rupees) * 100 + 0.5);
}

/** exact integer-paise sum. */
export function sumPaise(...values: number[]): number {
  return values.reduce((acc, v) => {
    if (!Number.isInteger(v)) throw new Error("sumPaise expects integer paise");
    return acc + v;
  }, 0);
}

/** proration: monthlyPaise * numerator / denominator, HALF-UP to whole paise. */
export function proratePaise(monthlyPaise: number, numerator: number, denominator: number): number {
  if (!Number.isInteger(monthlyPaise)) throw new Error("monthlyPaise must be integer paise");
  if (!Number.isInteger(numerator) || numerator < 0) throw new Error("numerator must be >= 0");
  if (!Number.isInteger(denominator) || denominator <= 0) {
    throw new Error("denominator must be > 0");
  }
  if (numerator >= denominator) return monthlyPaise;
  // product stays well inside Number.MAX_SAFE_INTEGER for the ₹10M / 31-day cap;
  // Math.round is half-up, matching PAYROLL_ROUNDING_POLICY.
  return Math.round((monthlyPaise * numerator) / denominator);
}
