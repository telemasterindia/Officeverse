import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetAssetStore, getAssetStore } from "../live/asset-storage";

const ENVK = ["CELEBRATION_STORAGE", "PHOTO_STORAGE", "CELEBRATION_ASSET_DIR", "VERCEL"] as const;
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

  it("never constructs the filesystem store on Vercel, even with the default provider", () => {
    expect(getAssetStore().kind).toBe("memory");
  });

  it("put/get round-trips in memory instead of throwing ENOENT", async () => {
    const s = getAssetStore();
    const bytes = new Uint8Array([4, 5, 6]);
    await s.put("celebrations/GOLD/2-clip.mp4", bytes);
    const got = await s.get("celebrations/GOLD/2-clip.mp4");
    expect(got && Buffer.from(got).equals(Buffer.from(bytes))).toBe(true);
  });
});
