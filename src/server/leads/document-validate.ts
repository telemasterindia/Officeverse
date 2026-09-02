/**
 * Officeverse — Lead supporting-document upload validation (Admin/Lead UAT §5).
 *
 * PURE. No I/O. Mirrors the Phase-19 photo validator and the Phase-21
 * celebration-asset validator: the browser-declared MIME and the filename
 * extension are ADVISORY ONLY — the real type is sniffed from the leading
 * magic bytes. This is what blocks an `.exe` renamed to `.pdf`, an HTML/JS
 * payload, a shell script, etc. Uploaded bytes are only ever stored and
 * served back, never executed or interpreted.
 *
 * Allowed: PDF + PNG / JPEG / WebP (a supporting document is a scan, a
 * statement, or a photo). Hard ceiling 10 MB — comfortably covers a multi-page
 * scanned PDF while keeping one request cheap.
 */

export const LEAD_DOC_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export type LeadDocMime = (typeof LEAD_DOC_MIME)[number];

/** 10 MB decoded. The server re-checks the DECODED length, never the base64. */
export const MAX_LEAD_DOC_BYTES = 10 * 1024 * 1024;
/** below this a file cannot carry a real header — reject as corrupt/empty. */
export const MIN_LEAD_DOC_BYTES = 32;

export interface LeadDocCheckInput {
  bytes: Uint8Array;
  /** browser-declared MIME — advisory only, re-derived from the bytes */
  declaredMime?: string | null;
  filename?: string | null;
}

export type LeadDocCheckResult =
  | { ok: true; mime: LeadDocMime; safeName: string }
  | { ok: false; reason: string; safeName: string };

/** Magic-byte sniff. Returns the canonical MIME or null when unrecognised. */
export function sniffLeadDocMime(b: Uint8Array): LeadDocMime | null {
  // PDF: "%PDF-"
  if (
    b.length >= 5 &&
    b[0] === 0x25 &&
    b[1] === 0x50 &&
    b[2] === 0x44 &&
    b[3] === 0x46 &&
    b[4] === 0x2d
  ) {
    return "application/pdf";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

const EXT_FOR: Record<LeadDocMime, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Reduce an arbitrary client filename to a safe display basename: no directory
 * component, no traversal, a single dot, ASCII-ish, length-capped. NEVER used
 * to build a storage path (that key is generated server-side) — this is only
 * the name shown in the UI and sent as the download filename.
 */
export function sanitizeLeadDocFilename(name: string | null | undefined): string {
  const raw = String(name ?? "document").replace(/^.*[\\/]/, ""); // strip any directory
  // Drop control characters without a control-char regex literal (eslint
  // `no-control-regex`) — walk the codepoints and keep only printable ones.
  let stripped = "";
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x20 && cp !== 0x7f) stripped += ch;
  }
  const base = stripped
    .replace(/[^A-Za-z0-9._ -]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return base || "document";
}

export function validateLeadDocumentUpload(input: LeadDocCheckInput): LeadDocCheckResult {
  const safeName = sanitizeLeadDocFilename(input.filename);
  const n = input.bytes?.length ?? 0;
  if (n < MIN_LEAD_DOC_BYTES) return { ok: false, reason: "file_too_small", safeName };
  if (n > MAX_LEAD_DOC_BYTES) return { ok: false, reason: "file_too_large", safeName };

  const mime = sniffLeadDocMime(input.bytes);
  if (!mime) return { ok: false, reason: "unsupported_file_type", safeName };

  // Ensure the display name carries an extension consistent with the SNIFFED
  // type (so a download of `virus.exe` lands as `virus.pdf`, matching content).
  const wantExt = EXT_FOR[mime];
  const hasGoodExt =
    new RegExp(`\\.${wantExt}$`, "i").test(safeName) ||
    (mime === "image/jpeg" && /\.jpeg$/i.test(safeName));
  const finalName = hasGoodExt ? safeName : `${safeName.replace(/\.[^.]*$/, "")}.${wantExt}`;

  return { ok: true, mime, safeName: finalName };
}
