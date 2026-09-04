/**
 * DatabaseBlobStore — LIVE dryrun UAT (opt-in, DB-touching).
 * Confirms the Vercel-safe "database" storage provider actually round-trips
 * bytes through the real MySQL `storage_blobs` table (migration 0027).
 *
 * SAFETY: asserts SELECT DATABASE() matches a dryrun DB first (same guard
 * style as scripts/seed-uat.mjs). Deletes every row it creates.
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/server/__tests__/db-blob-store.itest.ts --config vitest.itest.config.ts
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import { DatabaseBlobStore } from "../db-blob-store";

let conn: mysql.Connection;
const KEY_PREFIX = "itest-db-blob-store/";
const keys: string[] = [];

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const dbName = (
    (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown]
  )[0][0]!.v;
  if (!/dryrun/i.test(dbName)) {
    throw new Error(`REFUSING to run — connected database "${dbName}" is not a dryrun DB.`);
  }
});

afterAll(async () => {
  if (keys.length) {
    await conn.query("DELETE FROM storage_blobs WHERE storage_key IN (?)", [keys]);
  }
  await conn?.end();
});

test("put/get/exists/deleteKey round-trip exact bytes through the real storage_blobs table", async () => {
  const store = new DatabaseBlobStore();
  const key = `${KEY_PREFIX}${Date.now()}.bin`;
  keys.push(key);

  expect(await store.exists(key)).toBe(false);
  expect(await store.get(key)).toBeNull();

  const bytes = new Uint8Array([0, 1, 2, 3, 254, 255, 37, 80, 68, 70]);
  await store.put(key, bytes, "application/octet-stream");

  expect(await store.exists(key)).toBe(true);
  const got = await store.get(key);
  expect(got && Buffer.from(got).equals(Buffer.from(bytes))).toBe(true);

  // overwrite (ON DUPLICATE KEY UPDATE) — same key, different bytes
  const bytes2 = new Uint8Array([9, 9, 9]);
  await store.put(key, bytes2);
  const got2 = await store.get(key);
  expect(got2 && Buffer.from(got2).equals(Buffer.from(bytes2))).toBe(true);

  await store.deleteKey(key);
  expect(await store.exists(key)).toBe(false);
  expect(await store.get(key)).toBeNull();
});

test("survives a fresh DatabaseBlobStore instance (proves durability, not an in-process cache)", async () => {
  const key = `${KEY_PREFIX}fresh-instance-${Date.now()}.bin`;
  keys.push(key);
  const bytes = new Uint8Array([1, 2, 3]);

  await new DatabaseBlobStore().put(key, bytes);
  // A brand-new instance — no shared in-memory state — must still see it.
  const got = await new DatabaseBlobStore().get(key);
  expect(got && Buffer.from(got).equals(Buffer.from(bytes))).toBe(true);
});
