/**
 * Officeverse — client-safe US (NANP) phone + email helpers.  PURE.
 *
 * The AUTHORITATIVE validation lives in `src/server/validation/phone.ts`
 * (which re-exports these). This module carries no server imports so the
 * New-Customer form can validate inline for UX — the server always re-checks.
 */

/**
 * Canonical 10 NANP digits for `raw`, or `null` when it is not a valid US number.
 *   - strips every non-digit
 *   - a leading `1` on an 11-digit value is the country code → dropped
 *   - must then be exactly 10 digits
 *   - NANP: area-code and central-office-code first digit is 2–9
 */
export function usPhoneDigits(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  return d;
}

export function isValidUsPhone(raw: string | null | undefined): boolean {
  return usPhoneDigits(raw) != null;
}

/** Pretty `(NNN) NNN-NNNN` from any accepted input; echoes back on invalid. */
export function formatUsPhone(raw: string): string {
  const d = usPhoneDigits(raw);
  if (!d) return raw;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Practical email shape check — matches the server's Zod `.email()` closely
 *  enough for inline UX. The server remains authoritative. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(raw: string | null | undefined): boolean {
  const e = String(raw ?? "").trim();
  return e.length > 0 && e.length <= 191 && EMAIL_RE.test(e);
}
