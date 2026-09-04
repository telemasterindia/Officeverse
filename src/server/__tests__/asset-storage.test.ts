import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetAssetStore, describeAssetStorage, getAssetStore } from "../live/asset-storage";

const ENVK = [
  "CELEBRATION_STORAGE",
  "PHOTO_STORAGE",
  "CELEBRATION_ASSET_DIR",
  "VERCEL",
  "DATABASE_URL",
  "DB_HOST",
  "DB_NAME",
  "DB_USER",
] as const;
function clearEnv() {
  for (const k of ENVK) delete process.env[k];
  __resetAssetStore();
}
beforeEach(clearEnv);
afterEach(clearEnv);

describe("celebration asset store — local filesystem (GoDaddy / local dev shape)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ov-asset-"));
    process.env["CELEBRATION_ASSET_DIR"] = dir;
    __resetAssetStore();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is selected by default and durably persists bytes", async () => {
    const s = getAssetStore();
    expect(s.kind).toBe("filesystem");
    expect(describeAssetStorage()).toEqual({ provider: "local", durable: true });
    const bytes = new Uint8Array([1, 2, 3]);
    await s.put("celebrations/GOLD/1-clip.mp4", bytes);
    const onDisk = await readFile(join(dir, "celebrations/GOLD/1-clip.mp4"));
    expect(Buffer.from(onDisk).equals(Buffer.from(bytes))).toBe(true);
  });
});

describe("celebration asset store — Vercel guard (no writable filesystem)", () => {
  beforeEach(() => {
    // No provider env set — this reproduces the production ENOENT
    // ('/var/task/storage/celebrations/...') from the default alone.
    process.env["VERCEL"] = "1";
    __resetAssetStore();
  });

  it("still honors an explicit non-local provider the same as off-Vercel", () => {
    process.env["CELEBRATION_STORAGE"] = "s3";
    __resetAssetStore();
    expect(getAssetStore().kind).toBe("memory");
  });
});

describe("celebration asset store — database backend (Vercel-safe durable storage)", () => {
  it("CELEBRATION_STORAGE=database is selectable explicitly, anywhere", () => {
    process.env["CELEBRATION_STORAGE"] = "database";
    __resetAssetStore();
    expect(getAssetStore().kind).toBe("database");
    expect(describeAssetStorage()).toEqual({ provider: "database", durable: true });
  });

  it("is used automatically on Vercel when the DB is configured, instead of memory", () => {
    process.env["VERCEL"] = "1";
    process.env["DATABASE_URL"] = "mysql://user:pass@example.invalid:3306/officeverse";
    __resetAssetStore();
    expect(getAssetStore().kind).toBe("database");
    expect(describeAssetStorage()).toEqual({ provider: "database", durable: true });
  });

  it("falls back to memory only when Vercel AND no DB is configured at all", () => {
    process.env["VERCEL"] = "1";
    __resetAssetStore();
    expect(getAssetStore().kind).toBe("memory");
    expect(describeAssetStorage()).toEqual({ provider: "memory", durable: false });
  });

  it("rejects unsafe keys before ever reaching the database", async () => {
    process.env["CELEBRATION_STORAGE"] = "database";
    __resetAssetStore();
    const s = getAssetStore();
    await expect(s.put("../etc/passwd", new Uint8Array([1]))).rejects.toThrow();
    await expect(s.get("/etc/passwd")).rejects.toThrow();
    await expect(s.deleteKey("x".repeat(501))).rejects.toThrow();
  });
});
