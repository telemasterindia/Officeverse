/**
 * Officeverse — value normalization used for storage, search and
 * duplicate-detection. Shared so import (later phase) and the API agree.
 */

/** Digits only, last 15 (E.164 max). null when nothing usable. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(-15);
}

/** Trimmed, lower-cased. null when empty. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = String(raw).trim().toLowerCase();
  return e || null;
}
