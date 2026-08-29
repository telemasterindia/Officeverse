/**
 * Officeverse — CSV writer for Admin exports (Phase 8). PURE. No dependencies.
 *
 * RFC-4180 output: fields are quoted when they contain a comma, quote, CR or
 * LF; inner quotes are doubled. Values are emitted VERBATIM as text — leading
 * zeros in ZIPs / phone numbers / IDs are preserved (a spreadsheet app that
 * re-parses the CSV may still coerce them; XLSX is the type-safe format).
 */

export type CsvValue = string | number | null | undefined;

function cell(v: CsvValue): string {
  if (v == null) return "";
  const s = typeof v === "number" ? String(v) : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const out: string[] = [headers.map(cell).join(",")];
  for (const row of rows) out.push(row.map(cell).join(","));
  return out.join("\r\n") + "\r\n";
}
