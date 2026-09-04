/**
 * Officeverse — durable key→bytes storage backed by the EXISTING MySQL
 * database (Vercel-safe production storage; Phase 24).
 *
 * This is NOT a new storage provider in the "third-party service" sense —
 * it's the same `getDb()` connection every other table in this app already
 * uses (proven reachable in production), reused for the small binary
 * payloads this app stores (photo ≤ PHOTO_MAX_BYTES, celebration clip ≤
 * MAX_CELEBRATION_BYTES — both a few MB). `company_profile.logo_data`
 * already stores the company logo's bytes in this same database (as base64
 * text); this is the same idea generalised to a keyed table instead of one
 * singleton row, using a real `LONGBLOB` column instead of base64 (no ~33%
 * size inflation, no text-column length juggling).
 *
 * Deliberately NOT used for salary-slip PDFs or lead documents — those are
 * unbounded/larger and keep their existing filesystem (GoDaddy) / in-memory
 * (dev) stores; see hr/salary-slip-storage.ts and leads/document-storage.ts.
 *
 * Unlike the in-memory stores this replaces on Vercel, every write here
 * survives a cold start — it's a normal row in the same GoDaddy MySQL
 * database that already holds every other durable fact in this app.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { storageBlobs } from "@/lib/db/schema";
import { nowIST } from "./time";

const MAX_KEY_LENGTH = 500; // matches storage_blobs.storage_key column width

/** Same shape of check the filesystem/memory stores already apply to keys —
 *  server-generated keys only, never a raw client value. */
function assertSafeKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new Error(
      `storage key must be a non-empty string of at most ${MAX_KEY_LENGTH} characters`,
    );
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(key) || key.startsWith("/") || /\0/.test(key)) {
    throw new Error("invalid storage key");
  }
}

export interface DbBackedKeyedStore {
  readonly kind: "database";
  put(key: string, bytes: Uint8Array, mime?: string | null): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  deleteKey(key: string): Promise<void>;
}

/** Generic durable blob store — one shared `storage_blobs` table, namespaced
 *  by the caller's own key prefix (e.g. "photos/…", "celebrations/…"). */
export class DatabaseBlobStore implements DbBackedKeyedStore {
  readonly kind = "database" as const;

  async put(key: string, bytes: Uint8Array, mime: string | null = null): Promise<void> {
    assertSafeKey(key);
    const buf = Buffer.from(bytes);
    const now = nowIST();
    await getDb()
      .insert(storageBlobs)
      .values({
        storageKey: key,
        bytes: buf,
        mime,
        sizeBytes: buf.byteLength,
        createdAt: now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: { bytes: buf, mime, sizeBytes: buf.byteLength, updatedAt: now },
      });
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertSafeKey(key);
    const rows = await getDb()
      .select({ bytes: storageBlobs.bytes })
      .from(storageBlobs)
      .where(eq(storageBlobs.storageKey, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return new Uint8Array(row.bytes);
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    const rows = await getDb()
      .select({ storageKey: storageBlobs.storageKey })
      .from(storageBlobs)
      .where(eq(storageBlobs.storageKey, key))
      .limit(1);
    return rows.length > 0;
  }

  async deleteKey(key: string): Promise<void> {
    assertSafeKey(key);
    await getDb().delete(storageBlobs).where(eq(storageBlobs.storageKey, key));
  }
}
