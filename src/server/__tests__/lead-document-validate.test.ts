/**
 * Admin/Lead UAT §5 — supporting-document upload validation (PURE).
 *
 * The server NEVER trusts the browser-declared MIME or the filename
 * extension — the real type is sniffed from the magic bytes, size is checked
 * against a 10 MB ceiling, and the display name is reduced to a safe basename.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_LEAD_DOC_BYTES,
  sanitizeLeadDocFilename,
  sniffLeadDocMime,
  validateLeadDocumentUpload,
} from "../leads/document-validate";

const pad = (head: number[], size = 64): Uint8Array => {
  const b = new Uint8Array(size);
  b.set(head);
  return b;
};

const PDF = pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = pad([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const ELF = pad([0x7f, 0x45, 0x4c, 0x46]); // linux executable
const SCRIPT = pad([0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x73, 0x68]); // "#!/bin/sh"
const HTML = pad([0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45]); // "<!DOCTYPE"

describe("sniffLeadDocMime", () => {
  it("recognises the four allowed formats by magic bytes", () => {
    expect(sniffLeadDocMime(PDF)).toBe("application/pdf");
    expect(sniffLeadDocMime(PNG)).toBe("image/png");
    expect(sniffLeadDocMime(JPEG)).toBe("image/jpeg");
    expect(sniffLeadDocMime(WEBP)).toBe("image/webp");
  });

  it("returns null for executables, scripts and markup", () => {
    expect(sniffLeadDocMime(ELF)).toBeNull();
    expect(sniffLeadDocMime(SCRIPT)).toBeNull();
    expect(sniffLeadDocMime(HTML)).toBeNull();
    expect(sniffLeadDocMime(new Uint8Array(4))).toBeNull();
  });
});

describe("validateLeadDocumentUpload", () => {
  it("accepts a PDF and keeps a clean name", () => {
    const r = validateLeadDocumentUpload({ bytes: PDF, filename: "statement.pdf" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe("application/pdf");
      expect(r.safeName).toBe("statement.pdf");
    }
  });

  it("rejects an .exe renamed to .pdf — content wins over extension", () => {
    const r = validateLeadDocumentUpload({
      bytes: ELF,
      filename: "totally-a.pdf",
      declaredMime: "application/pdf",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported_file_type");
  });

  it("rejects a file over the 10 MB ceiling", () => {
    const big = new Uint8Array(MAX_LEAD_DOC_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // valid PDF header — size still wins
    const r = validateLeadDocumentUpload({ bytes: big, filename: "huge.pdf" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("file_too_large");
  });

  it("rejects an empty / truncated file", () => {
    const r = validateLeadDocumentUpload({ bytes: new Uint8Array(8), filename: "x.pdf" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("file_too_small");
  });

  it("normalises the extension to the sniffed type", () => {
    const r = validateLeadDocumentUpload({ bytes: PNG, filename: "scan.pdf" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.safeName).toBe("scan.png");
  });

  it("strips directory components and traversal from the name", () => {
    expect(sanitizeLeadDocFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeLeadDocFilename("C:\\Windows\\evil.pdf")).toBe("evil.pdf");
    expect(sanitizeLeadDocFilename("../../../x")).toBe("x");
    expect(sanitizeLeadDocFilename("")).toBe("document");
  });

  it("collapses repeated dots and drops leading dots", () => {
    expect(sanitizeLeadDocFilename("...a....pdf")).toBe("a.pdf");
  });
});
