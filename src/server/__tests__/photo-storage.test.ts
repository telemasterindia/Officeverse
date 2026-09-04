import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetPhotoStore, describePhotoStorage, getPhotoStore } from "../hr/photo-storage";

const ENVK = ["PHOTO_STORAGE", "PHOTO_LOCAL_DIR", "VERCEL"] as const;
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

  it("never constructs the filesystem store on Vercel, even with the default provider", () => {
    expect(getPhotoStore().kind).toBe("memory");
  });

  it("put/get round-trips in memory instead of throwing ENOENT", async () => {
    const s = getPhotoStore();
    const bytes = new Uint8Array([9, 9, 9]);
    await s.put("photos/u2/avatar.jpg", bytes);
    const got = await s.get("photos/u2/avatar.jpg");
    expect(got && Buffer.from(got).equals(Buffer.from(bytes))).toBe(true);
  });

  it("still honors an explicit non-local provider the same as off-Vercel", () => {
    process.env["PHOTO_STORAGE"] = "s3";
    __resetPhotoStore();
    expect(getPhotoStore().kind).toBe("memory");
  });
});
