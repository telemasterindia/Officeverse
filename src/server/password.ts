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
  verify: (hash: string, plain: string) => Promise<boolean>;
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
      verify: async (hash, plain) => {
        try {
          return await argon2.verify(hash, plain);
        } catch {
          return false;
        }
      },
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
      verify: async (hash, plain) => {
        try {
          return await bcrypt.compare(plain, hash);
        } catch {
          return false;
        }
      },
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

/** Verify a plaintext password against a stored hash. Never throws. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  if (!hash || !plain) return false;
  return (await hasher()).verify(hash, plain);
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
