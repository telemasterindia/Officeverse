/**
 * Officeverse — salary-slip PDF renderer (Phase 14). PURE, deterministic,
 * zero dependencies.
 *
 * Emits a minimal, valid single-page A4 PDF (PDF 1.4) with the WinAnsi base-14
 * Helvetica fonts — no images, no embedded fonts, no external assets. The same
 * input always produces byte-identical output, so a stored slip can be
 * re-rendered exactly if the document store loses the blob.
 *
 * Currency is written as "INR 30,000.00" — the base-14 fonts do not carry the ₹
 * glyph, so the UI / email show ₹ while the printable PDF stays unambiguous.
 */
import { createHash } from "node:crypto";

export interface SalarySlipPdfData {
  employeeName: string;
  userId: number;
  process: string;
  periodMonth: string; // "YYYY-MM"
  baseSalary: string; // "30000.00"
  regularityBonus: number; // whole rupees
  calculatedSalary: string; // "31000.00"
  leaveCount: number;
  offCount: number;
  payrollStatus: string;
  calculationVersion: string;
  slipVersion: number;
  isPreview: boolean;
  generatedAt: string; // IST wall-clock "YYYY-MM-DD HH:MM:SS"
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthLabel(periodMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodMonth);
  if (!m) return periodMonth;
  const idx = Number(m[2]) - 1;
  return `${MONTHS[idx] ?? m[2]} ${m[1]}`;
}

/** "30000.00" / 31000 → "INR 30,000.00" */
export function formatInr(amount: string | number): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "INR 0.00";
  const fixed = n.toFixed(2);
  const [whole, frac] = fixed.split(".");
  const withSep = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `INR ${withSep}.${frac}`;
}

/* ---- PDF plumbing ------------------------------------------------- */

function pdfEscape(s: string): string {
  // strip anything outside printable Latin-1 so the base-14 fonts stay happy
  return s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7E]/g, "");
}

interface Line {
  text: string;
  size: number;
  bold: boolean;
  gapBefore: number; // extra points before this line
}

function contentStream(lines: Line[]): string {
  let y = 800;
  let out = "";
  for (const ln of lines) {
    y -= ln.gapBefore + ln.size + 4;
    const font = ln.bold ? "/F2" : "/F1";
    out += `BT ${font} ${ln.size} Tf 1 0 0 1 56 ${y} Tm (${pdfEscape(ln.text)}) Tj ET\n`;
  }
  return out;
}

export function renderSalarySlipPdf(data: SalarySlipPdfData): Uint8Array {
  const rows: Array<[string, string]> = [
    ["Employee Name", data.employeeName],
    ["User ID", String(data.userId)],
    ["Process", data.process],
    ["Payroll Month", monthLabel(data.periodMonth)],
    ["", ""],
    ["Base Salary", formatInr(data.baseSalary)],
    ["Leave Days", String(data.leaveCount)],
    ["Off Days", String(data.offCount)],
    ["Regularity Bonus", formatInr(data.regularityBonus)],
    ["", ""],
    ["Calculated Salary (before deductions)", formatInr(data.calculatedSalary)],
    ["", ""],
    ["Payroll Status", data.payrollStatus],
    ["Calculation Version", data.calculationVersion],
    ["Salary Slip Version", String(data.slipVersion)],
    ["Generated", data.generatedAt],
  ];

  const lines: Line[] = [
    { text: "OFFICEVERSE", size: 22, bold: true, gapBefore: 0 },
    {
      text: data.isPreview ? "Salary Slip (PREVIEW - not final)" : "Salary Slip",
      size: 14,
      bold: false,
      gapBefore: 2,
    },
    { text: "", size: 6, bold: false, gapBefore: 0 },
  ];
  for (const [label, value] of rows) {
    if (label === "") {
      lines.push({ text: "", size: 6, bold: false, gapBefore: 0 });
      continue;
    }
    lines.push({ text: `${label}:  ${value}`, size: 11, bold: false, gapBefore: 2 });
  }
  lines.push({ text: "", size: 10, bold: false, gapBefore: 0 });
  lines.push({
    text: "This salary slip reflects the recorded payroll snapshot for the month.",
    size: 9,
    bold: false,
    gapBefore: 8,
  });
  lines.push({
    text: "It is a salary-before-deductions figure and is not a statutory payslip.",
    size: 9,
    bold: false,
    gapBefore: 2,
  });

  const content = contentStream(lines);
  const contentBytes = utf8(content);

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(byteLen(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = byteLen(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return utf8(pdf);
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function byteLen(s: string): number {
  return utf8(s).length;
}

/** SHA-256 hex of the generated bytes — a stable integrity fingerprint stored
 *  on the slip row so a re-render can be verified identical. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
