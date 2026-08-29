import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACHIEVEMENTS,
  evaluateAchievements,
  type AchievementRowLike,
  type AchievementSignals,
} from "../gamification/achievements";

const base: AchievementSignals = {
  acceptedLeadCount: 0,
  salesCount: 0,
  submittedLeadCount: 0,
  acceptedLeadStreak: 0,
  alreadyEarned: new Set<string>(),
};

const registry: AchievementRowLike[] = [
  {
    code: "FIRST_ACCEPTED_LEAD",
    criteria: { kind: "COUNT", event: "LEAD_ACCEPTED", threshold: 1 },
    repeatable: false,
    enabled: true,
  },
  {
    code: "MILESTONE_ACCEPTED_LEADS",
    criteria: { kind: "COUNT", event: "LEAD_ACCEPTED", threshold: 0 }, // parked
    repeatable: false,
    enabled: true,
  },
  {
    code: "ACCEPTED_LEAD_STREAK",
    criteria: { kind: "STREAK", streakType: "ACCEPTED_LEAD_STREAK", threshold: 5 },
    repeatable: false,
    enabled: true,
  },
  {
    code: "SECRET",
    criteria: { kind: "MANUAL" },
    repeatable: false,
    enabled: true,
  },
  {
    code: "DISABLED_ONE",
    criteria: { kind: "COUNT", event: "SALE", threshold: 1 },
    repeatable: false,
    enabled: false,
  },
];

describe("achievements — data-driven, threshold read from criteria", () => {
  it("seed registry never bakes an arbitrary milestone threshold into logic (parked at 0)", () => {
    const milestone = DEFAULT_ACHIEVEMENTS.find((a) => a.code === "MILESTONE_ACCEPTED_LEADS")!;
    expect(milestone.criteria).toMatchObject({ threshold: 0 });
    const streak = DEFAULT_ACHIEVEMENTS.find((a) => a.code === "ACCEPTED_LEAD_STREAK")!;
    expect(streak.criteria).toMatchObject({ threshold: 0 });
  });

  it("awards a COUNT achievement once the threshold is met", () => {
    expect(evaluateAchievements(registry, { ...base, acceptedLeadCount: 1 })).toContain(
      "FIRST_ACCEPTED_LEAD",
    );
  });

  it("does not re-award something already earned (award-once)", () => {
    const earned = evaluateAchievements(registry, {
      ...base,
      acceptedLeadCount: 3,
      alreadyEarned: new Set(["FIRST_ACCEPTED_LEAD"]),
    });
    expect(earned).not.toContain("FIRST_ACCEPTED_LEAD");
  });

  it("a threshold of 0 is parked — never satisfied", () => {
    expect(evaluateAchievements(registry, { ...base, acceptedLeadCount: 999 })).not.toContain(
      "MILESTONE_ACCEPTED_LEADS",
    );
  });

  it("STREAK criteria compares against the accepted-lead streak", () => {
    expect(evaluateAchievements(registry, { ...base, acceptedLeadStreak: 4 })).not.toContain(
      "ACCEPTED_LEAD_STREAK",
    );
    expect(evaluateAchievements(registry, { ...base, acceptedLeadStreak: 5 })).toContain(
      "ACCEPTED_LEAD_STREAK",
    );
  });

  it("MANUAL achievements are never auto-awarded", () => {
    expect(
      evaluateAchievements(registry, {
        ...base,
        acceptedLeadCount: 100,
        salesCount: 100,
        acceptedLeadStreak: 100,
      }),
    ).not.toContain("SECRET");
  });

  it("disabled achievements are skipped", () => {
    expect(evaluateAchievements(registry, { ...base, salesCount: 5 })).not.toContain(
      "DISABLED_ONE",
    );
  });

  it("malformed criteria JSON is ignored, not crashed on", () => {
    const bad: AchievementRowLike[] = [
      { code: "X", criteria: "not-json", repeatable: false, enabled: true },
      { code: "Y", criteria: null, repeatable: false, enabled: true },
      { code: "Z", criteria: { kind: "WAT" }, repeatable: false, enabled: true },
    ];
    expect(evaluateAchievements(bad, { ...base, acceptedLeadCount: 10 })).toEqual([]);
  });
});
