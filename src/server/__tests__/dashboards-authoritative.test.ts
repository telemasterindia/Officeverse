/**
 * Audit H-2 — the primary role dashboards + staff onboarding must read/write
 * the authoritative server layer, NOT client-side localStorage / demo stores.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (rel: string) => code(readFileSync(join(root, rel), "utf8"));

const DASHBOARDS = [
  "routes/_shell.workspace.tsx",
  "routes/_shell.closer-hub.tsx",
  "routes/_shell.mission-control.tsx",
  "routes/_shell.employees.tsx",
  "routes/_shell.people.tsx",
  "routes/_shell.team.tsx",
  "routes/_shell.agents.index.tsx",
  "routes/_shell.closers.index.tsx",
  "components/officeverse/follow-up-reminders.tsx",
  "components/officeverse/search-command.tsx",
];

describe("H-2 — no dashboard reads leads/follow-ups/staff from a demo store", () => {
  it("none import the localStorage demo hooks or the deleted people store", () => {
    for (const f of DASHBOARDS) {
      const src = read(f);
      expect(src, f).not.toMatch(/use-crm/);
      expect(src, f).not.toMatch(/officeverse\/people/);
      expect(src, f).not.toMatch(
        /\buseLeads\(|\buseFollowUps\(|\busePeople\(|loadFollowUps\(|loadLeads\(/,
      );
      expect(src, f).not.toMatch(/\blocalStorage\b/);
    }
  });

  it("they use the server hooks instead", () => {
    const bySource: Record<string, RegExp> = {
      "routes/_shell.workspace.tsx": /useServerFollowUps|useServerLeads/,
      "routes/_shell.closer-hub.tsx": /useServerLeads/,
      "routes/_shell.mission-control.tsx": /useServerLeads|useServerStaff/,
      "routes/_shell.employees.tsx": /useServerStaff/,
      "routes/_shell.people.tsx": /useServerStaff/,
      "routes/_shell.team.tsx": /useServerStaff/,
      "routes/_shell.agents.index.tsx": /useServerStaff/,
      "routes/_shell.closers.index.tsx": /useServerStaff/,
      "components/officeverse/follow-up-reminders.tsx": /listFollowUpsFn/,
      "components/officeverse/search-command.tsx": /useServerLeads/,
    };
    for (const [f, re] of Object.entries(bySource)) {
      expect(read(f), f).toMatch(re);
    }
  });

  it("the demo lead/follow-up/people constants are gone from these files", () => {
    for (const f of DASHBOARDS) {
      const src = read(f);
      // `LEADS` / `FOLLOW_UPS` / `EMPLOYEES` constants pulled from data.ts
      expect(src, f).not.toMatch(
        /import\s*\{[^}]*\b(LEADS|FOLLOW_UPS|EMPLOYEES)\b[^}]*\}\s*from\s*["']@\/lib\/officeverse\/data["']/,
      );
    }
  });
});

describe("H-2 — staff onboarding creates REAL db records", () => {
  const newAgent = read("routes/_shell.agents.new.tsx");
  const newCloser = read("routes/_shell.closers.new.tsx");
  const svc = readFileSync(join(root, "server", "staff", "service.ts"), "utf8");
  const fns = readFileSync(join(root, "lib", "officeverse", "staff-fns.ts"), "utf8");

  it("the create forms call the server mutation, not createPerson()", () => {
    for (const [f, src] of [
      ["agents/new", newAgent],
      ["closers/new", newCloser],
    ] as const) {
      expect(src, f).toMatch(/useCreateServerStaff/);
      expect(src, f).not.toMatch(/createPerson|@\/lib\/officeverse\/people/);
    }
  });

  it("createStaffFn authenticates + validates; the service is Admin/HR-only and hashes the password", () => {
    const repo = readFileSync(join(root, "server", "db", "repos", "staff.ts"), "utf8");
    expect(fns).toMatch(/createStaffFn = createServerFn\(\{ method: "POST" \}\)/);
    expect(fns).toMatch(/\.inputValidator\(/);
    expect(fns).toMatch(/requireUser\(\)/);
    expect(svc).toMatch(/assertCanManageStaff\(actor\.role\)/);
    expect(svc).toMatch(/await hashPassword\(input\.password\)/);
    expect(svc).toMatch(/repo\.insertStaff\(/);
    // users + agents/closers rows inserted in ONE transaction
    const ins = repo.slice(repo.indexOf("export async function insertStaff"));
    expect(ins).toMatch(/getDb\(\)\.transaction\(async \(tx\) =>/);
    expect(ins).toMatch(/\.insert\(users\)/);
    expect(ins).toMatch(/\.insert\(agents\)|\.insert\(closers\)/);
  });

  it("the DTO returned to the client carries no password or salary", () => {
    const dto = svc.slice(svc.indexOf("export interface StaffDTO"), svc.indexOf("function toDTO"));
    expect(dto).not.toMatch(/password|salary|passwordHash/i);
  });
});
