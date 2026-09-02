/**
 * Phase 10 Stage 4 — MILESTONE evaluation core. PURE.
 *
 * Period → operational-date window (Phase-8 semantics), deterministic dedupe
 * key per trigger policy, threshold-crossing decision, recognition payload with
 * NO fabricated person for a team milestone.
 */
import { describe, expect, it } from "vitest";
import {
  buildMilestoneRecognition,
  crossed,
  dedupeKeyFor,
  periodKeyFor,
  periodToWindowKind,
  windowFor,
  type DedupeInput,
} from "../milestones/milestone-eval";

describe("period → window", () => {
  it("maps the milestone period to the Phase-8 leaderboard window kind", () => {
    expect(periodToWindowKind("DAILY")).toBe("daily");
    expect(periodToWindowKind("WEEKLY")).toBe("weekly");
    expect(periodToWindowKind("MONTHLY")).toBe("monthly");
    expect(periodToWindowKind("ALL_TIME")).toBe("alltime");
  });
  it("windowFor uses operational-date bounds; ALL_TIME is unbounded", () => {
    expect(windowFor("ALL_TIME", "2026-09-01")).toEqual({ from: null, to: null });
    expect(windowFor("DAILY", "2026-09-01")).toEqual({ from: "2026-09-01", to: "2026-09-01" });
    const wk = windowFor("WEEKLY", "2026-09-02"); // a Wednesday
    expect(wk.from).toBe("2026-08-31"); // ISO-week Monday
    expect(wk.to).toBe("2026-09-06");
    expect(windowFor("MONTHLY", "2026-09-15")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("periodKeyFor is a short stable key", () => {
    expect(periodKeyFor("ALL_TIME", "2026-09-01")).toBe("all");
    expect(periodKeyFor("DAILY", "2026-09-01")).toBe("2026-09-01");
    expect(periodKeyFor("WEEKLY", "2026-09-02")).toBe("2026-08-31");
    expect(periodKeyFor("MONTHLY", "2026-09-15")).toBe("2026-09");
  });
});

const di = (o: Partial<DedupeInput> = {}): DedupeInput => ({
  milestoneId: o.milestoneId ?? 7,
  policy: o.policy ?? "ONCE",
  isTeam: o.isTeam ?? false,
  userId: "userId" in o ? (o.userId ?? null) : 42,
  periodKey: o.periodKey ?? "2026-09-01",
  actualValue: o.actualValue ?? 10,
  threshold: o.threshold ?? 10,
});

describe("dedupeKeyFor — deterministic per policy", () => {
  it("ONCE — one key per (milestone, subject) forever", () => {
    expect(dedupeKeyFor(di({ policy: "ONCE" }))).toBe("milestone:7:user:42");
    expect(dedupeKeyFor(di({ policy: "ONCE", isTeam: true, userId: null }))).toBe(
      "milestone:7:team",
    );
  });
  it("PER_PERIOD — one key per period", () => {
    expect(dedupeKeyFor(di({ policy: "PER_PERIOD", periodKey: "2026-09" }))).toBe(
      "milestone:7:user:42:period:2026-09",
    );
  });
  it("EVERY_THRESHOLD_CROSSING — one key per multiple reached", () => {
    expect(
      dedupeKeyFor(di({ policy: "EVERY_THRESHOLD_CROSSING", actualValue: 10, threshold: 10 })),
    ).toBe("milestone:7:user:42:mult:1");
    expect(
      dedupeKeyFor(di({ policy: "EVERY_THRESHOLD_CROSSING", actualValue: 25, threshold: 10 })),
    ).toBe("milestone:7:user:42:mult:2");
  });
});

describe("crossed — threshold policy", () => {
  it("below threshold → does NOT fire", () => {
    expect(crossed(di({ actualValue: 9, threshold: 10 }), new Set()).fired).toBe(false);
  });
  it("exactly at threshold → fires once", () => {
    const d = crossed(di({ actualValue: 10, threshold: 10 }), new Set());
    expect(d.fired).toBe(true);
  });
  it("above threshold but already fired (ONCE) → does NOT fire again", () => {
    const key = dedupeKeyFor(di({ actualValue: 11 }));
    expect(crossed(di({ actualValue: 11 }), new Set([key])).fired).toBe(false);
  });
  it("PER_PERIOD — fires again in a new period", () => {
    const sep = di({ policy: "PER_PERIOD", periodKey: "2026-09", actualValue: 10 });
    const oct = di({ policy: "PER_PERIOD", periodKey: "2026-10", actualValue: 10 });
    const fired = new Set([dedupeKeyFor(sep)]);
    expect(crossed(sep, fired).fired).toBe(false); // September already fired
    expect(crossed(oct, fired).fired).toBe(true); // October is a fresh key
  });
  it("EVERY_THRESHOLD_CROSSING — fires at 10, again at 20, not at 11", () => {
    const fired = new Set<string>();
    const at = (v: number) => {
      const inp = di({ policy: "EVERY_THRESHOLD_CROSSING", actualValue: v, threshold: 10 });
      const d = crossed(inp, fired);
      if (d.fired) fired.add(d.dedupeKey);
      return d.fired;
    };
    expect(at(10)).toBe(true);
    expect(at(11)).toBe(false);
    expect(at(19)).toBe(false);
    expect(at(20)).toBe(true);
    expect(at(21)).toBe(false);
  });
  it("threshold 0 → never fires (parked config)", () => {
    expect(crossed(di({ actualValue: 5, threshold: 0 }), new Set()).fired).toBe(false);
  });
  it("is deterministic", () => {
    const inp = di({ actualValue: 10 });
    const a = crossed(inp, new Set());
    for (let i = 0; i < 10; i++) expect(crossed(inp, new Set())).toEqual(a);
  });
});

describe("buildMilestoneRecognition — team milestones carry NO subject", () => {
  it("individual → subject id + name in the headline, ACHIEVEMENT_UNLOCKED", () => {
    const r = buildMilestoneRecognition({
      milestoneId: 1,
      type: "INDIVIDUAL_COUNT",
      name: "100 Accepted Leads",
      description: "Reached 100 accepted leads.",
      isTeam: false,
      subjectUserId: 42,
      subjectName: "Amit",
      recognitionLevel: "LEVEL_2",
      threshold: 100,
      actualValue: 100,
      scopeLabel: null,
      points: null,
    });
    expect(r.kind).toBe("ACHIEVEMENT_UNLOCKED");
    expect(r.subjectUserId).toBe(42);
    expect(r.headline).toBe("100 ACCEPTED LEADS");
    expect(r.points).toBeNull();
  });
  it("team → subjectUserId null, TEAM_MILESTONE, no fabricated person", () => {
    const r = buildMilestoneRecognition({
      milestoneId: 2,
      type: "TEAM_COUNT",
      name: "Team 100 Leads",
      description: null,
      isTeam: true,
      subjectUserId: 42, // even if passed, it is discarded for a team milestone
      subjectName: "Amit",
      recognitionLevel: "LEVEL_3",
      threshold: 100,
      actualValue: 100,
      scopeLabel: "US",
      points: null,
    });
    expect(r.kind).toBe("TEAM_MILESTONE");
    expect(r.subjectUserId).toBeNull();
    expect(r.headline).toContain("TEAM US");
    expect(r.subheadline).not.toContain("Amit");
  });
  it("points are surfaced ONLY for a points milestone", () => {
    const r = buildMilestoneRecognition({
      milestoneId: 3,
      type: "INDIVIDUAL_POINTS",
      name: "5000 Points",
      description: null,
      isTeam: false,
      subjectUserId: 42,
      subjectName: "Amit",
      recognitionLevel: "LEVEL_2",
      threshold: 5000,
      actualValue: 5200,
      scopeLabel: null,
      points: 5200,
    });
    expect(r.points).toBe(5200);
  });
});
