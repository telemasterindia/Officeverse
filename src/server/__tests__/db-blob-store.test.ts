import { describe, expect, it } from "vitest";
import { DatabaseBlobStore } from "../db-blob-store";

// Pure, DB-free coverage: every key-validation branch throws BEFORE the store
// ever calls getDb(), so these run safely with no database configured (see
// db-blob-store.itest.ts for the real round-trip against a live dryrun DB).
describe("DatabaseBlobStore key validation, no DB required", () => {
  const s = new DatabaseBlobStore();

  it("kind is database", () => {
    expect(s.kind).toBe("database");
  });

  it("rejects an empty key", async () => {
    await expect(s.get("")).rejects.toThrow(/non-empty/);
    await expect(s.put("", new Uint8Array([1]))).rejects.toThrow(/non-empty/);
  });

  it("rejects a key longer than the column width, 500 chars", async () => {
    await expect(s.get("x".repeat(501))).rejects.toThrow(/500/);
  });

  it("passes validation for a 500-char key, fails only at the unconfigured DB layer", async () => {
    const key500 = "x".repeat(500);
    await expect(s.get(key500)).rejects.toThrow(/database/i);
  });

  it("rejects an absolute-path-shaped key", async () => {
    const evilAbsolute = "/etc/passwd";
    await expect(s.put(evilAbsolute, new Uint8Array([1]))).rejects.toThrow(/invalid/i);
  });

  it("rejects dot-dot traversal", async () => {
    const evilTraversal = "a/../../etc/passwd";
    const evilTraversal2 = "../outside";
    await expect(s.put(evilTraversal, new Uint8Array([1]))).rejects.toThrow(/invalid/i);
    await expect(s.deleteKey(evilTraversal2)).rejects.toThrow(/invalid/i);
  });

  it("rejects NUL bytes", async () => {
    const evilNul = "a" + String.fromCharCode(0) + "b";
    await expect(s.exists(evilNul)).rejects.toThrow(/invalid/i);
  });
});
