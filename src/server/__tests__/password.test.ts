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
});
