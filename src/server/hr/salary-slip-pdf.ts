/**
 * Officeverse — salary-slip PDF renderer (Phase 14 · extended Admin UAT Batch-2
 * follow-up §3). PURE, deterministic.
 *
 * Emits a valid single-page A4 PDF (PDF 1.4). Fonts are the WinAnsi base-14
 * Helvetica (no embedded fonts). The ONLY external asset is the central company
 * logo — embedded as an image XObject from bytes that are SNAPSHOTTED onto the
 * salary_slips row, so the same input always produces byte-identical output and
 * a stored slip can be re-rendered exactly.
 *
 *   - JPEG logo  → embedded directly via /DCTDecode
 *   - PNG  logo  → decoded here (pure integer maths: zlib-inflate + un-filter,
 *                  alpha composited over white) and embedded uncompressed
 *   - anything else (SVG / WebP / CMYK) → no image; the company name header is
 *     still shown. Upload a PNG or JPEG logo for it to appear on the PDF.
 *
 * Currency is written as "INR 30,000.00" — the base-14 fonts do not carry the ₹
 * glyph, so the UI / email show ₹ while the printable PDF stays unambiguous.
 */
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

export interface SlipLogo {
  mime: string;
  /** base64 of the exact bytes to embed */
  dataBase64: string;
}

export interface SalarySlipPdfData {
  /* company (from the central Company Branding source, snapshotted) */
  companyName: string;
  companyLegalName?: string | null;
  companyAddress?: string | null;
  companyTaxId?: string | null;
  companyFooter?: string | null;
  logo?: SlipLogo | null;
  /* employee */
  employeeName: string;
  employeeCode: string; // "TMI_CC_001" / "TMI_CL_001"
  userId: number;
  joiningDate?: string | null; // "YYYY-MM-DD"
  process: string;
  /* period + money (all snapshot strings, "0.00" style) */
  periodMonth: string; // "YYYY-MM"
  baseSalary: string;
  payableBaseSalary: string;
  regularityBonus: number; // whole rupees
  leaveCount: number;
  offCount: number;
  unpaidLeaveDays: number;
  lateShortCount: number;
  lateFullCount: number;
  lateUnits: string; // "3.0"
  lateDeduction: string; // "1000.00"
  calculatedSalary: string; // NET "30000.00"
  /* provenance */
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

/* ---- byte helpers ---------------------------------------------------- */

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function concatBytes(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function pdfEscape(s: string): string {
  return s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7E]/g, "");
}

/* ---- image decoding (JPEG passthrough · PNG decode) ---------------- */

interface DecodedImage {
  width: number;
  height: number;
  colorSpace: "DeviceRGB" | "DeviceGray";
  /** "DCTDecode" for JPEG passthrough; null = uncompressed raw samples */
  filter: "DCTDecode" | null;
  data: Uint8Array;
}

function u16be(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!;
}
function u32be(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
}

