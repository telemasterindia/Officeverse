import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetPhotoStore, describePhotoStorage, getPhotoStore } from "../hr/photo-storage";

const ENVK = [
  "PHOTO_STORAGE",
  "PHOTO_LOCAL_DIR",
  "VERCEL",
  "DATABASE_URL",
  "DB_HOST",
  "DB_NAME",
  "DB_USER",
] as const;
function clearEnv() {
  for (const k of ENVK) delete process.env[k];
  __resetPhotoStore();
}
beforeEach(clearEnv);
afterEach(clearEnv);

describe("photo store — local filesystem (GoDaddy / local dev shape)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ov-photo-"));
    process.env["PHOTO_STORAGE"] = "local";
    process.env["PHOTO_LOCAL_DIR"] = dir;
    __resetPhotoStore();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is selected via env (default) and durably persists bytes", async () => {
    const s = getPhotoStore();
    expect(s.kind).toBe("filesystem");
    expect(describePhotoStorage()).toEqual({ provider: "local", durable: true });
    const bytes = new Uint8Array([1, 2, 3, 255]);
    await s.put("photos/u1/avatar.jpg", bytes);
    const onDisk = await readFile(join(dir, "photos/u1/avatar.jpg"));
    expect(Buffer.from(onDisk).equals(Buffer.from(bytes))).toBe(true);
  });
});

describe("photo store — Vercel guard (no writable filesystem)", () => {
  beforeEach(() => {
    // PHOTO_STORAGE defaults to "local" — this reproduces the production
    // ENOENT ('/var/task/storage/...') without anyone having to misconfigure
    // anything.
    process.env["VERCEL"] = "1";
    __resetPhotoStore();
  });

  it("still honors an explicit non-local provider the same as off-Vercel", () => {
    process.env["PHOTO_STORAGE"] = "s3";
    __resetPhotoStore();
    expect(getPhotoStore().kind).toBe("memory");
  });
});

describe("photo store — database backend (Vercel-safe durable storage)", () => {
  it("PHOTO_STORAGE=database is selectable explicitly, anywhere", () => {
    process.env["PHOTO_STORAGE"] = "database";
    __resetPhotoStore();
    expect(getPhotoStore().kind).toBe("database");
    expect(describePhotoStorage()).toEqual({ provider: "database", durable: true });
  });

  it("is used automatically on Vercel when the DB is configured, instead of memory", () => {
    process.env["VERCEL"] = "1";
    process.env["DATABASE_URL"] = "mysql://user:pass@example.invalid:3306/officeverse";
    __resetPhotoStore();
    expect(getPhotoStore().kind).toBe("database");
    expect(describePhotoStorage()).toEqual({ provider: "database", durable: true });
  });

  it("falls back to memory only when Vercel AND no DB is configured at all", () => {
    process.env["VERCEL"] = "1";
    __resetPhotoStore();
    expect(getPhotoStore().kind).toBe("memory");
    expect(describePhotoStorage()).toEqual({ provider: "memory", durable: false });
  });

  it("rejects unsafe keys before ever reaching the database", async () => {
    process.env["PHOTO_STORAGE"] = "database";
    __resetPhotoStore();
    const s = getPhotoStore();
    await expect(s.put("../etc/passwd", new Uint8Array([1]))).rejects.toThrow();
    await expect(s.get("/etc/passwd")).rejects.toThrow();
    await expect(s.exists("")).rejects.toThrow();
    await expect(s.deleteKey("x".repeat(501))).rejects.toThrow();
  });
});
