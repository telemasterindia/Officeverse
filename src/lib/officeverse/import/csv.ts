/**
 * Officeverse — minimal RFC-4180 CSV reader (Phase 7). PURE, no dependencies.
 *
 * Only used for `.csv` uploads (`.xlsx` goes through exceljs). Treats every
 * cell as text — it never evaluates a formula or a cell reference.
 */

export interface ParsedGrid {
  headers: string[];
  /** data rows as objects keyed by the (trimmed) header */
  rows: Array<Record<string, string>>;
  rowCount: number;
}

/** Split raw CSV text into a 2-D string array (handles quotes, commas, newlines). */
export function parseCsvGrid(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, ""); // strip BOM
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    out.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushCell();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // trailing cell/row (unless the file ended exactly on a newline)
  if (cell.length > 0 || row.length > 0) pushRow();

  return out;
}

/** Parse CSV text into header-keyed row objects. Blank lines are dropped. */
export function parseCsv(input: string): ParsedGrid {
  const grid = parseCsvGrid(input).filter((r) => r.some((c) => c.trim() !== ""));
  if (grid.length === 0) return { headers: [], rows: [], rowCount: 0 };

  const headers = grid[0]!.map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]!;
    const obj: Record<string, string> = {};
    headers.forEach((h, c) => {
      if (!h) return;
      obj[h] = (cells[c] ?? "").trim();
    });
    rows.push(obj);
  }
  return { headers: headers.filter(Boolean), rows, rowCount: rows.length };
}
