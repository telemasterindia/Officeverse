/**
 * FINAL SMALL FIX — Employee ID on /profile + Employee-code STABILITY (PURE).
 *
 * 1. /profile shows the CURRENT canonical Employee ID, sourced from the same
 *    authoritative column as every other surface (agents.agent_code /
 *    closers.closer_code) — never users.id, never generated.
 * 2. Existing employee codes are a PERMANENT identity: the 0025 migration only
 *    converts LEGACY codes and never renumbers a canonical one; the generator
 *    issues MAX(suffix)+1, never "first unused".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toPublicUser } from "../db/repos/users";
import { nextStaffSeq } from "../ids";
import { toSessionUser } from "@/lib/officeverse/session-user";
import type { User } from "@/lib/db/schema";

const repoRoot = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const U = {
  id: 99,
  email: "x@y.local",
  fullName: "X Y",
  role: "agent",
  process: "US",
  status: "active",
  phone: null,
  mustChangePassword: false,
} as unknown as User;

describe("1 — Employee ID data path", () => {
  it("PublicUser carries employeeCode; toPublicUser passes it through (default null)", () => {
    expect(toPublicUser(U).employeeCode).toBeNull();
    expect(toPublicUser(U, null, "TMI_CC_007").employeeCode).toBe("TMI_CC_007");
  });

  it("toSessionUser maps employeeCode → employeeId, and never falls back to users.id", () => {
    expect(toSessionUser(toPublicUser(U, null, "TMI_CC_007")).employeeId).toBe("TMI_CC_007");
    const blank = toSessionUser(toPublicUser(U));
    expect(blank.employeeId).toBe("");
    expect(blank.employeeId).not.toBe("99");
  });

  it("the auth service resolves the code via the shared authoritative helper", () => {
    const svc = stripComments(read("src/server/auth/service.ts"));
    expect(svc).toMatch(/employeeCodeForUser\(user\.id, user\.role\)/);
    // both entry points (login + currentPublicUser) pass it into toPublicUser
    expect(svc).toMatch(/toPublicUser\(user, photoUrl, employeeCode\)/);
    expect(svc).toMatch(/toPublicUser\(user, photoUrl, employeeCode\)/);
  });

  it("employeeCodeForUser reads agents.agent_code / closers.closer_code — never generates", () => {
    const staff = stripComments(read("src/server/db/repos/staff.ts"));
    const start = staff.indexOf("export async function employeeCodeForUser");
    const fn = staff.slice(start, staff.indexOf("\nexport ", start + 1));
    expect(fn).toMatch(/code: agents\.agentCode/);
    expect(fn).toMatch(/code: closers\.closerCode/);
    expect(fn).not.toMatch(/generate|nextStaffCode|nextStaffSeq|fmtAgentCode|fmtCloserCode/);
    // current identity first: a promoted person (role='closer') resolves to the closer code
    expect(fn).toMatch(/if \(role === "closer"\) return \(await closerCodeRow\(\)\)/);
  });

  it("the /profile route renders user.employeeId (the session field, not a raw id)", () => {
    const route = read("src/routes/_shell.profile.tsx");
    expect(route).toMatch(/label="Employee ID" value=\{user\.employeeId\}/);
    expect(route).toMatch(/\{employeeId \|\| "—"\}/);
  });
});

describe("2 — employee code stability", () => {
  // the executable statements only — SQL `--` comments stripped
  const sql = read("drizzle/0025_canonical_employee_codes.sql")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  it("the 0025 migration does NOT use ROW_NUMBER / a blanket renumber", () => {
    expect(sql).not.toMatch(/ROW_NUMBER/i);
  });

  it("0025 only rewrites LEGACY codes — canonical rows are guarded out", () => {
    expect(sql).toMatch(/WHERE `l`\.`agent_code` NOT REGEXP '\^TMI_CC_\[0-9\]\+\$'/);
    expect(sql).toMatch(/WHERE `l`\.`closer_code` NOT REGEXP '\^TMI_CL_\[0-9\]\+\$'/);
    // next number = current MAX canonical suffix + position among legacy rows
    expect(sql).toMatch(/MAX\(CAST\(SUBSTRING\(`k`\.`agent_code`, 8\) AS UNSIGNED\)\)/);
    expect(sql).toMatch(/COUNT\(\*\)[\s\S]*?`p`\.`id` <= `l`\.`id`/);
    // only the code column is written
    expect(sql).toMatch(/SET `a`\.`agent_code` = CONCAT\('TMI_CC_'/);
    expect(sql).toMatch(/SET `c`\.`closer_code` = CONCAT\('TMI_CL_'/);
    expect(sql).not.toMatch(/SET[^\n]*(`?id`?|`?user_id`?|`?agent_id`?|`?closer_id`?)\s*=/);
  });

  it("the generator issues MAX(suffix)+1 — never the first unused number", () => {
    // existing suffixes 1,2,7  →  next is 8, NOT 3
    expect(nextStaffSeq(7)).toBe(8);
    expect(nextStaffSeq(10)).toBe(11);
    expect(nextStaffSeq(0)).toBe(1); // empty namespace
    // mysql2 hands back MAX(CAST(.. AS UNSIGNED)) as a STRING — must add, not concat
    expect(nextStaffSeq("10")).toBe(11);
    expect(nextStaffSeq("007")).toBe(8);
    expect(nextStaffSeq(null)).toBe(1);
    const staff = stripComments(read("src/server/db/repos/staff.ts"));
    const fn = staff.slice(
      staff.indexOf("export async function nextStaffCode"),
      staff.indexOf("export interface InsertStaffInput"),
    );
    expect(fn).toMatch(/max\(case when left\(\$\{agents\.agentCode\}, 7\) = 'TMI_CC_'/);
    expect(fn).toMatch(/max\(case when left\(\$\{closers\.closerCode\}, 7\) = 'TMI_CL_'/);
    expect(fn).not.toMatch(/ROW_NUMBER|max\(\$\{agents\.id\}\)|max\(\$\{closers\.id\}\)/i);
  });
});
