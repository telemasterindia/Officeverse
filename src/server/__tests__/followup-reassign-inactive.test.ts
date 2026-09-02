/**
 * FOLLOW-UP REASSIGNMENT — FINAL BUSINESS RULE CORRECTION (PURE / structural).
 *
 * §1/§6/§9  the DESTINATION must be an ACTIVE employee — enforced server-side.
 * §2/§3/§4  NO reassignment-count cap; the trail is append-only and never
 *           consulted to block a future reassignment.
 * §5        Admin-only (unchanged).
 * §7        follow-up reassignment writes follow_ups only, never the lead owner.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const svc = stripComments(read("server/assignments/service.ts"));
const repo = stripComments(read("server/db/repos/assignments.ts"));

describe("§1/§6/§9 — inactive destinations are rejected server-side", () => {
  it("the repo exposes a status lookup for a user id AND for a closers.id", () => {
    expect(repo).toMatch(/export async function statusOfUser\(/);
    expect(repo).toMatch(/export async function statusOfCloser\(/);
    // both read users.status
    const su = repo.slice(repo.indexOf("export async function statusOfUser"));
    expect(su).toMatch(/status: users\.status/);
    const sc = repo.slice(repo.indexOf("export async function statusOfCloser"));
    expect(sc).toMatch(/\.from\(closers\)/);
    expect(sc).toMatch(/innerJoin\(users,/);
  });

  it("reassignBulk checks the destination status and throws inactive_destination when not active", () => {
    const fn = svc.slice(
      svc.indexOf("export async function reassignBulk"),
      svc.indexOf("/* ---- CLOSER_LEADS ---- */"),
    );
    expect(fn).toMatch(/repo\.statusOfCloser\(input\.toOwnerId/);
    expect(fn).toMatch(/repo\.statusOfUser\(input\.toOwnerId/);
    expect(fn).toMatch(/destStatus !== "active"/);
    expect(fn).toMatch(/"inactive_destination"/);
    // the guard sits BEFORE any writer
    const guardAt = fn.indexOf('"inactive_destination"');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(fn.indexOf("repo.reassignFollowupOwner("));
    expect(guardAt).toBeLessThan(fn.indexOf("repo.reassignLeadCloser("));
  });

  it("the destination roster picker already hides inactive staff (role + active)", () => {
    for (const marker of ["listAgentRoster", "listCloserRoster"]) {
      const fn = repo.slice(repo.indexOf(`export async function ${marker}`));
      expect(fn).toMatch(/eq\(users\.status, "active"\)/);
    }
  });
});

describe("§2/§3/§4 — NO reassignment-count limit anywhere", () => {
  it("no cap / one-time / N-time / cooldown / history-block logic in the service or repo", () => {
    const bad =
      /max(imum)?[_ ]?reassign|reassign(ment)?[_ ]?(count|limit|cap)|one[_ -]?time[_ -]?transfer|two[_ -]?time|three[_ -]?time|times[_ ]?reassigned|cooldown|already[_ ]?(been[_ ]?)?reassigned|previously[_ ]?reassigned|reassign.*attempts?.*(>=|>|<)/i;
    expect(svc).not.toMatch(bad);
    expect(repo).not.toMatch(bad);
  });

  it("reassignBulk never READS the reassignment trail before acting (append-only)", () => {
    const fn = svc.slice(svc.indexOf("export async function reassignBulk"));
    expect(fn).not.toMatch(/listFollowupReassignments\(/); // no history read on the write path
    expect(fn).toMatch(/repo\.insertFollowupReassignments\(/); // only appends
  });

  it("the trail insert is append-only — no delete / update of follow_up_reassignments", () => {
    expect(repo).toMatch(/export async function insertFollowupReassignments\(/);
    expect(repo).not.toMatch(/\.delete\(followUpReassignments\)/);
    expect(repo).not.toMatch(/\.update\(followUpReassignments\)/);
  });
});

describe("§5 — Admin-only (unchanged)", () => {
  it("reassignBulk first asserts the Admin-only gate", () => {
    const fn = svc.slice(svc.indexOf("export async function reassignBulk"));
    expect(fn.slice(0, 200)).toMatch(/assertCanReassignAssignments\(actor\.role\)/);
  });
});

describe("§7 — follow-up reassignment never changes the lead owner", () => {
  it("the follow-up branch writes follow_ups only (never leads.assignedCloserId)", () => {
    const raw = read("server/assignments/service.ts"); // section-header comment is the anchor
    const at = raw.indexOf("/* ---- AGENT_FOLLOWUPS / CLOSER_FOLLOWUPS");
    expect(at).toBeGreaterThan(-1);
    const branch = stripComments(raw.slice(at));
    expect(branch).toMatch(/repo\.reassignFollowupOwner\(/);
    expect(branch).not.toMatch(/repo\.reassignLeadCloser\(/);
    expect(branch).not.toMatch(/assignedCloserId/);
  });
});

describe("§8 — the workload breakdown is unchanged", () => {
  it("assignmentRoster still returns the six-way follow-up breakdown + leads", () => {
    for (const k of [
      "pendingFollowUps",
      "overdue",
      "dueToday",
      "upcoming",
      "completedFollowUps",
      "leads:",
    ]) {
      expect(svc).toContain(k);
    }
  });
});
