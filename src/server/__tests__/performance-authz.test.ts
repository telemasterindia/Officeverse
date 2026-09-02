/**
 * Phase 8 — Performance Intelligence authorization.
 *
 *   Admin + Closer (Operations Manager)  → full leaderboard + breakdown + snapshot.
 *   HR                                   → keeps its EXISTING gamification read
 *                                          (leaderboard + any participant), but
 *                                          NOT the new Operations-only breakdown
 *                                          / incentive snapshot.
 *   Agent                                → own row / own detail only.
 *
 * No DB in this test env → the services return `dbUnavailable` AFTER the role
 * gate, so a denied role still throws first.
 */
import { describe, expect, it } from "vitest";
import { HttpError } from "../http-error";
import {
  incentiveReadySnapshot,
  performanceBreakdown,
  performanceEmployee,
  performanceLeaderboard,
} from "../gamification/performance";

const U = (id: number, role: "admin" | "agent" | "closer" | "hr") => ({
  id,
  role,
  process: "US" as const,
});
const admin = U(1, "admin");
const hr = U(2, "hr");
const closer = U(5, "closer");
const agent = U(3, "agent");

async function code(p: Promise<unknown>): Promise<number | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
}

describe("performanceLeaderboard — visibility", () => {
  it("admin / closer / hr see the full board (selfOnly = false)", async () => {
    for (const u of [admin, closer, hr]) {
      const r = await performanceLeaderboard(u, { period: "today" });
      expect(r.selfOnly).toBe(false);
    }
  });
  it("an agent sees only their own row (selfOnly = true)", async () => {
    const r = await performanceLeaderboard(agent, { period: "today" });
    expect(r.selfOnly).toBe(true);
  });
});

describe("performanceEmployee — drill-down", () => {
  it("anyone may view their OWN detail", async () => {
    expect(await code(performanceEmployee(agent, agent.id, { period: "today" }))).not.toBe(403);
  });
  it("admin / hr / closer may view ANY employee's detail", async () => {
    for (const u of [admin, hr, closer]) {
      expect(await code(performanceEmployee(u, 999, { period: "today" }))).not.toBe(403);
    }
  });
  it("an agent may NOT view another employee's detail (403)", async () => {
    expect(await code(performanceEmployee(agent, 999, { period: "today" }))).toBe(403);
  });
});

describe("performanceBreakdown + incentiveReadySnapshot — Operations only", () => {
  it("admin + closer are allowed", async () => {
    for (const u of [admin, closer]) {
      expect(await code(performanceBreakdown(u, { period: "week" }))).not.toBe(403);
      expect(await code(incentiveReadySnapshot(u, { period: "week" }))).not.toBe(403);
    }
  });
  it("agent + HR are denied the Operations-only breakdown / snapshot (403)", async () => {
    for (const u of [agent, hr]) {
      expect(await code(performanceBreakdown(u, { period: "week" }))).toBe(403);
      expect(await code(incentiveReadySnapshot(u, { period: "week" }))).toBe(403);
    }
  });
});

describe("no cross-role leakage — custom range still gated", () => {
  it("agent custom-range breakdown is still 403 (gate before window resolution)", async () => {
    expect(
      await code(
        performanceBreakdown(agent, { period: "custom", from: "2026-01-01", to: "2026-12-31" }),
      ),
    ).toBe(403);
  });
});
