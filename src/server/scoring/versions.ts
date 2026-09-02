/**
 * Officeverse — Scoring Engine RULE VERSION selection (Phase 2). PURE.
 *
 * Selection is keyed on `BusinessEvent.operationalDate` (the server shift date),
 * NEVER on `occurredAtMs`. The window is half-open:
 *
 *     effective_from <= operationalDate AND (effective_until IS NULL OR
 *     operationalDate < effective_until)
 *
 * Editing a rule appends a new immutable version and closes the previous one's
 * `effective_until` at the new `effective_from`, so windows never overlap. If
 * two somehow overlap a date (defensive), the HIGHER `version` wins. Historical
 * ledger rows are never rewritten because a newer version exists.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export interface RuleVersionLike {
  version: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

export function isYmd(s: unknown): s is string {
  return typeof s === "string" && YMD.test(s);
}

/** The version effective on `operationalDate`, or undefined when none is. */
export function selectVersionForDate<T extends RuleVersionLike>(
  versions: readonly T[],
  operationalDate: string,
): T | undefined {
  if (!isYmd(operationalDate)) return undefined;
  const applicable = versions.filter(
    (v) =>
      isYmd(v.effectiveFrom) &&
      v.effectiveFrom <= operationalDate &&
      (v.effectiveUntil === null ||
        v.effectiveUntil === undefined ||
        (isYmd(v.effectiveUntil) && operationalDate < v.effectiveUntil)),
  );
  if (applicable.length === 0) return undefined;
  return applicable.reduce((best, v) => (v.version > best.version ? v : best));
}

/**
 * Would a new version starting on `from` overlap any existing OPEN or
 * future-closing window? Used at save time to keep windows disjoint.
 */
export function wouldOverlap(existing: readonly RuleVersionLike[], from: string): boolean {
  if (!isYmd(from)) return false;
  return existing.some(
    (v) =>
      isYmd(v.effectiveFrom) &&
      (v.effectiveUntil === null ||
        v.effectiveUntil === undefined ||
        (isYmd(v.effectiveUntil) && from < v.effectiveUntil)) &&
      v.effectiveFrom <= from,
  );
}

/**
 * Close the currently-open version at `from` (exclusive upper bound). Returns a
 * shallow copy with `effectiveUntil` set; the caller persists it. The original
 * object is not mutated (immutable-history discipline at the call site).
 */
export function closePreviousAt<T extends RuleVersionLike>(open: T, from: string): T {
  return { ...open, effectiveUntil: from };
}