function decodeJpeg(bytes: Uint8Array): DecodedImage | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1]!;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16be(bytes, i + 2);
    if (len < 2) return null;
    // SOF0..SOF15 (skip DHT C4, JPG C8, DAC CC) carry the frame header
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = u16be(bytes, i + 5);
      const width = u16be(bytes, i + 7);
      const components = bytes[i + 9]!;
      if (components !== 1 && components !== 3) return null; // CMYK etc → skip
      return {
        width,
        height,
        colorSpace: components === 1 ? "DeviceGray" : "DeviceRGB",
        filter: "DCTDecode",
        data: bytes,
      };
    }
    i += 2 + len;
  }
  return null;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(bytes: Uint8Array): DecodedImage | null {
  if (bytes.length < 8 || !PNG_SIG.every((v, k) => bytes[k] === v)) return null;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  let p = 8;
  while (p + 8 <= bytes.length) {
    const len = u32be(bytes, p);
    const type = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!);
    const dataStart = p + 8;
    if (dataStart + len > bytes.length) break;
    if (type === "IHDR") {
      width = u32be(bytes, dataStart);
      height = u32be(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      interlace = bytes[dataStart + 12]!;
    } else if (type === "PLTE") {
      palette = bytes.slice(dataStart, dataStart + len);
    } else if (type === "IDAT") {
      idat.push(bytes.slice(dataStart, dataStart + len));
    } else if (type === "IEND") {
      break;
    }
    p = dataStart + len + 4; // + CRC
  }

  if (bitDepth !== 8 || interlace !== 0 || width === 0 || height === 0) return null;

  const channelsByType: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const srcCh = channelsByType[colorType];
  if (!srcCh) return null;
  if (colorType === 3 && !palette) return null;

  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateSync(concatBytes(idat)));
  } catch {
    return null;
  }

  const stride = width * srcCh;
  if (raw.length < (stride + 1) * height) return null;

  // un-filter into `flat` (width*height*srcCh raw samples)
  const flat = new Uint8Array(stride * height);
  const bpp = srcCh; // bit depth 8 → bytes per pixel == channels
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    const prevOut = rowOut - stride;
    for (let x = 0; x < stride; x++) {
      const rv = raw[rowIn + x]!;
      const a = x >= bpp ? flat[rowOut + x - bpp]! : 0;
      const b = y > 0 ? flat[prevOut + x]! : 0;
      const c = y > 0 && x >= bpp ? flat[prevOut + x - bpp]! : 0;
      let v: number;
      switch (filter) {
        case 0:
          v = rv;
          break;
        case 1:
          v = rv + a;
          break;
        case 2:
          v = rv + b;
          break;
        case 3:
          v = rv + ((a + b) >> 1);
          break;
        case 4:
          v = rv + paeth(a, b, c);
          break;
        default:
          return null;
      }
      flat[rowOut + x] = v & 0xff;
    }
  }

  // → output samples (opaque), compositing any alpha over white
  const px = width * height;
  if (colorType === 0) {
    return { width, height, colorSpace: "DeviceGray", filter: null, data: flat };
  }
  if (colorType === 2) {
    return { width, height, colorSpace: "DeviceRGB", filter: null, data: flat };
  }
  if (colorType === 3) {
    const out = new Uint8Array(px * 3);
    for (let k = 0; k < px; k++) {
      const idx = flat[k]! * 3;
      out[k * 3] = palette![idx] ?? 0;
      out[k * 3 + 1] = palette![idx + 1] ?? 0;
      out[k * 3 + 2] = palette![idx + 2] ?? 0;
    }
    return { width, height, colorSpace: "DeviceRGB", filter: null, data: out };
  }
  if (colorType === 4) {
    const out = new Uint8Array(px);
    for (let k = 0; k < px; k++) {
      const g = flat[k * 2]!;
      const alpha = flat[k * 2 + 1]! / 255;
      out[k] = Math.round(g * alpha + 255 * (1 - alpha));
    }
    return { width, height, colorSpace: "DeviceGray", filter: null, data: out };
  }
  // colorType 6 — RGBA
  const out = new Uint8Array(px * 3);
  for (let k = 0; k < px; k++) {
    const alpha = flat[k * 4 + 3]! / 255;
    for (let ch = 0; ch < 3; ch++) {
      out[k * 3 + ch] = Math.round(flat[k * 4 + ch]! * alpha + 255 * (1 - alpha));
    }
  }
  return { width, height, colorSpace: "DeviceRGB", filter: null, data: out };
}

function decodeLogo(logo: SlipLogo | null | undefined): DecodedImage | null {
  if (!logo || !logo.dataBase64) return null;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(logo.dataBase64, "base64"));
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  const mime = (logo.mime || "").toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return decodeJpeg(bytes);
  if (mime.includes("png")) return decodePng(bytes);
  // sniff as a fallback
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return decodeJpeg(bytes);
  if (PNG_SIG.every((v, k) => bytes[k] === v)) return decodePng(bytes);
  return null; // svg / webp / unknown → text header only
}

/* ---- PDF assembly (binary-safe) ----------------------------------- */

interface Line {
  text: string;
  size: number;
  bold: boolean;
  gapBefore: number;
}

function contentStream(lines: Line[], startY: number, image?: { drawOps: string }): string {
  let out = image?.drawOps ?? "";
  let y = startY;
  for (const ln of lines) {
    y -= ln.gapBefore + ln.size + 4;
    const font = ln.bold ? "/F2" : "/F1";
    out += `BT ${font} ${ln.size} Tf 1 0 0 1 56 ${y} Tm (${pdfEscape(ln.text)}) Tj ET\n`;
  }
  return out;
}

