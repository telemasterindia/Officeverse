/**
 * ADMIN + HR — STAFF PROFILE MANAGEMENT & LIFECYCLE FIX.
 *
 * §11 permission matrix (PURE) + §4 date validation + structural guards that the
 * fixes are wiring-only (authoritative role filter, deactivation model, no
 * historical deletion, existing photo/salary systems reused).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCanManageStaff,
  assertCanPromoteStaff,
  assertCanRemoveStaff,
  canManageStaff,
  canPromoteStaff,
  canRemoveStaff,
} from "../authz/staff";
import { isValidYmd } from "../staff/service";
import { HttpError } from "../http-error";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const ROLES = ["admin", "hr", "agent", "closer"] as const;

function throws403(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof HttpError && e.status === 403;
  }
}

describe("§11 — permission matrix", () => {
  it("EDIT profile + REPLACE photo → Admin + HR only", () => {
    expect(canManageStaff("admin")).toBe(true);
    expect(canManageStaff("hr")).toBe(true);
    expect(canManageStaff("agent")).toBe(false);
    expect(canManageStaff("closer")).toBe(false);
    for (const r of ["agent", "closer"] as const)
      expect(throws403(() => assertCanManageStaff(r))).toBe(true);
    expect(() => assertCanManageStaff("hr")).not.toThrow();
  });

  it("PROMOTE Agent → Closer → Admin ONLY (HR ❌ 403)", () => {
    for (const r of ROLES) expect(canPromoteStaff(r)).toBe(r === "admin");
    for (const r of ["hr", "agent", "closer"] as const)
      expect(throws403(() => assertCanPromoteStaff(r))).toBe(true);
    expect(() => assertCanPromoteStaff("admin")).not.toThrow();
  });

  it("REMOVE / deactivate → Admin ONLY (HR ❌ 403)", () => {
    for (const r of ROLES) expect(canRemoveStaff(r)).toBe(r === "admin");
    for (const r of ["hr", "agent", "closer"] as const)
      expect(throws403(() => assertCanRemoveStaff(r))).toBe(true);
    expect(() => assertCanRemoveStaff("admin")).not.toThrow();
  });
});

describe("§4 — DOB / anniversary date validation (no impossible dates)", () => {
  it("accepts real dates", () => {
    for (const ok of ["1990-06-15", "2000-01-01", "2024-02-29", "1975-12-31"])
      expect(isValidYmd(ok), ok).toBe(true);
  });
  it("rejects impossible / malformed dates", () => {
    for (const bad of [
      "2024-02-30",
      "2023-13-01",
      "2023-00-10",
      "2023-05-32",
      "1990/06/15",
      "",
      "abc",
      "90-6-1",
    ])
      expect(isValidYmd(bad), bad).toBe(false);
  });
});

describe("§5/§9 — the roster fix is an AUTHORITATIVE role filter, not row deletion", () => {
  const repo = stripComments(read("server/db/repos/staff.ts"));
  const assignRepo = stripComments(read("server/db/repos/assignments.ts"));

  it("listStaffRows filters by users.role (a promoted Agent's historical agents row does not leak)", () => {
    const fn = repo.slice(
      repo.indexOf("export async function listStaffRows"),
      repo.indexOf("export async function getStaffRowByCode"),
    );
    expect(fn).toMatch(/const conds = \[eq\(users\.role, kind\)\]/);
    expect(fn).toMatch(/if \(opts\.activeOnly\) conds\.push\(eq\(users\.status, "active"\)\)/);
  });

  it("the operational assignment rosters also require current role + active status", () => {
    for (const marker of ["listAgentRoster", "listCloserRoster"]) {
      const fn = assignRepo.slice(assignRepo.indexOf(`export async function ${marker}`));
      expect(fn).toMatch(/eq\(users\.role, "(agent|closer)"\), eq\(users\.status, "active"\)/);
    }
  });

  it("promotion keeps the historical agents row (no delete) and only flips users.role", () => {
    const fn = repo.slice(repo.indexOf("export async function promoteAgentUserToCloser"));
    expect(fn).toMatch(/\.update\(users\)\.set\(\{ role: "closer"/);
    expect(fn).not.toMatch(/\.delete\(agents\)|delete from agents/i);
  });
});

describe("§8 — Delete/Remove is DEACTIVATION (no historical destruction)", () => {
  const repo = stripComments(read("server/db/repos/staff.ts"));
  const svc = stripComments(read("server/staff/service.ts"));

  it("deactivateStaffUser sets status only — never deletes a row", () => {
    const fn = repo.slice(repo.indexOf("export async function deactivateStaffUser"));
    expect(fn).toMatch(/\.set\(\{ status: "inactive"/);
    expect(fn).not.toMatch(/\.delete\(/);
  });

  it("removeStaff is Admin-gated, revokes sessions, deletes 0 historical rows, audits the model", () => {
    const fn = svc.slice(svc.indexOf("export async function removeStaff"));
    expect(fn).toMatch(/assertCanRemoveStaff\(actor\.role\)/);
    expect(fn).toMatch(/deactivateStaffUser\(/);
    expect(fn).toMatch(/revokeAllForUser\(/);
    expect(fn).toMatch(/action: "staff\.removed"/);
    expect(fn).toMatch(/model: "deactivated"/);
    expect(fn).toMatch(/historical_rows_deleted: 0/);
    // no hard delete of users / agents / closers / any history table
    expect(fn).not.toMatch(/\.delete\(|DELETE FROM/i);
  });
});

describe("§3/§10 — profile edit reuses existing systems + audits fields not values", () => {
  const svc = stripComments(read("server/staff/service.ts"));
  const editor = stripComments(read("components/officeverse/staff-edit-dialog.tsx"));

  it("salary is delegated UNCHANGED to the existing payroll salary-profile model", () => {
    const fn = svc.slice(svc.indexOf("export async function updateStaffProfile"));
    expect(fn).toMatch(/setSalaryProfile\(/);
    expect(fn).not.toMatch(/\.update\(salaryProfiles\)|calculatedSalary|payrollRun/);
  });
  it("audit logs field NAMES, never values", () => {
    const fn = svc.slice(svc.indexOf("export async function updateStaffProfile"));
    expect(fn).toMatch(/action: "staff\.profile_updated"/);
    expect(fn).toMatch(/metadata: \{ kind: input\.kind, fields: changed \}/);
  });
  it("photo replacement reuses the Phase-19 setProfilePhoto path — no second photo system, no localStorage", () => {
    expect(editor).toMatch(/useSetProfilePhoto\(\)/);
    expect(editor).toMatch(/fileToSquareJpegBase64\(/);
    expect(editor).not.toMatch(/localStorage|sessionStorage/);
    expect(editor).not.toMatch(/agentPhotoFn|closerPhotoFn|new FormData|https?:\/\//);
  });
});

describe("§13 — client fns are server-authorized at the boundary", () => {
  const fns = read("lib/officeverse/staff-fns.ts");
  it("updateStaffProfileFn requires a user (service asserts Admin/HR)", () => {
    expect(fns.slice(fns.indexOf("export const updateStaffProfileFn"))).toMatch(/requireUser\(\)/);
  });
  it("promoteAgentFn + removeStaffFn require the admin role", () => {
    expect(fns.slice(fns.indexOf("export const promoteAgentFn"))).toMatch(/requireRole\("admin"\)/);
    expect(fns.slice(fns.indexOf("export const removeStaffFn"))).toMatch(/requireRole\("admin"\)/);
  });
});
