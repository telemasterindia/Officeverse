/**
 * Officeverse — downloadable import template (Phase 7). PURE.
 * Columns + example row are generated from the real field catalog.
 */
import { fieldsForMode, type ImportMode } from "./fields";

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function templateColumns(mode: ImportMode): string[] {
  return fieldsForMode(mode).map((f) => f.key);
}

/** A 2-row CSV: header + one example row. */
export function templateCsv(mode: ImportMode): string {
  const fields = fieldsForMode(mode);
  const header = fields.map((f) => csvCell(f.key)).join(",");
  const example = fields.map((f) => csvCell(f.example)).join(",");
  return `${header}\r\n${example}\r\n`;
}

export function templateFileName(mode: ImportMode): string {
  return `officeverse-import-template-${mode}.csv`;
}

/** Human-readable notes for the mapping screen / template help. */
export function templateNotes(
  mode: ImportMode,
): Array<{ field: string; required: boolean; note: string }> {
  return fieldsForMode(mode).map((f) => ({
    field: f.key,
    required: f.requiredIn.includes(mode),
    note: f.note ?? "",
  }));
}
