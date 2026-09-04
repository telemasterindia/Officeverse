import { hash as argon2Hash } from "@node-rs/argon2";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, passwordImpl, verifyPassword } from "../password";

const PW = "Sup3r-secret!-passphrase";

describe("password hashing (Phase 3 / 14)", () => {
  it("uses a real KDF, never stores plaintext", async () => {
    const h = await hashPassword(PW);
    expect(typeof h).toBe("string");
    expect(h).not.toBe(PW);
    expect(h.includes(PW)).toBe(false);
    // argon2id => "$argon2id$...", bcrypt fallback => "$2a$" / "$2b$"
    expect(h.startsWith("$argon2") || h.startsWith("$2")).toBe(true);
  });

  it("verifies the correct password and rejects a wrong one", async () => {
    const h = await hashPassword(PW);
    expect(await verifyPassword(h, PW)).toBe(true);
    expect(await verifyPassword(h, "not the password")).toBe(false);
  });

  it("salts — two hashes of the same password differ", async () => {
    const [a, b] = await Promise.all([hashPassword(PW), hashPassword(PW)]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, PW)).toBe(true);
    expect(await verifyPassword(b, PW)).toBe(true);
  });

  it("verifyPassword never throws on garbage input", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
    expect(await verifyPassword("", "")).toBe(false);
  });

  it("reports a known implementation", async () => {
    expect(["argon2id", "bcrypt"]).toContain(await passwordImpl());
  });

  it("needsRehash is false for a freshly produced hash", async () => {
    expect(await needsRehash(await hashPassword(PW))).toBe(false);
  });

  // Regression: verification must dispatch on the STORED hash's own prefix,
  // not on whichever implementation this process happens to have picked for
  // hashing *new* passwords. A bcrypt hash (e.g. written directly into the DB
  // by an admin, or predating argon2 support) must still verify in a process
  // where argon2id is the active hasher, and vice versa — otherwise a
  // correct password is rejected purely because of a format mismatch, not a
  // wrong-password mismatch.
  it("verifies a bcrypt hash even when argon2id is the active hasher", async () => {
    const bcryptHash = await bcrypt.hash(PW, 12);
    expect(bcryptHash.startsWith("$2")).toBe(true);
    expect(await verifyPassword(bcryptHash, PW)).toBe(true);
    expect(await verifyPassword(bcryptHash, "wrong password")).toBe(false);
  });

  it("tolerates a trailing newline/space on the stored hash (hand-pasted via a DB admin tool)", async () => {
    const bcryptHash = await bcrypt.hash(PW, 12);
    expect(await verifyPassword(`${bcryptHash}\n`, PW)).toBe(true);
    expect(await verifyPassword(`  ${bcryptHash}  `, PW)).toBe(true);
  });

  it("verifies an argon2id hash directly (independent of the active hasher)", async () => {
    const argon2HashStr = await argon2Hash(PW, {
      algorithm: 2,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
    expect(argon2HashStr.startsWith("$argon2id")).toBe(true);
    expect(await verifyPassword(argon2HashStr, PW)).toBe(true);
    expect(await verifyPassword(argon2HashStr, "wrong password")).toBe(false);
  });
});
