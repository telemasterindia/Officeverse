/**
 * Officeverse — export cell formatting (Phase 8). PURE.
 *
 * Guarantees no `[object Object]` ever reaches a file, dates stay readable, and
 * identity-ish values (codes / phones / ZIPs) survive as text.
 */

/** Coerce any DB value to a safe display string. Never "[object Object]". */
export function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
  // arrays / plain objects: compact JSON, never the "[object Object]" string
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

/** Trim seconds off an IST wall-clock "YYYY-MM-DD HH:MM:SS" for readability. */
export function fmtDateTime(wall: unknown): string {
  const s = cellText(wall);
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(s);
  return m ? `${m[1]} ${m[2]}` : s;
}

/** A plain calendar date "YYYY-MM-DD" (already how `date` columns are stored). */
export function fmtDate(wall: unknown): string {
  const s = cellText(wall);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1]! : s;
}

/** Force a value to be treated as text (codes, phones, ZIPs). */
export function textValue(v: unknown): string {
  return cellText(v);
}
