/**
 * ADMIN + HR UAT — Salary / Attendance process filter, canonical Employee ID +
 * photo in those lists, HR role separation (no Leads / Follow-ups / Data
 * Export), and the new HR Policy module. PURE / structural.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canExport, assertCanExport } from "../authz/export";
import { canManageHrPolicy, assertCanManageHrPolicy } from "../authz/hr-policy";
import { assertLeadsModuleAccess } from "../authz/leads";
import { assertFollowUpsModuleAccess } from "../authz/followups";
import { canManageStaff, canPromoteStaff, canRemoveStaff } from "../authz/staff";
import { HttpError } from "../http-error";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const throws403 = (fn: () => void): boolean => {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof HttpError && e.status === 403;
  }
};

/* ------------------------------- SALARY ------------------------------- */

describe("1 — Salary process filter + employee identity", () => {
  const route = read("routes/_shell.payroll.tsx");
  const repo = read("server/db/repos/payroll.ts");
  const svc = read("server/hr/payroll-service.ts");

  it("both salary lists use the shared ProcessFilter (ALL default)", () => {
    expect(route).toMatch(
      /import \{[\s\S]*?ProcessFilter[\s\S]*?\} from "@\/components\/officeverse\/process-filter"/,
    );
    // base salary config list
    expect(route).toMatch(/useSalaryProfiles\(employee \|\| undefined, filterToProcess\(proc\)\)/);
    expect(route).toMatch(/<ProcessFilter value=\{proc\} onChange=\{setProc\}/);
    // monthly payroll list
    expect(route).toMatch(/value=\{\(filters\.process \?\? "ALL"\) as ProcessFilterValue\}/);
  });

  it("the filter resolves against the authoritative users.process (never a snapshot / shift text)", () => {
    expect(repo).toMatch(
      /if \(filter\.process\) conds\.push\(eq\(users\.process, filter\.process as never\)\)/,
    );
    expect(repo).toMatch(
      /if \(f\.process\) conds\.push\(eq\(users\.process, f\.process as never\)\)/,
    );
    expect(repo).not.toMatch(/eq\(payrollRuns\.process, f\.process/); // no snapshot-column filter
  });

  it("salary rows carry userId + canonical Employee ID + photo availability", () => {
    expect(repo).toMatch(/coalesce\(\$\{agents\.agentCode\}, \$\{closers\.closerCode\}\)/);
    expect(repo).toMatch(/photoAvailable: r\.photoAssetId != null/);
    expect(svc).toMatch(/employeeCode\?: string \| null/);
    expect(svc).toMatch(/photoAvailable\?: boolean/);
    // the row renders the authoritative StaffAvatar + a DEDICATED Employee ID
    // column that shows the canonical code on its own (never merged with process)
    expect(route).toMatch(/<StaffAvatar/);
    expect(route).toMatch(/<th className="px-3 py-2">Employee ID<\/th>/);
    expect(route).toMatch(/\{p\.employeeCode \?\? "—"\}/);
  });
});

/* ----------------------------- ATTENDANCE ---------------------------- */

describe("2 — Attendance process filter + employee identity", () => {
  const route = read("routes/_shell.attendance.tsx");
  const repo = read("server/db/repos/attendance.ts");

  it("the admin attendance filter uses the shared ProcessFilter", () => {
    expect(route).toMatch(/from "@\/components\/officeverse\/process-filter"/);
    expect(route).toMatch(/<ProcessFilter\s+value=\{\(filters\.process \?\? "ALL"\)/);
  });

  it("attendance is filtered by users.process, not the per-row snapshot", () => {
    expect(repo).toMatch(
      /if \(f\.process\) conds\.push\(eq\(users\.process, f\.process as never\)\)/,
    );
    expect(repo).not.toMatch(/eq\(attendance\.process, f\.process/);
  });

  it("attendance rows carry canonical Employee ID + photo; row renders StaffAvatar", () => {
    expect(repo).toMatch(/coalesce\(\$\{agents\.agentCode\}, \$\{closers\.closerCode\}\)/);
    expect(repo).toMatch(/photoAvailable: r\.photoAssetId != null/);
    expect(route).toMatch(/<StaffAvatar/);
    expect(route).toMatch(/\{r\.employeeCode \?\? "—"\}/);
  });
});

/* -------------------------- STAFF MANAGEMENT ------------------------- */

describe("4/5 — Admin edit / delete / photo / DOB / anniversary; HR unchanged", () => {
  const dialog = read("components/officeverse/staff-edit-dialog.tsx");

  it("the shared editor exposes name / photo / DOB / anniversary / joining + Admin promote & remove", () => {
    expect(dialog).toMatch(/useSetProfilePhoto\(\)/);
    expect(dialog).toMatch(/fileToSquareJpegBase64/);
    expect(dialog).toMatch(/setDob/);
    expect(dialog).toMatch(/setAnniversary/);
    expect(dialog).toMatch(/Joining date/);
    expect(dialog).toMatch(/usePromoteAgent\(\)/);
    expect(dialog).toMatch(/useRemoveStaff\(\)/);
  });

  it("edit/photo → Admin + HR; promote + remove → Admin ONLY (HR not widened)", () => {
    expect(canManageStaff("admin")).toBe(true);
    expect(canManageStaff("hr")).toBe(true);
    expect(canManageStaff("agent")).toBe(false);
    for (const r of ["hr", "agent", "closer"] as const) {
      expect(canPromoteStaff(r)).toBe(false);
      expect(canRemoveStaff(r)).toBe(false);
    }
    expect(canPromoteStaff("admin")).toBe(true);
    expect(canRemoveStaff("admin")).toBe(true);
  });

  it("the HR staff directory shows PHOTO|NAME|EMPLOYEE ID|ROLE|PROCESS|STATUS|ACTION with the editor", () => {
    const emp = read("routes/_shell.employees.tsx");
    expect(emp).toMatch(/<StaffAvatar/);
    expect(emp).toMatch(/<TableHead>Employee ID<\/TableHead>/);
    expect(emp).toMatch(/<TableHead>Role<\/TableHead>/);
    expect(emp).toMatch(/<TableHead>Process \/ shift<\/TableHead>/);
    expect(emp).toMatch(/<TableHead className="text-right">Action<\/TableHead>/);
    expect(emp).toMatch(/<StaffEditDialog staff=\{detail\}/);
    expect(emp).toMatch(/\{e\.code\}/); // canonical code column
  });
});

/* ------------------------ HR ROLE SEPARATION ------------------------- */

describe("6/8 — HR has no Leads / Follow-ups / Data Export (nav + server)", () => {
  const nav = read("lib/officeverse/nav.ts");
  const hrBlock = nav.slice(nav.indexOf("hr: ["), nav.indexOf("admin: ["));

  it("the HR nav has no Leads / Follow-ups / Exports item, and gains HR Policy", () => {
    expect(hrBlock).not.toMatch(/to: "\/leads"/);
    expect(hrBlock).not.toMatch(/to: "\/followups"/);
    expect(hrBlock).not.toMatch(/to: "\/exports"/);
    expect(hrBlock).toMatch(/label: "HR Policy", to: "\/policies"/);
  });

  it("Data Export centre is Admin ONLY; HR / agent / closer → 403", () => {
    expect(canExport("admin")).toBe(true);
    for (const r of ["hr", "agent", "closer"] as const) {
      expect(canExport(r)).toBe(false);
      expect(throws403(() => assertCanExport(r))).toBe(true);
    }
    const fns = read("lib/officeverse/export-fns.ts");
    expect(fns).toMatch(/exportPreviewFn[\s\S]{0,200}requireRole\("admin"\)/);
    expect(fns).toMatch(/exportDownloadFn[\s\S]{0,200}requireRole\("admin"\)/);
  });

  it("Leads + Follow-up list/read services 403 for HR (not just a hidden menu)", () => {
    expect(throws403(() => assertLeadsModuleAccess("hr"))).toBe(true);
    expect(throws403(() => assertFollowUpsModuleAccess("hr"))).toBe(true);
    expect(() => assertLeadsModuleAccess("admin")).not.toThrow();
    expect(() => assertFollowUpsModuleAccess("agent")).not.toThrow();
    const leadSvc = read("server/leads/service.ts");
    expect(leadSvc).toMatch(/assertLeadsModuleAccess\(user\.role\)/);
    const fuSvc = read("server/followups/service.ts");
    expect(fuSvc).toMatch(/assertFollowUpsModuleAccess\(user\.role\)/);
  });
});

/* ----------------------------- HR POLICY ---------------------------- */

describe("7 — HR Policy module", () => {
  it("manage → Admin + HR; Agents / Closers cannot", () => {
    expect(canManageHrPolicy("admin")).toBe(true);
    expect(canManageHrPolicy("hr")).toBe(true);
    expect(canManageHrPolicy("agent")).toBe(false);
    expect(canManageHrPolicy("closer")).toBe(false);
    expect(throws403(() => assertCanManageHrPolicy("agent"))).toBe(true);
    expect(throws403(() => assertCanManageHrPolicy("closer"))).toBe(true);
  });

  it("write fns require the admin/hr role; read fns only authenticate", () => {
    const fns = read("lib/officeverse/hr-policy-fns.ts");
    expect(fns).toMatch(/savePolicyFn[\s\S]{0,260}requireRole\("admin", "hr"\)/);
    expect(fns).toMatch(/setPolicyStatusFn[\s\S]{0,260}requireRole\("admin", "hr"\)/);
    expect(fns).toMatch(/listPoliciesFn[\s\S]{0,200}requireUser\(\)/);
  });

  it("the service audits create / update / publish / unpublish", () => {
    const svc = read("server/hr-policy/service.ts");
    for (const a of [
      "hr_policy.created",
      "hr_policy.updated",
      "hr_policy.published",
      "hr_policy.unpublished",
    ])
      expect(svc).toContain(a);
    // non-managers get PUBLISHED only
    expect(svc).toMatch(/canManage \? undefined : eq\(hrPolicies\.status, "PUBLISHED"\)/);
  });

  it("the schema table + route + nav entries exist", () => {
    expect(read("lib/db/schema.ts")).toMatch(
      /export const hrPolicies = mysqlTable\(\s*"hr_policies"/,
    );
    expect(read("routes/_shell.policies.tsx")).toMatch(/createFileRoute\("\/_shell\/policies"\)/);
    const nav = read("lib/officeverse/nav.ts");
    // Agents + Closers get a read-only "HR Policies" link
    expect(nav).toMatch(/label: "HR Policies", to: "\/policies"/);
  });
});
