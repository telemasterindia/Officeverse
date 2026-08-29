/**
 * Officeverse — best-effort in-memory login rate limiter (Phase 8 / 14).
 *
 * Single-process sliding window. Good enough for ~10–100 concurrent users on
 * one cPanel Node process. If Officeverse later runs multiple processes, back
 * this with a `login_attempts` table — the interface stays the same.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 8;

type Bucket = { fails: number[]; lockedUntil: number };
const buckets = new Map<string, Bucket>();

function bucket(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = { fails: [], lockedUntil: 0 };
    buckets.set(key, b);
  }
  return b;
}

function prune(b: Bucket, now: number): void {
  const cutoff = now - WINDOW_MS;
  b.fails = b.fails.filter((t) => t > cutoff);
}

/** Throws-free check. Returns `{ ok, retryAfterSec }`. */
export function checkLoginRate(key: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = bucket(key);
  if (b.lockedUntil > now) {
    return { ok: false, retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000) };
  }
  prune(b, now);
  if (b.fails.length >= MAX_FAILS) {
    b.lockedUntil = now + WINDOW_MS;
    return { ok: false, retryAfterSec: Math.ceil(WINDOW_MS / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

export function recordLoginFail(key: string): void {
  const b = bucket(key);
  prune(b, Date.now());
  b.fails.push(Date.now());
}

export function clearLoginRate(key: string): void {
  buckets.delete(key);
}

/** Housekeeping — call occasionally to bound the map. */
export function sweepRateLimiter(): void {
  const now = Date.now();
  for (const [k, b] of buckets) {
    prune(b, now);
    if (b.fails.length === 0 && b.lockedUntil < now) buckets.delete(k);
  }
}
