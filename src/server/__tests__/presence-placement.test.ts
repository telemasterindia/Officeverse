import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const presenceFns = join(root, "lib", "officeverse", "presence-fns.ts");
const presenceService = join(root, "server", "presence", "service.ts");

describe("agent-presence endpoint — Admin only, no session internals leaked", () => {
  it("no presence module under src/server/api (client import-protection)", () => {
    expect(readdirSync(join(root, "server", "api")).some((f) => /presence/i.test(f))).toBe(false);
  });

  it('the presence server fn enforces requireRole("admin")', () => {
    const src = readFileSync(presenceFns, "utf8");
    expect(src).toMatch(/requireRole\(\s*["']admin["']\s*\)/);
    // exactly one exported fn
    const fns = [...src.matchAll(/export const (\w+Fn)\b/g)].map((m) => m[1]);
    expect(fns).toEqual(["agentPresenceFn"]);
  });

  it("the presence service never selects session token / cookie / IP columns", () => {
    // strip block + line comments so we only check real code
    const code = readFileSync(presenceService, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/sessions\.(id|ip|userAgent)\b/);
    expect(code).not.toMatch(/passwordHash|password_hash/);
    // the exported row interface exposes no ip / token / cookie field
    expect(code).not.toMatch(/^\s*(ip|token|cookie|sessionToken|userAgent)\s*:/m);
  });

  it("the presence service uses server-authoritative users.process (not a client value)", () => {
    const src = readFileSync(presenceService, "utf8");
    expect(src).toMatch(/process:\s*users\.process/);
    expect(src).not.toMatch(/input\.|req\.|body\.|data\.process/);
  });
});
