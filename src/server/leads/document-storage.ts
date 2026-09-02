/**
 * Officeverse — Lead supporting-document blob storage (Admin/Lead UAT §5).
 *
 * PRIVATE storage for the raw bytes of a lead's supporting documents. The
 * `lead_documents` DB row is the source of truth for every field; this module
 * only puts / gets / deletes the bytes.
 *
 * Storage location is DELIBERATELY outside any statically served directory:
 *   - "filesystem" → files under OFFICEVERSE_DOCUMENT_ROOT (the same private
 *                    root the salary-slip store uses on GoDaddy / cPanel),
 *                    namespaced under `lead-documents/`. Never under
 *                    `public/`, `src/`, `dist/` or any Vite asset dir.
 *   - anything else → in-memory dev store (tests / local).
 *
 * There is NO public URL and NO internal static route for these bytes: they
 * are only ever returned through the session-authenticated, lead-access-checked
 * `downloadLeadDocument` server function. The storage KEY is always generated
 * server-side (`leadDocumentKey`); path traversal is rejected by
 * `resolveDocumentPath`. Uploaded files are stored, never executed.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { env } from "../env";
import { resolveDocumentPath } from "../hr/salary-slip-storage";
import type { LeadDocMime } from "./document-validate";

export interface LeadDocStore {
  readonly kind: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  deleteKey(key: string): Promise<void>;
}

class MemoryLeadDocStore implements LeadDocStore {
  readonly kind = "memory";
  private readonly map = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array): Promise<void> {
    if (/(^|[\\/])\.\.([\\/]|$)/.test(key) || key.startsWith("/")) throw new Error("invalid key");
    this.map.set(key, Uint8Array.from(bytes));
  }
  async get(key: string): Promise<Uint8Array | null> {
    const v = this.map.get(key);
    return v ? Uint8Array.from(v) : null;
  }
  async deleteKey(key: string): Promise<void> {
    this.map.delete(key);
  }
}

class FilesystemLeadDocStore implements LeadDocStore {
  readonly kind = "filesystem";
  constructor(private readonly root: string) {}
  private path(key: string): string {
    return resolveDocumentPath(this.root, key);
  }
  async put(key: string, bytes: Uint8Array): Promise<void> {
    const abs = this.path(key);
    await mkdir(abs.slice(0, abs.lastIndexOf(sep)), { recursive: true });
    await writeFile(abs, Buffer.from(bytes));
  }
  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
  async deleteKey(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

let cached: { key: string; store: LeadDocStore } | null = null;

export function getLeadDocStore(): LeadDocStore {
  const provider = (env("DOCUMENT_STORAGE_PROVIDER") ?? "memory").toLowerCase();
  const root = env("OFFICEVERSE_DOCUMENT_ROOT") ?? "";
  const cacheKey = `${provider}:${root}`;
  if (cached && cached.key === cacheKey) return cached.store;

  let store: LeadDocStore;
  if (provider === "filesystem") {
    if (!root) {
      throw new Error(
        "DOCUMENT_STORAGE_PROVIDER=filesystem requires OFFICEVERSE_DOCUMENT_ROOT to be set",
      );
    }
    store = new FilesystemLeadDocStore(resolve(root));
  } else {
    store = new MemoryLeadDocStore();
  }
  cached = { key: cacheKey, store };
  return store;
}

/** test helper — drop the memoised store so env changes take effect */
export function __resetLeadDocStore(): void {
  cached = null;
}

const EXT_FOR: Record<LeadDocMime, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Server-generated, unguessable storage key:
 *   `lead-documents/<leadCode>/<32-hex-random>.<ext>`
 * The random component means the key cannot be derived from the lead code, and
 * the key is never exposed to the client anyway (downloads go by numeric id
 * through an authenticated server fn).
 */
export function leadDocumentKey(leadCode: string, mime: LeadDocMime): string {
  const safeLead = leadCode.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 32) || "lead";
  const rand = randomBytes(16).toString("hex");
  return `lead-documents/${safeLead}/${rand}.${EXT_FOR[mime]}`;
}
