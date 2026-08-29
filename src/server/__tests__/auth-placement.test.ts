import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toPublicUser } from "../db/repos/users";
import { loginSchema } from "../validation";

const authFns = join(__dirname, "..", "..", "lib", "officeverse", "auth-fns.ts");

describe("auth server-function placement + shape", () => {
  it("no auth module remains under src/server/api (client import-protection)", () => {
    const files = readdirSync(join(__dirname, "..", "api"));
    expect(files).not.toContain("auth.ts");
  });

  it("auth-fns.ts exposes exactly login / logout / me / changePassword", () => {
    const src = readFileSync(authFns, "utf8");
    const fns = [...src.matchAll(/export const (\w+Fn)\b/g)].map((m) => m[1]).sort();
    expect(fns).toEqual(["changePasswordFn", "loginFn", "logoutFn", "meFn"]);
  });

  it("the login handler never returns a password hash", () => {
    const src = readFileSync(authFns, "utf8");
    expect(src).not.toMatch(/passwordHash|password_hash/);
    // it returns the service's `PublicUser`, which has no hash field
  });
});

describe("login input cannot carry a role / identity override", () => {
  it("loginSchema accepts only email + password; extra keys are stripped", () => {
    const parsed = loginSchema.parse({
      email: "ADMIN@Officeverse.dev",
      password: "x",
      role: "admin",
      userId: 1,
      agentId: 99,
    } as Record<string, unknown>);
    expect(parsed).toEqual({ email: "admin@officeverse.dev", password: "x" });
    expect(parsed).not.toHaveProperty("role");
    expect(parsed).not.toHaveProperty("userId");
  });
});

describe("PublicUser is sanitised", () => {
  it("toPublicUser drops password_hash and never re-adds it", () => {
    const row = {
      id: 1,
      email: "a@b.c",
      passwordHash: "$argon2id$dontleakme",
      fullName: "A B",
      role: "agent" as const,
      process: "US" as const,
      status: "active" as const,
      phone: null,
      photoAssetId: null,
      mustChangePassword: false,
      lastLoginAt: null,
      createdAt: "2020-01-01 00:00:00",
      updatedAt: "2020-01-01 00:00:00",
    };
    const pub = toPublicUser(row);
    expect(pub).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(pub)).not.toContain("argon2");
    expect(JSON.stringify(pub)).not.toContain("dontleakme");
  });
});
