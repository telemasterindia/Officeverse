/**
 * Officeverse — salary-slip document storage abstraction (Phase 14 + Phase 15).
 *
 * The DB row (salary_slips) stays the source of truth for every field. This
 * module only stores/loads the exact PDF BYTES.
 *
 * Providers (chosen by DOCUMENT_STORAGE_PROVIDER):
 *   - "memory"      → in-process Map (development / tests only; default)
 *   - "filesystem"  → durable files under OFFICEVERSE_DOCUMENT_ROOT
 *                     (the intended GoDaddy / cPanel production backend)
 *
 * The storage KEY is always generated server-side (`salarySlipStorageKey`). The
 * filesystem provider resolves a key only UNDERNEATH the configured root and
 * rejects absolute paths and `..` traversal. It never sees a client value.
 *
 * A lost or corrupt file is not fatal: `renderSalarySlipPdf` is pure and
 * deterministic and the slip row keeps every input, so the document is
 * regenerated identically and re-verified against `content_sha256`.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { env, isVercel } from "../env";

export interface SalarySlipStore {
  readonly kind: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  /** kept for back-compat with Phase-14 callers */
  has(key: string): Promise<boolean>;
  deleteKey(key: string): Promise<void>;
  ensureReady(): Promise<void>;
}

/* --------------------------- key path safety -------------------- */

/**
 * Resolve a server-generated storage key to an absolute path underneath `root`.
 * Throws on absolute keys, `..` traversal, or anything that escapes the root.
 * PURE (no I/O) — unit-tested directly.
 */
export function resolveDocumentPath(root: string, key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("storage key must be a non-empty string");
  }
  if (isAbsolute(key) || /^[A-Za-z]:[\\/]/.test(key)) {
    throw new Error("storage key must not be an absolute path");
  }
  const norm = key.replace(/\\/g, "/");
  if (norm.split("/").some((seg) => seg === ".." || seg === ".")) {
    throw new Error("storage key must not contain '.' or '..' segments");
  }
  if (/\0/.test(key)) throw new Error("storage key must not contain NUL");

  const absRoot = resolve(root);
  const abs = resolve(absRoot, norm);
  if (abs !== absRoot && !abs.startsWith(absRoot + sep)) {
    throw new Error("resolved path escapes the storage root");
  }
  return abs;
}

/* ----------------------------- memory --------------------------- */

class MemorySalarySlipStore implements SalarySlipStore {
  readonly kind = "memory";
  private readonly map = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array): Promise<void> {
    // still reject obviously unsafe keys so behaviour matches the fs provider
    if (isAbsolute(key) || key.split(/[\\/]/).some((s) => s === "..")) {
      throw new Error("invalid storage key");
    }
    this.map.set(key, Uint8Array.from(bytes));
  }
  async get(key: string): Promise<Uint8Array | null> {
    const v = this.map.get(key);
    return v ? Uint8Array.from(v) : null;
  }
  async exists(key: string): Promise<boolean> {
    return this.map.has(key);
  }
  async has(key: string): Promise<boolean> {
    return this.exists(key);
  }
  async deleteKey(key: string): Promise<void> {
    this.map.delete(key);
  }
  async ensureReady(): Promise<void> {
    /* nothing to do */
  }
}

/* --------------------------- filesystem ------------------------- */

class FilesystemSalarySlipStore implements SalarySlipStore {
  readonly kind = "filesystem";
  constructor(private readonly root: string) {}

  private path(key: string): string {
    return resolveDocumentPath(this.root, key);
  }

  async ensureReady(): Promise<void> {
    await mkdir(resolve(this.root), { recursive: true });
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const abs = this.path(key);
    const dir = abs.slice(0, abs.lastIndexOf(sep));
    await mkdir(dir, { recursive: true });
    await writeFile(abs, Buffer.from(bytes));
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(this.path(key));
      return new Uint8Array(buf);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }
  async has(key: string): Promise<boolean> {
    return this.exists(key);
  }

  async deleteKey(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/* --------------------------- resolution ------------------------ */

let cached: { key: string; store: SalarySlipStore } | null = null;

function currentProviderKey(): string {
  const provider = (env("DOCUMENT_STORAGE_PROVIDER") ?? "memory").toLowerCase();
  const root = env("OFFICEVERSE_DOCUMENT_ROOT") ?? "";
  return `${provider}:${root}`;
}

/**
 * Resolve the configured document store. `filesystem` requires
 * `OFFICEVERSE_DOCUMENT_ROOT` (relative or absolute; never hard-coded here).
 * Anything else → the in-memory dev store.
 */
export function getSalarySlipStore(): SalarySlipStore {
  const key = currentProviderKey();
  if (cached && cached.key === key) return cached.store;

  const [provider] = key.split(":");
  let store: SalarySlipStore;
  if (provider === "filesystem") {
    // Vercel Functions have no writable persistent filesystem (not even a
    // correctly-configured, GoDaddy-style absolute root — only /tmp exists,
    // and that's scratch space for one invocation, not durable storage).
    // Salary slips are payroll records: silently swapping to the in-memory
    // store would look like success and then lose the bytes, which is worse
    // than a clear, loud failure — so this refuses at construction time
    // instead of failing deep inside mkdir/writeFile with a raw ENOENT.
    if (isVercel()) {
      throw new Error(
        "DOCUMENT_STORAGE_PROVIDER=filesystem is not supported on Vercel — no persistent filesystem is available. Configure a real object-storage backend for salary-slip PDFs before enabling this on Vercel.",
      );
    }
    const root = env("OFFICEVERSE_DOCUMENT_ROOT");
    if (!root) {
      throw new Error(
        "DOCUMENT_STORAGE_PROVIDER=filesystem requires OFFICEVERSE_DOCUMENT_ROOT to be set",
      );
    }
    store = new FilesystemSalarySlipStore(root);
  } else {
    store = new MemorySalarySlipStore();
  }
  cached = { key, store };
  return store;
}

/** test helper — drop the memoised store so env changes take effect */
export function __resetSalarySlipStore(): void {
  cached = null;
}

export function describeDocumentStorage(): { provider: string; rootConfigured: boolean } {
  const provider = (env("DOCUMENT_STORAGE_PROVIDER") ?? "memory").toLowerCase();
  return { provider, rootConfigured: Boolean(env("OFFICEVERSE_DOCUMENT_ROOT")) };
}

/** Deterministic, collision-free storage key for a slip version. Server-only. */
export function salarySlipStorageKey(userId: number, periodMonth: string, version: number): string {
  const month = /^\d{4}-\d{2}$/.test(periodMonth) ? periodMonth : "unknown-month";
  return `salary-slips/${month}/u${Math.max(0, Math.trunc(userId))}/v${Math.max(
    1,
    Math.trunc(version),
  )}.pdf`;
}
