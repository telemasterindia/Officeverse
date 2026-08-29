import { describe, expect, it } from "vitest";
import {
  MAX_CELEBRATION_BYTES,
  sanitizeAssetFilename,
  validateCelebrationUpload,
} from "../live/asset-validate";

function mp4(len = 4096): Uint8Array {
  const b = new Uint8Array(len);
  // ....ftyp....
  b.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);
  return b;
}
function webm(len = 4096): Uint8Array {
  const b = new Uint8Array(len);
  b.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  return b;
}

describe("celebration upload validation — sniff bytes, never trust extension/MIME", () => {
  it("accepts a real MP4 (ftyp) regardless of declared MIME", () => {
    const r = validateCelebrationUpload({
      bytes: mp4(),
      declaredMime: "text/plain",
      filename: "x.txt",
    });
    expect(r.ok).toBe(true);
    expect(r.mime).toBe("video/mp4");
  });

  it("accepts a real WebM (EBML header)", () => {
    expect(validateCelebrationUpload({ bytes: webm() }).mime).toBe("video/webm");
  });

  it("rejects arbitrary bytes even if the client claims video/mp4", () => {
    const junk = new Uint8Array(4096).fill(0x41);
    const r = validateCelebrationUpload({ bytes: junk, declaredMime: "video/mp4" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unsupported_format");
  });

  it("rejects an executable-ish payload (MZ / ELF / shebang)", () => {
    const mz = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...new Array(4092).fill(0)]);
    expect(validateCelebrationUpload({ bytes: mz }).ok).toBe(false);
  });

  it("rejects too-small and too-large files", () => {
    expect(validateCelebrationUpload({ bytes: new Uint8Array(10) }).reason).toBe("file_too_small");
    const big = new Uint8Array(MAX_CELEBRATION_BYTES + 1);
    big.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], 0);
    expect(validateCelebrationUpload({ bytes: big }).reason).toBe("file_too_large");
  });

  it("sanitizes filenames — no directories, no traversal", () => {
    expect(sanitizeAssetFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeAssetFilename("C:\\evil\\clip.mp4")).toBe("clip.mp4");
    expect(sanitizeAssetFilename("a b/c.d.e.mp4")).toBe("c.d.e.mp4");
    expect(sanitizeAssetFilename(null)).toBe("clip");
    expect(sanitizeAssetFilename("....")).toBe("clip");
  });
});
