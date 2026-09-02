/**
 * Phase 10 Stage 4 — MILESTONE ENGINE authorization.
 *
 *   create / edit / enable / disable (DEFINITIONS = governance) → Admin ONLY
 *   list + simulate (operational visibility)                    → Admin + Closer
 *   Agent + HR                                                   → 403 everywhere
 *
 * No DB in this env → each service gates the role FIRST, then reports
 * dbUnavailable / throws 503, so a denied role always throws 403 first.
 */
import { describe, expect, it } from "vitest";
import { HttpError } from "../http-error";
import {
  createMilestone,
  listMilestones,
  setMilestoneEnabled,
  simulateMilestone,
  updateMilestone,
} from "../milestones/milestone-service";
import { OPERATIONS_AUDIT_ACTIONS, canManageMilestones } from "../authz/operations";

const U = (id: number, role: "admin" | "agent" | "closer" | "hr") => ({
  id,
  role,
  process: "US" as const,
});
const admin = U(1, "admin");
const closer = U(2, "closer");
const agent = U(3, "agent");
const hr = U(4, "hr");

async function code(p: Promise<unknown>): Promise<number | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
}

const draft = {
  name: "10 Lead Acceptances",
  type: "INDIVIDUAL_COUNT" as const,
  metric: "LEAD_ACCEPTED",
  threshold: 10,
  effectiveFrom: "2026-09-01",
};

describe("milestone DEFINITION mutations — Admin only (governance)", () => {
  const mutations = (u: ReturnType<typeof U>) => [
    createMilestone(u, draft),
    updateMilestone(u, 1, draft),
    setMilestoneEnabled(u, 1, true),
  ];
  it("Admin passes the governance gate (then hits dbUnavailable, never 403)", async () => {
    for (const c of mutations(admin)) expect(await code(c)).not.toBe(403);
  });
  it("Closer is DENIED milestone definition mutations (permissions not broadened)", async () => {
    for (const c of mutations(closer)) expect(await code(c)).toBe(403);
  });
  it("Agent + HR are denied milestone definition mutations", async () => {
    for (const u of [agent, hr]) for (const c of mutations(u)) expect(await code(c)).toBe(403);
  });
});

describe("milestone list + simulate — Admin + Closer (operational)", () => {
  it("Admin + Closer may list and simulate", async () => {
    for (const u of [admin, closer]) {
      expect(await code(listMilestones(u))).not.toBe(403);
      expect(await code(simulateMilestone(u, { id: 1, userId: 9 }))).not.toBe(403);
    }
  });
  it("Agent + HR may not list or simulate (403)", async () => {
    for (const u of [agent, hr]) {
      expect(await code(listMilestones(u))).toBe(403);
      expect(await code(simulateMilestone(u, { id: 1, userId: 9 }))).toBe(403);
    }
  });
});

describe("authz helper + audit whitelist", () => {
  it("canManageMilestones is Admin-only", () => {
    expect(canManageMilestones("admin")).toBe(true);
    expect(canManageMilestones("closer")).toBe(false);
    expect(canManageMilestones("hr")).toBe(false);
    expect(canManageMilestones("agent")).toBe(false);
  });
  it("every milestone action is registered for the Operations audit view", () => {
    for (const a of [
      "MILESTONE_CREATED",
      "MILESTONE_UPDATED",
      "MILESTONE_ENABLED",
      "MILESTONE_DISABLED",
      "MILESTONE_TRIGGERED",
      "MILESTONE_SIMULATED",
    ]) {
      expect(OPERATIONS_AUDIT_ACTIONS).toContain(a);
    }
  });
});
