import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetLeadDocStore, getLeadDocStore } from "../leads/document-storage";

const ENVK = ["DOCUMENT_STORAGE_PROVIDER", "OFFICEVERSE_DOCUMENT_ROOT", "VERCEL"] as const;
function clearEnv() {
  for (const k of ENVK) delete process.env[k];
  __resetLeadDocStore();
}
beforeEach(clearEnv);
afterEach(clearEnv);

describe("lead document store — default (no provider configured)", () => {
  it("is the in-memory store, unaffected by these changes", () => {
    expect(getLeadDocStore().kind).toBe("memory");
  });
});

describe("lead document store — local filesystem (GoDaddy shape)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ov-leaddoc-"));
    process.env["DOCUMENT_STORAGE_PROVIDER"] = "filesystem";
    process.env["OFFICEVERSE_DOCUMENT_ROOT"] = dir;
    __resetLeadDocStore();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("durably persists bytes off Vercel", async () => {
    const s = getLeadDocStore();
    expect(s.kind).toBe("filesystem");
    const bytes = new Uint8Array([1, 2, 3]);
    await s.put("lead-documents/L1/abc.pdf", bytes);
    const onDisk = await readFile(join(dir, "lead-documents/L1/abc.pdf"));
    expect(Buffer.from(onDisk).equals(Buffer.from(bytes))).toBe(true);
  });
});

describe("lead document store — filesystem provider on Vercel refuses instead of writing under /var/task", () => {
  beforeEach(() => {
    process.env["DOCUMENT_STORAGE_PROVIDER"] = "filesystem";
    process.env["OFFICEVERSE_DOCUMENT_ROOT"] = "/home/cpanel-user/officeverse-documents";
    process.env["VERCEL"] = "1";
    __resetLeadDocStore();
  });

  it("throws a clear config error even with a valid-looking root configured", () => {
    expect(() => getLeadDocStore()).toThrow(/not supported on Vercel/i);
  });
});
