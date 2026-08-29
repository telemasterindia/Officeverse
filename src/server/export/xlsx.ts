/**
 * Officeverse — XLSX writer for Admin exports (Phase 8).
 *
 * Uses `exceljs` (already a dependency). Columns flagged `text` get the Excel
 * text number-format ("@") and string values, so ZIPs / phone numbers / IDs
 * keep leading zeros and never turn into scientific notation. Every non-text
 * cell is coerced through `cellText` first, so `[object Object]` can never
 * appear.
 */
import type { ColumnDef } from "@/lib/officeverse/export/datasets";
import { cellText } from "@/lib/officeverse/export/format";

export async function buildXlsx(
  sheetName: string,
  columns: ColumnDef[],
  rows: Array<Record<string, unknown>>,
): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Officeverse";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31) || "Export", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: Math.min(48, Math.max(12, c.header.length + 4)),
    style: c.text ? { numFmt: "@" } : {},
  }));

  for (const row of rows) {
    const values: Record<string, string> = {};
    for (const c of columns) values[c.key] = cellText(row[c.key]);
    ws.addRow(values);
  }

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  if (rows.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
