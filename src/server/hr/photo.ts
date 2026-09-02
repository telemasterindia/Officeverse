/**
 * Officeverse — profile-photo validation (Phase 19). PURE. No DB, no I/O.
 *
 * The REAL uploaded photo is the person's identity. This module only decides
 * whether a byte buffer is a safe, reasonable image and produces a safe
 * internal storage key. It never transforms the pixels — client-side crop /
 * resize / compression happens before upload; the server stores the bytes as
 * received (the "original"), and the visual effects engine never touches them.
 *
 * Image type is sniffed from MAGIC BYTES, never from the filename / extension /
 * client-declared MIME alone. SVG is rejected (it can carry script).
 */

export const PHOTO_ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoMime = (typeof PHOTO_ACCEPTED_MIME)[number];

export const PHOTO_MAX_BYTES_DEFAULT = 5 * 1024 * 1024; // 5 MB (Admin UAT Batch-2 §2)
export const PHOTO_MIN_DIMENSION = 48;
export const PHOTO_MAX_DIMENSION = 4096;

export interface PhotoValidationOk {
  ok: true;
  mime: PhotoMime;
  bytes: number;
  width: number;
  height: number;
}
export interface PhotoValidationErr {
  ok: false;
  reason: string;
  code:
    "empty" | "too_large" | "unsupported_type" | "corrupt" | "too_small" | "too_large_dimensions";
}
export type PhotoValidation = PhotoValidationOk | PhotoValidationErr;

function u16be(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!;
}
function u32be(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
}
function u32le(b: Uint8Array, i: number): number {
  return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
}

/* --------------------------- magic bytes ----------------------- */

function sniffMime(b: Uint8Array): PhotoMime | null {
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
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
  // WebP: "RIFF"...."WEBP"
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

/* -------------------- dimensions from the header ---------------- */

function pngSize(b: Uint8Array): { width: number; height: number } | null {
  // IHDR is the first chunk: 8 sig + 4 len + "IHDR" + width(4) + height(4)
  if (b.length < 24) return null;
  if (!(b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52)) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2; // skip SOI
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1]!;
    // SOF0..SOF15 (not DHT C4, DAC CC, RSTn) carry the frame size
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = u16be(b, i + 5);
      const width = u16be(b, i + 7);
      return { width, height };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const fourcc = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (fourcc === "VP8 ") {
    // lossy: dimensions at offset 26 (14-bit each, little-endian)
    const w = u16be_le(b, 26) & 0x3fff;
    const h = u16be_le(b, 28) & 0x3fff;
    return w && h ? { width: w, height: h } : null;
  }
  if (fourcc === "VP8L") {
    // lossless: 1 signature byte then 14+14 bits packed LE
    const bits = u32le(b, 21);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >> 14) & 0x3fff) + 1;
    return { width: w, height: h };
  }
  if (fourcc === "VP8X") {
    // extended: 24-bit (w-1) at 24, (h-1) at 27, little-endian
    const w = (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1;
    const h = (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1;
    return { width: w, height: h };
  }
  return null;
}
function u16be_le(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}

export function imageDimensions(
  mime: PhotoMime,
  b: Uint8Array,
): { width: number; height: number } | null {
  if (mime === "image/png") return pngSize(b);
  if (mime === "image/jpeg") return jpegSize(b);
  return webpSize(b);
}

/* --------------------------- validate ------------------------- */

export function validatePhotoUpload(
  bytes: Uint8Array,
  opts: { maxBytes?: number } = {},
): PhotoValidation {
  const maxBytes = opts.maxBytes ?? PHOTO_MAX_BYTES_DEFAULT;
  if (!bytes || bytes.length === 0) {
    return { ok: false, code: "empty", reason: "The uploaded file is empty." };
  }
  if (bytes.length > maxBytes) {
    return {
      ok: false,
      code: "too_large",
      reason: `The image is larger than ${(maxBytes / 1024 / 1024).toFixed(1)} MB.`,
    };
  }
  const mime = sniffMime(bytes);
  if (!mime) {
    return {
      ok: false,
      code: "unsupported_type",
      reason: "Only JPEG, PNG or WebP images are accepted.",
    };
  }
  const dims = imageDimensions(mime, bytes);
  if (!dims || !Number.isFinite(dims.width) || !Number.isFinite(dims.height) || dims.width < 1) {
    return { ok: false, code: "corrupt", reason: "The image header could not be read." };
  }
  if (dims.width < PHOTO_MIN_DIMENSION || dims.height < PHOTO_MIN_DIMENSION) {
    return {
      ok: false,
      code: "too_small",
      reason: `The image must be at least ${PHOTO_MIN_DIMENSION}×${PHOTO_MIN_DIMENSION}px.`,
    };
  }
  if (dims.width > PHOTO_MAX_DIMENSION || dims.height > PHOTO_MAX_DIMENSION) {
    return {
      ok: false,
      code: "too_large_dimensions",
      reason: `The image must be at most ${PHOTO_MAX_DIMENSION}px on a side.`,
    };
  }
  return { ok: true, mime, bytes: bytes.length, width: dims.width, height: dims.height };
}

/* -------------------------- safe key -------------------------- */

const EXT: Record<PhotoMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Deterministic, traversal-safe storage key. Server-generated only. */
export function safePhotoKey(userId: number, mime: PhotoMime, version: number): string {
  const uid = Math.max(0, Math.trunc(userId));
  const v = Math.max(1, Math.trunc(version));
  return `profile-photos/u${uid}/v${v}.${EXT[mime]}`;
}
