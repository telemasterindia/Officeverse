import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const importsOf = (code: string) =>
  [...code.matchAll(/(?:import|export)[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]!);

const FILES = [
  "server/authz/assignments.ts",
  "server/assignments/plan.ts",
  "server/assignments/service.ts",
  "server/db/repos/assignments.ts",
  "lib/officeverse/assignment-fns.ts",
  "lib/officeverse/use-assignments.ts",
];

describe("Assignment Control — isolation from unrelated systems", () => {
  it("imports nothing from payroll / salary / gamification / office-tv / HR", () => {
    for (const f of FILES) {
      for (const spec of importsOf(stripComments(read(f)))) {
        expect(
          /(^|\/)(hr|payroll|gamification|live)(\/|$)|salary|regularity|incentive|commission|office-tv|celebration/i.test(
            spec,
          ),
          `${f} must not import "${spec}"`,
        ).toBe(false);
      }
    }
  });

  it("no assignment module lives under src/server/api (client-bundle protection)", () => {
    const apiFiles = readdirSync(join(root, "server", "api"));
    expect(apiFiles.some((f) => /assign/i.test(f))).toBe(false);
  });
});

describe("Assignment Control — the follow-up / lead ownership invariant is structural", () => {
  const repoSrc = stripComments(read("server/db/repos/assignments.ts"));
  // service kept RAW here: the branch anchors are section-header comments
  const svcSrc = read("server/assignments/service.ts");

  it("reassignFollowupOwner updates ONLY follow_ups — it never writes leads", () => {
    const fn = repoSrc.slice(
      repoSrc.indexOf("export async function reassignFollowupOwner"),
      repoSrc.indexOf("export async function reassignLeadCloser"),
    );
    expect(fn).toMatch(/\.update\(followUps\)/);
    expect(fn).not.toMatch(/\.update\(leads\)/);
    expect(fn).not.toMatch(/assignedCloserId/);
  });

  it("reassignLeadCloser updates ONLY leads.assigned_closer_id — it never writes a follow_ups row", () => {
    const fn = repoSrc.slice(
      repoSrc.indexOf("export async function reassignLeadCloser"),
      repoSrc.indexOf("export async function insertLeadAssignmentHistory"),
    );
    expect(fn).toMatch(/\.update\(leads\)/);
    expect(fn).toMatch(/assignedCloserId: toCloserId/);
    expect(fn).not.toMatch(/\.update\(followUps\)/);
    expect(fn).not.toMatch(/ownerUserId/);
  });

  // the follow-up branch header (§8 added CLOSER_FOLLOWUPS_TO_AGENT to it)
  const FU_BRANCH_MARK = "/* ---- AGENT_FOLLOWUPS / CLOSER_FOLLOWUPS";

  it("the follow-up service path calls only the follow-up writer (never the lead writer)", () => {
    const at = svcSrc.indexOf(FU_BRANCH_MARK);
    expect(at).toBeGreaterThan(-1);
    const branch = stripComments(svcSrc.slice(at));
    expect(branch).toMatch(/repo\.reassignFollowupOwner\(/);
    expect(branch).not.toMatch(/repo\.reassignLeadCloser\(/);
    // §5/§11 — writes the immutable trail, never touches leads.assignedCloserId
    expect(branch).toMatch(/repo\.insertFollowupReassignments\(/);
    expect(branch).not.toMatch(/assignedCloserId/);
  });

  it("the CLOSER_LEADS service path calls only the lead writer + appends history (never deletes)", () => {
    const branch = svcSrc.slice(
      svcSrc.indexOf("/* ---- CLOSER_LEADS ---- */"),
      svcSrc.indexOf(FU_BRANCH_MARK),
    );
    expect(branch).toMatch(/repo\.reassignLeadCloser\(/);
    expect(branch).toMatch(/repo\.insertLeadAssignmentHistory\(/);
    expect(branch).not.toMatch(/repo\.reassignFollowupOwner\(/);
    expect(branch).not.toMatch(/repo\.insertFollowupReassignments\(/);
    expect(branch).not.toMatch(/\.delete\(/);
  });

  it("workload queries filter to the assignable status set (archived/terminal excluded)", () => {
    expect(repoSrc).toMatch(/inArray\(followUps\.status, \[\.\.\.ASSIGNABLE_FOLLOWUP_STATUSES\]\)/);
    expect(repoSrc).toMatch(/inArray\(leads\.status, \[\.\.\.ASSIGNABLE_CLOSER_LEAD_STATUSES\]\)/);
  });

  it("the bulk UPDATEs re-check the current owner in their WHERE clause (no stale-state writes)", () => {
    expect(repoSrc).toMatch(/eq\(followUps\.ownerUserId, fromUserId\)/);
    expect(repoSrc).toMatch(/eq\(leads\.assignedCloserId, fromCloserId\)/);
  });

  it("the reassign path runs inside a transaction", () => {
    expect(svcSrc).toMatch(/db\.transaction\(async \(tx\) =>/);
  });

  it("the destination role is validated server-side (no cross-role / non-staff target)", () => {
    expect(svcSrc).toMatch(/repo\.closerExists\(input\.toOwnerId/);
    expect(svcSrc).toMatch(/repo\.roleOfUser\(input\.toOwnerId/);
    expect(svcSrc).toMatch(/"bad_destination"/);
  });

  it("bulk reassignment is blocked across the US ⇄ India process line (even for an admin)", () => {
    // source + destination process are resolved and compared before any write
    expect(svcSrc).toMatch(/repo\.processOfUser\(input\.fromOwnerId/);
    expect(svcSrc).toMatch(/repo\.processOfUser\(input\.toOwnerId/);
    expect(svcSrc).toMatch(/repo\.processOfCloser\(input\.fromOwnerId/);
    expect(svcSrc).toMatch(/repo\.processOfCloser\(input\.toOwnerId/);
    expect(svcSrc).toMatch(/fromProcess !== toProcess/);
    expect(svcSrc).toMatch(/"cross_process"/);
    // and the guard sits before the reassignment work (before either writer)
    const guardAt = svcSrc.indexOf('"cross_process"');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(svcSrc.indexOf("repo.reassignLeadCloser("));
    expect(guardAt).toBeLessThan(svcSrc.indexOf("repo.reassignFollowupOwner("));
  });

  it("processOfUser / processOfCloser read users.process (via the closer's user)", () => {
    expect(repoSrc).toMatch(/export async function processOfUser/);
    expect(repoSrc).toMatch(/export async function processOfCloser/);
    const poc = repoSrc.slice(repoSrc.indexOf("export async function processOfCloser"));
    expect(poc).toMatch(/\.from\(closers\)/);
    expect(poc).toMatch(/innerJoin\(users,/);
  });
});

describe("Assignment Control — client trust boundary", () => {
  const fns = read("lib/officeverse/assignment-fns.ts");

  it("every exported server fn derives identity via requireUser()", () => {
    const handlers = fns.split(/export const \w+Fn/).slice(1);
    expect(handlers).toHaveLength(5); // + longDatedFollowUpsFn (§6)
    for (const h of handlers) expect(h).toMatch(/requireUser\(\)/);
  });

  it("the client sends a selection + destination only — never a final owner map, and the batch is capped", () => {
    expect(fns).toMatch(/z\.literal\("ALL"\)/);
    expect(fns).toMatch(/\.max\(5000\)/);
    expect(fns).not.toMatch(/finalOwner|ownerMap|applyDirectly/);
  });

  it("mutation is a POST; reads are GET", () => {
    expect(fns).toMatch(/reassignBulkFn = createServerFn\(\{ method: "POST" \}\)/);
    expect(fns).toMatch(/assignmentRosterFn = createServerFn\(\{ method: "GET" \}\)/);
  });
});