/** Assemble numbered objects (string bodies or raw-byte bodies) into a PDF. */
function assemblePdf(objectBodies: Array<Uint8Array | string>): Uint8Array {
  const chunks: Uint8Array[] = [];
  let pos = 0;
  const push = (v: Uint8Array | string) => {
    const b = typeof v === "string" ? utf8(v) : v;
    chunks.push(b);
    pos += b.length;
  };

  push("%PDF-1.4\n");
  const offsets: number[] = [];
  for (let i = 0; i < objectBodies.length; i++) {
    offsets.push(pos);
    push(`${i + 1} 0 obj\n`);
    push(objectBodies[i]!);
    push("\nendobj\n");
  }
  const xrefStart = pos;
  let xref = `xref\n0 ${objectBodies.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(
    `trailer\n<< /Size ${objectBodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`,
  );
  return concatBytes(chunks);
}

function streamObject(dict: string, body: Uint8Array): Uint8Array {
  const d = dict.trim();
  const head = d
    ? `<< ${d} /Length ${body.length} >>\nstream\n`
    : `<< /Length ${body.length} >>\nstream\n`;
  return concatBytes([utf8(head), body, utf8("\nendstream")]);
}

export function renderSalarySlipPdf(data: SalarySlipPdfData): Uint8Array {
  const img = decodeLogo(data.logo ?? null);

  /* --- header + rows --- */
  const headerLines: Line[] = [
    { text: data.companyName || "Company", size: 20, bold: true, gapBefore: 0 },
  ];
  if (data.companyLegalName) {
    headerLines.push({ text: data.companyLegalName, size: 9, bold: false, gapBefore: 1 });
  }
  if (data.companyAddress) {
    headerLines.push({ text: data.companyAddress, size: 9, bold: false, gapBefore: 1 });
  }
  if (data.companyTaxId) {
    headerLines.push({ text: `Tax ID: ${data.companyTaxId}`, size: 9, bold: false, gapBefore: 1 });
  }
  headerLines.push({
    text: data.isPreview ? "Salary Slip (PREVIEW - not final)" : "Salary Slip",
    size: 14,
    bold: true,
    gapBefore: 8,
  });
  headerLines.push({ text: "", size: 6, bold: false, gapBefore: 0 });

  const rows: Array<[string, string]> = [
    ["Employee Name", data.employeeName],
    ["Employee ID", data.employeeCode || `user${data.userId}`],
    ["Joining Date", data.joiningDate || "-"],
    ["Process", data.process],
    ["Payroll Month", monthLabel(data.periodMonth)],
    ["", ""],
    ["Monthly Base Salary", formatInr(data.baseSalary)],
    ["Payable Base (after attendance)", formatInr(data.payableBaseSalary)],
    ["Leave Days", String(data.leaveCount)],
    ["Unpaid Leave / Absence Days", String(data.unpaidLeaveDays)],
    ["Off Days", String(data.offCount)],
    ["", ""],
    ["Short Late Count (x 1.0 unit)", String(data.lateShortCount)],
    ["Late Count (x 1.5 units)", String(data.lateFullCount)],
    ["Late Units (total)", data.lateUnits],
    ["Late Deduction", formatInr(data.lateDeduction)],
    ["Regularity Bonus", formatInr(data.regularityBonus)],
    ["", ""],
    ["Net Salary (Calculated)", formatInr(data.calculatedSalary)],
    ["", ""],
    ["Payroll Status", data.payrollStatus],
    ["Calculation Version", data.calculationVersion],
    ["Salary Slip Version", String(data.slipVersion)],
    ["Generated", data.generatedAt],
  ];

  const lines: Line[] = [...headerLines];
  for (const [label, value] of rows) {
    if (label === "") {
      lines.push({ text: "", size: 6, bold: false, gapBefore: 0 });
      continue;
    }
    const bold = label === "Net Salary (Calculated)";
    lines.push({ text: `${label}:  ${value}`, size: bold ? 12 : 11, bold, gapBefore: 2 });
  }
  lines.push({ text: "", size: 10, bold: false, gapBefore: 0 });
  lines.push({
    text: "Late Units: Short Late = 1.0, Late = 1.5. 3 or more units = one day's salary cut",
    size: 9,
    bold: false,
    gapBefore: 8,
  });
  lines.push({
    text: "(monthly base / actual calendar days of the month) and no regularity bonus.",
    size: 9,
    bold: false,
    gapBefore: 2,
  });
  if (data.companyFooter) {
    lines.push({ text: data.companyFooter, size: 9, bold: false, gapBefore: 8 });
  }
  lines.push({
    text: "It is a salary-before-statutory-deductions figure and is not a statutory payslip.",
    size: 9,
    bold: false,
    gapBefore: data.companyFooter ? 2 : 8,
  });

  /* --- image placement --- */
  let startY = 800;
  let drawOps = "";
  const objects: Array<Uint8Array | string> = [];
  let resourceExtra = "";

  if (img) {
    const maxW = 150;
    const maxH = 70;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const x = Math.round((595 - w) / 2);
    const y = 812 - h;
    drawOps = `q ${w} 0 0 ${h} ${x} ${y} cm /Im0 Do Q\n`;
    startY = y - 10;
    resourceExtra = " /XObject << /Im0 7 0 R >>";
  }

  const content = contentStream(lines, startY, img ? { drawOps } : undefined);
  const contentBytes = utf8(content);

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${resourceExtra} >> /Contents 6 0 R >>`,
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  objects.push(streamObject("", contentBytes));

  if (img) {
    const dict =
      `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
      `/BitsPerComponent 8 /ColorSpace /${img.colorSpace}` +
      (img.filter ? ` /Filter /${img.filter}` : "");
    objects.push(streamObject(dict, img.data));
  }

  return assemblePdf(objects);
}

/** SHA-256 hex of the generated bytes — a stable integrity fingerprint. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
