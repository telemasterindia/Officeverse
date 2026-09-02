/**
 * CANONICAL EMPLOYEE ID FORMAT — BUSINESS RULE CORRECTION (PURE / structural).
 *
 *   Agent  → TMI_CC_###      Closer → TMI_CL_###
 *
 * The generator is the single source of truth; legacy forms still RESOLVE on
 * input but are never minted; the 0025 data migration renumbers existing rows
 * without touching any foreign key.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentCode, closerCode } from "../ids";
import {
  AGENT_CODE_RE,
  CLOSER_CODE_RE,
  isAgentCode,
  isCloserCode,
  isCanonicalAgentCode,
  isCanonicalCloserCode,
} from "@/lib/officeverse/staff-codes";

const repoRoot = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

describe("generator — canonical Employee IDs", () => {
  it("agent → TMI_CC_###, closer → TMI_CL_### (zero-padded to 3, stable)", () => {
    expect(agentCode(1)).toBe("TMI_CC_001");
    expect(agentCode(7)).toBe("TMI_CC_007");
    expect(agentCode(128)).toBe("TMI_CC_128");
    expect(closerCode(1)).toBe("TMI_CL_001");
    expect(closerCode(42)).toBe("TMI_CL_042");
    // pure function of the sequence number — same input, same output every call
    expect(agentCode(3)).toBe(agentCode(3));
  });

  it("never mints a legacy AG-##### / CL-##### / TMI_CC### code", () => {
    for (let n = 1; n <= 50; n++) {
      expect(agentCode(n)).toMatch(/^TMI_CC_\d{3,}$/);
      expect(closerCode(n)).toMatch(/^TMI_CL_\d{3,}$/);
    }
  });
});

describe("matchers — canonical is preferred, legacy still resolves", () => {
  it("accepts the canonical form", () => {
    expect(isAgentCode("TMI_CC_001")).toBe(true);
    expect(isCloserCode("TMI_CL_007")).toBe(true);
    expect(isCanonicalAgentCode("TMI_CC_001")).toBe(true);
    expect(isCanonicalCloserCode("TMI_CL_007")).toBe(true);
  });

  it("still accepts every legacy form (old exports / bookmarks keep working)", () => {
    for (const legacy of ["TMI_CC001", "TMI_CC011", "AG-90001", "AG-00001"])
      expect(AGENT_CODE_RE.test(legacy), legacy).toBe(true);
    expect(CLOSER_CODE_RE.test("CL-90001")).toBe(true);
    // …but they are NOT canonical
    expect(isCanonicalAgentCode("AG-90001")).toBe(false);
    expect(isCanonicalCloserCode("CL-90001")).toBe(false);
  });

  it("rejects a bare integer / users.id / lead id / name", () => {
    for (const bad of ["7", "42", "TMI_00012007", "Rahul Sharma", "", "CC_001", "TMI_CL"])
      expect(isAgentCode(bad) || isCloserCode(bad), bad).toBe(false);
  });
});

describe("next-code SQL runs over the canonical namespace only", () => {
  const staffRepo = read("src/server/db/repos/staff.ts");
  it("agent sequence keys off left(agent_code,7)='TMI_CC_'", () => {
    expect(staffRepo).toMatch(/left\(\$\{agents\.agentCode\}, 7\) = 'TMI_CC_'/);
    expect(staffRepo).toMatch(/substring\(\$\{agents\.agentCode\}, 8\)/);
  });
  it("closer sequence keys off left(closer_code,7)='TMI_CL_'", () => {
    expect(staffRepo).toMatch(/left\(\$\{closers\.closerCode\}, 7\) = 'TMI_CL_'/);
    expect(staffRepo).toMatch(/substring\(\$\{closers\.closerCode\}, 8\)/);
  });
});

describe("0025 migration — renumbers codes, touches no foreign key", () => {
  const sql = read("drizzle/0025_canonical_employee_codes.sql");
  it("only SETs agent_code / closer_code to the canonical CONCAT", () => {
    expect(sql).toMatch(/SET `a`\.`agent_code` = CONCAT\('TMI_CC_', LPAD/);
    expect(sql).toMatch(/SET `c`\.`closer_code` = CONCAT\('TMI_CL_', LPAD/);
    // never writes an id / user_id / any FK column
    expect(sql).not.toMatch(/SET[^\n]*(`?agent_id`?|`?closer_id`?|`?user_id`?|`?id`?)\s*=/);
  });
  it("is registered in the drizzle journal", () => {
    expect(read("drizzle/meta/_journal.json")).toContain("0025_canonical_employee_codes");
  });
});

describe("validators share the one matcher (no drifting literals)", () => {
  for (const f of ["src/server/validation/leads.ts", "src/server/validation/followups.ts"]) {
    it(`${f} imports AGENT_CODE_RE / CLOSER_CODE_RE from staff-codes`, () => {
      const src = read(f);
      expect(src).toMatch(/from "@\/lib\/officeverse\/staff-codes"/);
      expect(src).not.toMatch(/\/\^CL-\\d\{5\}\$\//); // no inline legacy-only literal left
    });
  }
});

describe("exports read the authoritative code column (not a formatted id)", () => {
  it("Data Export staff query selects agents.agentCode / closers.closerCode", () => {
    const q = read("src/server/export/queries.ts");
    expect(q).toMatch(/code: agents\.agentCode/);
    expect(q).toMatch(/code: closers\.closerCode/);
  });
  it("Reports export selects ag.agentCode / cl.closerCode", () => {
    const r = read("src/server/report/service.ts");
    expect(r).toMatch(/agent_code: ag\.agentCode/);
    expect(r).toMatch(/closer_code: cl\.closerCode/);
  });
});
