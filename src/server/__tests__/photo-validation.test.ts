import { describe, expect, it } from "vitest";
import {
  imageDimensions,
  safePhotoKey,
  validatePhotoUpload,
  PHOTO_MAX_DIMENSION,
} from "../hr/photo";

/* -------- minimal, real magic-byte image headers -------- */

function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR length
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  b.set([(w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255], 16);
  b.set([(h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255], 20);
  return b;
}
function jpeg(w: number, h: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (h >> 8) & 255,
    h & 255,
    (w >> 8) & 255,
    w & 255,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9, // EOI
  ]);
}
function jpegNoFrame(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0xaa, 0xbb, 0xff, 0xd9, 0, 0, 0, 0]);
}
function webpVp8l(w: number, h: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  b.set([0x20, 0, 0, 0], 4); // size
  b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  b.set([0x56, 0x50, 0x38, 0x4c], 12); // VP8L
  b.set([0x10, 0, 0, 0], 16); // chunk size
  b[20] = 0x2f; // signature
  const bits = (w - 1) | ((h - 1) << 14);
  b.set([bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >> 24) & 255], 21);
  return b;
}

describe("imageDimensions — parsed from the header only", () => {
  it("png / jpeg / webp", () => {
    expect(imageDimensions("image/png", png(320, 200))).toEqual({ width: 320, height: 200 });
    expect(imageDimensions("image/jpeg", jpeg(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageDimensions("image/webp", webpVp8l(100, 100))).toEqual({ width: 100, height: 100 });
  });
});

describe("validatePhotoUpload", () => {
  it("accepts a well-formed JPEG / PNG / WebP", () => {
    for (const bytes of [jpeg(300, 300), png(300, 300), webpVp8l(300, 300)]) {
      const r = validatePhotoUpload(bytes);
      expect(r.ok).toBe(true);
      if (r.ok) expect(["image/jpeg", "image/png", "image/webp"]).toContain(r.mime);
    }
  });

  it("rejects an empty buffer", () => {
    expect(validatePhotoUpload(new Uint8Array())).toMatchObject({ ok: false, code: "empty" });
  });

  it("rejects a non-image by MAGIC BYTES (not extension) — text, PDF, SVG", () => {
    const text = new TextEncoder().encode("hello, this is definitely not an image file at all!!");
    const pdf = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n1 0 obj<<>>endobj");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    for (const b of [text, pdf, svg]) {
      expect(validatePhotoUpload(b)).toMatchObject({ ok: false, code: "unsupported_type" });
    }
  });

  it("rejects an oversized file", () => {
    const big = new Uint8Array(1024 * 1024);
    big.set([0xff, 0xd8, 0xff], 0);
    expect(validatePhotoUpload(big, { maxBytes: 512 * 1024 })).toMatchObject({
      ok: false,
      code: "too_large",
    });
  });

  it("rejects a corrupt image (valid magic, unreadable header)", () => {
    expect(validatePhotoUpload(jpegNoFrame())).toMatchObject({ ok: false, code: "corrupt" });
  });

  it("rejects dimensions that are too small or too large", () => {
    expect(validatePhotoUpload(png(10, 10))).toMatchObject({ ok: false, code: "too_small" });
    expect(validatePhotoUpload(png(PHOTO_MAX_DIMENSION + 1, 200))).toMatchObject({
      ok: false,
      code: "too_large_dimensions",
    });
  });
});

describe("safePhotoKey — server-generated, traversal-safe", () => {
  it("builds a deterministic key with no traversal", () => {
    const k = safePhotoKey(42, "image/jpeg", 3);
    expect(k).toBe("profile-photos/u42/v3.jpg");
    expect(k).not.toContain("..");
    expect(k.startsWith("/")).toBe(false);
  });
  it("clamps a negative user id / version", () => {
    expect(safePhotoKey(-5, "image/png", 0)).toBe("profile-photos/u0/v1.png");
  });
});
