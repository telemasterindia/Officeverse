/**
 * ADMIN — Follow-up & Closer assignment business-rule fix.
 *
 * §10/§13 permission matrix (PURE) + structural guards that promotion moves no
 * work and that the new surfaces are Admin-authorized server-side.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_WORK_TYPES,
  assertCanReassignAssignments,
  canReassignAssignments,
  isTransferScope,
  LONG_DATED_MAX_DAYS,
  LONG_DATED_MIN_DAYS,
  TRANSFER_SCOPES,
  WORKTYPE_ROLE,
  WORKTYPE_SOURCE_ROLE,
} from "../authz/assignments";
import { assertCanPromoteStaff, canPromoteStaff } from "../authz/staff";
import { HttpError } from "../http-error";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const ROLES = ["admin", "hr", "agent", "closer"] as const;

describe("§10/§13 — ALL assignment / reassignment / promotion rights are ADMIN ONLY", () => {
  it("only Admin may bulk-reassign; HR / Agent / Closer may not", () => {
    for (const r of ROLES) {
      expect(canReassignAssignments(r)).toBe(r === "admin");
    }
    expect(() => assertCanReassignAssignments("admin")).not.toThrow();
    for (const r of ["hr", "agent", "closer"] as const) {
      expect(() => assertCanReassignAssignments(r)).toThrow(HttpError);
      try {
        assertCanReassignAssignments(r);
      } catch (e) {
        expect((e as HttpError).status).toBe(403);
      }
    }
  });

  it("only Admin may promote an Agent to Closer; HR may not", () => {
    for (const r of ROLES) {
      expect(canPromoteStaff(r)).toBe(r === "admin");
    }
    expect(() => assertCanPromoteStaff("admin")).not.toThrow();
    for (const r of ["hr", "agent", "closer"] as const) {
      expect(() => assertCanPromoteStaff(r)).toThrow(HttpError);
    }
  });
});

describe("assignment work types (§1/§7/§8/§10)", () => {
  it("covers the four Admin operations with the right source → dest roles", () => {
    expect([...ASSIGNMENT_WORK_TYPES]).toEqual([
      "AGENT_FOLLOWUPS",
      "CLOSER_LEADS",
      "CLOSER_FOLLOWUPS",
      "CLOSER_FOLLOWUPS_TO_AGENT",
    ]);
    // agent → agent follow-up transfer
    expect(WORKTYPE_SOURCE_ROLE.AGENT_FOLLOWUPS).toBe("agent");
    expect(WORKTYPE_ROLE.AGENT_FOLLOWUPS).toBe("agent");
    // closer → closer lead + follow-up transfer
    expect(WORKTYPE_SOURCE_ROLE.CLOSER_LEADS).toBe("closer");
    expect(WORKTYPE_ROLE.CLOSER_LEADS).toBe("closer");
    expect(WORKTYPE_SOURCE_ROLE.CLOSER_FOLLOWUPS).toBe("closer");
    expect(WORKTYPE_ROLE.CLOSER_FOLLOWUPS).toBe("closer");
    // closer → agent follow-up transfer (§8)
    expect(WORKTYPE_SOURCE_ROLE.CLOSER_FOLLOWUPS_TO_AGENT).toBe("closer");
    expect(WORKTYPE_ROLE.CLOSER_FOLLOWUPS_TO_AGENT).toBe("agent");
  });
});

describe("transfer scope (§2/§3) + long-dated window (§6)", () => {
  it("scope options are exactly Overdue / Due Today / Upcoming / All Pending / Selected", () => {
    expect([...TRANSFER_SCOPES]).toEqual([
      "OVERDUE",
      "DUE_TODAY",
      "UPCOMING",
      "ALL_PENDING",
      "SELECTED",
    ]);
    expect(isTransferScope("OVERDUE")).toBe(true);
    expect(isTransferScope("EVERYTHING")).toBe(false);
  });
  it("long-dated window is ≈ 2–3 months out", () => {
    expect(LONG_DATED_MIN_DAYS).toBeGreaterThanOrEqual(50);
    expect(LONG_DATED_MIN_DAYS).toBeLessThanOrEqual(65);
    expect(LONG_DATED_MAX_DAYS).toBeGreaterThanOrEqual(85);
    expect(LONG_DATED_MAX_DAYS).toBeLessThanOrEqual(130);
  });
});

describe("§9 — promotion preserves the record + history and moves NO work", () => {
  const svc = read("server/staff/service.ts");
  const promote = svc.slice(
    svc.indexOf("export async function promoteAgentToCloser"),
    svc.indexOf("export async function setStaffStatus"),
  );
  const repo = read("server/db/repos/staff.ts");
  const promoteRepo = repo.slice(
    repo.indexOf("export async function promoteAgentUserToCloser"),
    repo.indexOf("export async function emailExists"),
  );

  it("service is Admin-gated and never touches leads / follow-ups", () => {
    expect(promote).toMatch(/assertCanPromoteStaff\(actor\.role\)/);
    expect(promote).not.toMatch(/reassignFollowupOwner|reassignLeadCloser|\.update\(leads\)/);
    expect(promote).toMatch(/leads_moved: 0/);
    expect(promote).toMatch(/followups_moved: 0/);
  });

  it("repo keeps the SAME users row + the agents row (no duplicate account, no delete)", () => {
    expect(promoteRepo).toMatch(/\.update\(users\)\.set\(\{ role: "closer"/);
    expect(promoteRepo).not.toMatch(/\.delete\(agents\)|\.insert\(users\)/);
    // creates a closers registry row only if one does not already exist
    expect(promoteRepo).toMatch(/if \(!closerCode\)/);
    expect(promoteRepo).toMatch(/\.insert\(closers\)/);
  });
});

describe("§13 — the new server fns are Admin-authorized at the boundary", () => {
  it("promoteAgentFn requires the admin role", () => {
    const fns = read("lib/officeverse/staff-fns.ts");
    const fn = fns.slice(fns.indexOf("export const promoteAgentFn"));
    expect(fn).toMatch(/requireRole\("admin"\)/);
  });
  it("reassignBulkFn forwards the transfer scope; every assignment fn requires a user", () => {
    const fns = read("lib/officeverse/assignment-fns.ts");
    expect(fns).toMatch(/scope: transferScope\.optional\(\)/);
    for (const h of fns.split(/export const \w+Fn/).slice(1)) {
      expect(h).toMatch(/requireUser\(\)|requireRole\(/);
    }
  });
});
