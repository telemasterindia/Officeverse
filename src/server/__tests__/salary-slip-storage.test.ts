import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetSalarySlipStore,
  describeDocumentStorage,
  getSalarySlipStore,
  resolveDocumentPath,
  salarySlipStorageKey,
} from "../hr/salary-slip-storage";

const ENVK = ["DOCUMENT_STORAGE_PROVIDER", "OFFICEVERSE_DOCUMENT_ROOT", "VERCEL"] as const;
function clearEnv() {
  for (const k of ENVK) delete process.env[k];
  __resetSalarySlipStore();
}
beforeEach(clearEnv);
afterEach(clearEnv);

describe("resolveDocumentPath — traversal & absolute-path protection", () => {
  const root = "/srv/officeverse/docs";
  it("resolves a normal key under the root", () => {
    const p = resolveDocumentPath(root, "salary-slips/2026-08/u5/v1.pdf");
    expect(p).toBe("/srv/officeverse/docs/salary-slips/2026-08/u5/v1.pdf");
  });
  it("rejects an absolute key", () => {
    expect(() => resolveDocumentPath(root, "/etc/passwd")).toThrow(/absolute/i);
  });
  it("rejects a Windows absolute key", () => {
    expect(() => resolveDocumentPath(root, "C:\\secrets\\x")).toThrow(/absolute/i);
  });
  it("rejects `..` traversal", () => {
    expect(() => resolveDocumentPath(root, "a/../../etc/passwd")).toThrow(/\.\./);
    expect(() => resolveDocumentPath(root, "../outside.pdf")).toThrow();
  });
  it("rejects a `.` segment and NUL bytes", () => {
    expect(() => resolveDocumentPath(root, "a/./b")).toThrow();
    expect(() => resolveDocumentPath(root, "a\u0000b")).toThrow(/NUL/);
  });
  it("rejects an empty key", () => {
    expect(() => resolveDocumentPath(root, "")).toThrow();
  });
});

describe("salarySlipStorageKey — deterministic server-generated key", () => {
  it("builds a stable key and sanitises the month", () => {
    expect(salarySlipStorageKey(5, "2026-08", 1)).toBe("salary-slips/2026-08/u5/v1.pdf");
    expect(salarySlipStorageKey(-2, "2026/08", 0)).toBe("salary-slips/unknown-month/u0/v1.pdf");
  });
});

describe("memory store (default)", () => {
  it("put / get / exists / delete round-trip preserving exact bytes", async () => {
    const s = getSalarySlipStore();
    expect(s.kind).toBe("memory");
    const bytes = new Uint8Array([37, 80, 68, 70, 1, 2, 3, 255, 0, 128]);
    await s.put("salary-slips/2026-08/u1/v1.pdf", bytes);
    expect(await s.exists("salary-slips/2026-08/u1/v1.pdf")).toBe(true);
    const got = await s.get("salary-slips/2026-08/u1/v1.pdf");
    expect(got && Buffer.from(got).equals(Buffer.from(bytes))).toBe(true);
    await s.deleteKey("salary-slips/2026-08/u1/v1.pdf");
    expect(await s.get("salary-slips/2026-08/u1/v1.pdf")).toBeNull();
  });
  it("returns null for a missing key", async () => {
    expect(await getSalarySlipStore().get("nope/v9.pdf")).toBeNull();
  });
  it("rejects an unsafe key on put", async () => {
    await expect(getSalarySlipStore().put("../x.pdf", new Uint8Array())).rejects.toThrow();
  });
});

describe("filesystem store (production shape)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ov-slip-"));
    process.env["DOCUMENT_STORAGE_PROVIDER"] = "filesystem";
    process.env["OFFICEVERSE_DOCUMENT_ROOT"] = dir;
    __resetSalarySlipStore();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is selected via env and reports rootConfigured", () => {
    expect(getSalarySlipStore().kind).toBe("filesystem");
    expect(describeDocumentStorage()).toEqual({ provider: "filesystem", rootConfigured: true });
  });

  it("durably persists exact bytes, creating directories", async () => {
    const s = getSalarySlipStore();
    await s.ensureReady();
    const key = salarySlipStorageKey(7, "2026-08", 2);
    const bytes = new Uint8Array([0, 1, 2, 3, 254, 255, 10, 13]);
    await s.put(key, bytes);
    expect(await s.exists(key)).toBe(true);
    const onDisk = await readFile(join(dir, key));
    expect(Buffer.from(onDisk).equals(Buffer.from(bytes))).toBe(true);
    const got = await s.get(key);
    expect(got && Buffer.from(got).equals(Buffer.from(bytes))).toBe(true);
  });

  it("missing file → null (not an error)", async () => {
    expect(await getSalarySlipStore().get("salary-slips/2026-08/u9/v1.pdf")).toBeNull();
  });

  it("refuses to read/write outside the configured root", async () => {
    const s = getSalarySlipStore();
    await expect(s.get("../../../etc/passwd")).rejects.toThrow();
    await expect(s.put("/etc/evil", new Uint8Array([1]))).rejects.toThrow();
  });

  it("filesystem provider without a root is a configuration error", () => {
    delete process.env["OFFICEVERSE_DOCUMENT_ROOT"];
    __resetSalarySlipStore();
    expect(() => getSalarySlipStore()).toThrow(/OFFICEVERSE_DOCUMENT_ROOT/);
  });
});

describe("filesystem provider on Vercel — refuses instead of writing under /var/task", () => {
  beforeEach(() => {
    process.env["DOCUMENT_STORAGE_PROVIDER"] = "filesystem";
    process.env["OFFICEVERSE_DOCUMENT_ROOT"] = "/home/cpanel-user/officeverse-documents";
    process.env["VERCEL"] = "1";
    __resetSalarySlipStore();
  });

  it("throws a clear config error even with a valid-looking root configured", () => {
    expect(() => getSalarySlipStore()).toThrow(/not supported on Vercel/i);
  });

  it("never falls back to the in-memory store silently (no accidental data loss)", () => {
    expect(() => getSalarySlipStore()).toThrow();
    // and NOT: expect(getSalarySlipStore().kind).toBe("memory")
  });
});
