/**
 * Officeverse — Live Experience: celebration video upload validation (Phase 21).
 *
 * PURE. Mirrors the Phase-19 photo validator: never trust the extension or the
 * client-declared MIME — sniff the magic bytes. Uploaded files are stored, never
 * executed.
 */

export const CELEBRATION_VIDEO_MIME = ["video/mp4", "video/webm"] as const;
export type CelebrationVideoMime = (typeof CELEBRATION_VIDEO_MIME)[number];

/** 8 MB — a 3–5s TV clip is well under this; keeps the TV responsive. */
export const MAX_CELEBRATION_BYTES = 8 * 1024 * 1024;
export const MIN_CELEBRATION_BYTES = 256;

export interface UploadCheckInput {
  bytes: Uint8Array;
  /** client-declared MIME — advisory only, re-derived from the bytes */
  declaredMime?: string | null;
  filename?: string | null;
}

export interface UploadCheckResult {
  ok: boolean;
  mime: CelebrationVideoMime | null;
  reason?: string;
  /** path-safe basename (no directories, no traversal, single dot) */
  safeName: string;
}

function sniff(bytes: Uint8Array): CelebrationVideoMime | null {
  if (bytes.length >= 12) {
    // ISO-BMFF / MP4: bytes 4..8 == "ftyp"
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      return "video/mp4";
    }
    // WebM / Matroska: EBML header 1A 45 DF A3
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      return "video/webm";
    }
  }
  return null;
}

export function sanitizeAssetFilename(name: string | null | undefined): string {
  const base = String(name ?? "clip")
    .replace(/^.*[\\/]/, "") // strip any directory
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return base || "clip";
}

export function validateCelebrationUpload(input: UploadCheckInput): UploadCheckResult {
  const safeName = sanitizeAssetFilename(input.filename);
  const n = input.bytes?.length ?? 0;
  if (n < MIN_CELEBRATION_BYTES) {
    return { ok: false, mime: null, reason: "file_too_small", safeName };
  }
  if (n > MAX_CELEBRATION_BYTES) {
    return { ok: false, mime: null, reason: "file_too_large", safeName };
  }
  const mime = sniff(input.bytes);
  if (!mime) {
    return { ok: false, mime: null, reason: "unsupported_format", safeName };
  }
  return { ok: true, mime, safeName };
}
