import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const importsOf = (code: string) =>
  [...code.matchAll(/(?:import|export)[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]!);

describe("Phase 23 — login IP gate is wired server-side", () => {
  const svc = read("server/auth/service.ts");
  it("login() evaluates network access from the server-observed IP", () => {
    expect(svc).toMatch(/import .*evaluateAccess.* from "\.\.\/net\/access"/);
    expect(svc).toMatch(/normalizeIp\(meta\.ip\)/);
    expect(svc).toMatch(/matchOfficeNetwork\(/);
    expect(svc).toMatch(/if \(!access\.crmAllowed\)/);
    expect(svc).toMatch(/code: "remote_denied"/);
  });
  it("the resolved attendance-eligibility is persisted on the session", () => {
    expect(svc).toMatch(/attendanceEligible: access\.attendanceEligible/);
    expect(read("server/session.ts")).toMatch(
      /attendanceEligible: office\.attendanceEligible === true/,
    );
  });
  it("Dev Mode login still returns before the IP gate (no bypass, just no policy)", () => {
    const devBranch = svc.slice(svc.indexOf("if (devAuthEnabled())"), svc.indexOf("const rateKey"));
    expect(devBranch).toMatch(/return \{/);
    expect(devBranch).not.toMatch(/matchOfficeNetwork/);
  });
  it("the client login message is generic — never an office IP", () => {
    const fns = read("lib/officeverse/auth-fns.ts");
    expect(fns).toMatch(/remote_denied/);
    expect(fns).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

describe("Phase 23 — attendance is office-session-derived + idempotent", () => {
  const svc = read("server/attendance/service.ts");
  it("touchAttendance counts ONLY attendance-eligible sessions", () => {
    expect(svc).toMatch(/attendanceEligible: sessions\.attendanceEligible/);
    expect(svc).toMatch(/s\.attendanceEligible === true/);
  });
  it("a corrected row is still never re-derived (idempotency preserved)", () => {
    expect(svc).toMatch(/source === "corrected"/);
  });
  it("there is no employee-facing manual attendance mutation", () => {
    const fns = read("lib/officeverse/attendance-fns.ts");
    expect(fns).not.toMatch(/markAttendance|checkInFn|checkOutFn|createAttendance/i);
  });
});

describe("Phase 23 — Agent attendance privacy (server-enforced, not just hidden)", () => {
  it("listMyAttendance rejects Agents server-side", () => {
    const svc = read("server/attendance/service.ts");
    expect(svc).toMatch(/assertCanViewOwnAttendance\(user\.role\)/);
  });
  it("the attendance DTO carries NO compensation field", () => {
    const svc = stripComments(read("server/attendance/service.ts"));
    const dto = svc.slice(
      svc.indexOf("export interface AttendanceDTO"),
      svc.indexOf("}", svc.indexOf("export interface AttendanceDTO")),
    );
    expect(dto).not.toMatch(/salary|payroll|compensation|incentive|bonus/i);
  });
  it("the managed (Closer) view is hard-scoped to the Closer's own process", () => {
    const svc = read("server/attendance/service.ts");
    const fn = svc.slice(svc.indexOf("export async function listManagedAttendance"));
    expect(fn).toMatch(/actor\.role === "closer" \? \(actor\.process/);
    expect(fn).toMatch(/r\.role === "agent"/); // agents only
  });
  it("the attendance route hides everything for Agents", () => {
    const route = read("routes/_shell.attendance.tsx");
    expect(route).toMatch(/user\?\.role === "agent"/);
    expect(route).toMatch(/Not shown for your role/i);
  });
});

describe("Phase 23 — office-network management is isolated + HR/Admin only", () => {
  const FILES = [
    "server/authz/office-networks.ts",
    "server/net/cidr.ts",
    "server/net/access.ts",
    "server/net/office-networks.ts",
    "server/db/repos/office-networks.ts",
    "lib/officeverse/office-network-fns.ts",
  ];
  it("imports nothing from payroll / gamification / office-tv", () => {
    for (const f of FILES) {
      for (const spec of importsOf(stripComments(read(f)))) {
        expect(
          /(^|\/)(payroll|gamification|live)(\/|$)|salary|regularity|incentive|office-tv|celebration/i.test(
            spec,
          ),
          `${f} must not import "${spec}"`,
        ).toBe(false);
      }
    }
  });
  it("every fn requires the session and delegates to the guarded service", () => {
    const fns = read("lib/officeverse/office-network-fns.ts");
    const handlers = fns.split(/export const \w+Fn/).slice(1);
    expect(handlers.length).toBeGreaterThanOrEqual(5);
    for (const h of handlers) expect(h).toMatch(/requireUser\(\)/);
    const svc = read("server/net/office-networks.ts");
    expect((svc.match(/assertCanManageOfficeNetworks\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  it("disabling / removing the last active network for a process is guarded", () => {
    const svc = read("server/net/office-networks.ts");
    expect(svc).toMatch(/assertNotLastForProcess\(/);
    expect(svc).toMatch(/would_lock_out/);
    expect(svc).toMatch(/confirmLockout/);
  });
  it("the management route is gated to ADMIN ONLY (Admin UAT §11)", () => {
    const route = read("routes/_shell.office-networks.tsx");
    expect(route).toMatch(/user\?\.role !== "admin"/);
    expect(route).not.toMatch(/user\?\.role !== "hr"/);
  });
  it("no office-network / attendance-override module under src/server/api", () => {
    const api = readdirSync(join(root, "server", "api"));
    expect(api.some((f) => /network|attendance|override/i.test(f))).toBe(false);
  });
});

describe("Phase 23 — Closer salary hard-exclusion (§15) + payroll isolation (§28)", () => {
  it("the closers table has no salary / compensation column", () => {
    const schema = read("lib/db/schema.ts");
    const closers = schema.slice(
      schema.indexOf("export const closers = mysqlTable("),
      schema.indexOf(");", schema.indexOf("export const closers = mysqlTable(")),
    );
    expect(closers).not.toMatch(/salary|compensation|incentive|wage|pay_/i);
  });
  it("no Closer route exposes a salary field", () => {
    for (const f of readdirSync(join(root, "routes")).filter((f) => /_shell\.closers/.test(f))) {
      expect(stripComments(read(`routes/${f}`))).not.toMatch(/salary|monthly_salary|compensation/i);
    }
  });
  it("agent base salary at creation flows to the payroll module, never agents.monthlySalary", () => {
    // Admin UAT Batch-2 §3 REVERSED the Phase-23 "no salary at creation" rule
    // for AGENTS: createStaff now accepts an optional base_salary and writes it
    // to `salary_profiles` via setSalaryProfile (effective from the join date).
    // The legacy `agents.monthly_salary` column is still never written, and a
    // Closer is explicitly rejected (a Closer works on incentives).
    const staffFns = read("lib/officeverse/staff-fns.ts");
    const staffSvc = read("server/staff/service.ts");
    for (const src of [staffFns, staffSvc]) {
      expect(stripComments(src)).not.toMatch(/monthly_salary|monthlySalary|compensation|\bwage\b/i);
    }
    expect(staffSvc).toMatch(/setSalaryProfile/);
    expect(stripComments(staffSvc)).toMatch(/applies to agents only/i);
  });
  it("attendance / assignment / office-network fns never carry a salary field", () => {
    for (const f of [
      "lib/officeverse/attendance-fns.ts",
      "lib/officeverse/assignment-fns.ts",
      "lib/officeverse/office-network-fns.ts",
    ]) {
      expect(stripComments(read(f))).not.toMatch(/salary|monthlySalary|payroll|compensation/i);
    }
  });
});
