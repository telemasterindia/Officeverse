/**
 * Officeverse — salary-slip document storage abstraction (Phase 14).
 *
 * The salary-slip PDF bytes need durable, immutable storage. That backend does
 * not exist yet (Mac = development only; GoDaddy/cPanel object storage is the
 * eventual target). This module defines the seam and ships a DEVELOPMENT-ONLY
 * in-memory implementation.
 *
 * PRODUCTION REQUIREMENT (DEFERRED): wire `getSalarySlipStore()` to a durable
 * store (cPanel path outside the web root, S3/R2, or a DB blob table) before
 * salary slips are used for real. The in-memory store loses everything on
 * restart — but because `renderSalarySlipPdf` is pure and deterministic and the
 * slip row keeps every input value, a lost blob is re-generated identically and
 * verified against `content_sha256`.
 */

export interface SalarySlipStore {
  readonly kind: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  has(key: string): Promise<boolean>;
}

class MemorySalarySlipStore implements SalarySlipStore {
  readonly kind = "memory";
  private readonly map = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.map.set(key, bytes);
  }
  async get(key: string): Promise<Uint8Array | null> {
    return this.map.get(key) ?? null;
  }
  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }
}

const memoryStore = new MemorySalarySlipStore();

export function getSalarySlipStore(): SalarySlipStore {
  // Only the dev store exists today. A production store is selected here later.
  return memoryStore;
}

/** Deterministic, collision-free storage key for a slip version. */
export function salarySlipStorageKey(userId: number, periodMonth: string, version: number): string {
  return `salary-slips/${periodMonth}/u${Math.max(0, Math.trunc(userId))}/v${Math.max(
    1,
    Math.trunc(version),
  )}.pdf`;
}
