/**
 * Officeverse — client-side file reader for bulk import (Phase 7).
 *
 * Reads `.csv` (pure) and `.xlsx` (exceljs) into header-keyed string rows.
 * Enforces file-type, size and row-count limits BEFORE anything is sent to the
 * server. The server re-validates every cell regardless — this is a UX guard,
 * not the security boundary. Spreadsheet content is always treated as data:
 * formula cells contribute their cached RESULT, never the formula text.
 */
import { parseCsv } from "./csv";

export const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_ROWS = 20_000;

export interface ParsedFile {
  fileName: string;
  fileType: "csv" | "xlsx";
  headers: string[];
  rows: Array<Record<string, string>>;
  rowCount: number;
  truncated: boolean;
}

export class ImportFileError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ImportFileError";
  }
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1]!.toLowerCase() : "";
}

function cap<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  return rows.length > MAX_ROWS
    ? { rows: rows.slice(0, MAX_ROWS), truncated: true }
    : { rows, truncated: false };
}

export async function parseImportFile(file: File): Promise<ParsedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportFileError(
      "file_too_large",
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    );
  }
  const ext = extOf(file.name);

  if (ext === "csv") {
    const text = await file.text();
    const { headers, rows } = parseCsv(text);
    if (headers.length === 0)
      throw new ImportFileError("empty_file", "The file has no header row.");
    const { rows: bounded, truncated } = cap(rows);
    return {
      fileName: file.name,
      fileType: "csv",
      headers,
      rows: bounded,
      rowCount: bounded.length,
      truncated,
    };
  }

  if (ext === "xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) throw new ImportFileError("empty_file", "The workbook has no sheets.");

    const cellText = (v: unknown): string => {
      if (v == null) return "";
      if (typeof v === "object") {
        const o = v as Record<string, unknown>;
        if ("text" in o) return String(o["text"] ?? "");
        if ("result" in o) return o["result"] == null ? "" : String(o["result"]); // formula → cached result only
        if ("richText" in o && Array.isArray(o["richText"])) {
          return (o["richText"] as Array<{ text?: string }>).map((p) => p.text ?? "").join("");
        }
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if ("hyperlink" in o) return String(o["text"] ?? o["hyperlink"] ?? "");
      }
      return String(v);
    };

    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = cellText(cell.value).trim();
    });
    const cleanHeaders = headers.map((h) => h ?? "").map((h) => h.trim());
    if (!cleanHeaders.some(Boolean)) {
      throw new ImportFileError("empty_file", "The first sheet has no header row.");
    }

    const rows: Array<Record<string, string>> = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const obj: Record<string, string> = {};
      let any = false;
      cleanHeaders.forEach((h, idx) => {
        if (!h) return;
        const val = cellText(row.getCell(idx + 1).value).trim();
        if (val) any = true;
        obj[h] = val;
      });
      if (any) rows.push(obj);
    }
    const { rows: bounded, truncated } = cap(rows);
    return {
      fileName: file.name,
      fileType: "xlsx",
      headers: cleanHeaders.filter(Boolean),
      rows: bounded,
      rowCount: bounded.length,
      truncated,
    };
  }

  throw new ImportFileError("bad_file_type", "Only .csv and .xlsx files are supported.");
}
