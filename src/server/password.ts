/**
 * Officeverse — password hashing (Phase 3 / Phase 14).
 *
 * Primary:  @node-rs/argon2  (Argon2id, prebuilt binary — no node-gyp).
 * Fallback: bcryptjs         (pure JS, cost 12) — used automatically if the
 *           argon2 prebuilt cannot load on the host (e.g. an unusual GoDaddy
 *           platform). Chosen once at module load; logged as impl name only.
 *
 * NEVER logs or returns plaintext passwords or hashes.
 */

type Hasher = {
  impl: "argon2id" | "bcrypt";
  hash: (plain: string) => Promise<string>;
};

let _hasher: Promise<Hasher> | null = null;

// OWASP-aligned, tuned to be comfortable on shared hosting.
const ARGON2_OPTS = {
  // algorithm 2 = Argon2id
  algorithm: 2 as const,
  memoryCost: 19_456, // ~19 MiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};
const BCRYPT_ROUNDS = 12;

async function build(): Promise<Hasher> {
  try {
    const argon2 = await import("@node-rs/argon2");
    // smoke test the native binding once
    const probe = await argon2.hash("probe", ARGON2_OPTS);
    await argon2.verify(probe, "probe");
    return {
      impl: "argon2id",
      hash: (plain) => argon2.hash(plain, ARGON2_OPTS),
    };
  } catch (err) {
    console.warn(
      "[password] @node-rs/argon2 unavailable, falling back to bcryptjs:",
      err instanceof Error ? err.message : String(err),
    );
    const bcrypt = (await import("bcryptjs")).default;
    return {
      impl: "bcrypt",
      hash: (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS),
    };
  }
}

function hasher(): Promise<Hasher> {
  if (!_hasher) _hasher = build();
  return _hasher;
}

/** Hash a plaintext password. Returns a self-describing hash string. */
export async function hashPassword(plain: string): Promise<string> {
  if (!plain || plain.length < 1) throw new Error("password required");
  return (await hasher()).hash(plain);
}

/**
 * Verify a plaintext password against a stored hash. Never throws.
 *
 * Hashes are self-describing (PHC `$argon2id$…` vs bcrypt `$2a$…` / `$2b$…` /
 * `$2y$…`), so verification dispatches on the STORED hash's own prefix —
 * NOT on whichever implementation `build()` happened to pick for hashing new
 * passwords in this process. This matters because `build()`'s choice is a
 * one-time, per-process probe (argon2 native binding present → argon2id,
 * else bcrypt); a hash written in the other format would previously be
 * unverifiable in that process even with the correct password, since e.g. an
 * argon2id hash handed to `bcrypt.compare()` (or vice versa) is a format
 * error, not a mismatch. Per-hash dispatch is also what makes bcrypt→argon2
 * rehashing (`needsRehash`, below) actually work: a legacy bcrypt hash must
 * still verify once argon2id becomes the active hasher for new hashes.
 *
 * The stored hash is trimmed before use — a hash hand-pasted into a DB admin
 * tool (e.g. a phpMyAdmin textarea) can pick up a trailing newline/space,
 * which would otherwise turn a correct hash into an unparseable one.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  if (!hash || !plain) return false;
  const h = hash.trim();
  if (h.startsWith("$argon2")) {
    try {
      const argon2 = await import("@node-rs/argon2");
      return await argon2.verify(h, plain);
    } catch {
      return false;
    }
  }
  if (h.startsWith("$2")) {
    try {
      const bcrypt = (await import("bcryptjs")).default;
      return await bcrypt.compare(plain, h);
    } catch {
      return false;
    }
  }
  return false;
}

/** Which implementation is active ("argon2id" | "bcrypt"). */
export async function passwordImpl(): Promise<Hasher["impl"]> {
  return (await hasher()).impl;
}

/**
 * True when a stored hash should be re-hashed on next successful login —
 * i.e. it is a bcrypt hash but Argon2id is now available.
 */
export async function needsRehash(hash: string): Promise<boolean> {
  const impl = await passwordImpl();
  return impl === "argon2id" && hash.startsWith("$2");
}
