/**
 * Phase 10 Stage 3 — OFFICE TV rotation model. PURE.
 *
 * Deterministic screen order, deterministic timing, interrupt = pause, safe
 * reconcile on polling updates. No React, no timers, no scoring.
 */
import { describe, expect, it } from "vitest";
import {
  INITIAL_ROTATION,
  buildRotationScreens,
  clampIndex,
  nextIndex,
  reconcileRotation,
  rotationTick,
  screenSignature,
  windowLabel,
} from "../tv-rotation";

/** every availability flag off — a test opts each screen in explicitly */
const AV0 = {
  hasDailyProduction: false,
  hasLeaderboard: false,
  hasTeamPhoto: false,
  hasPowerHour: false,
  hasAchievement: false,
};

describe("buildRotationScreens — deterministic Stage-5 order, empty screens skipped", () => {
  it("leaderboard + achievement → HERO → LEADERBOARD → RECENT_ACHIEVEMENT", () => {
    expect(
      buildRotationScreens({ ...AV0, hasLeaderboard: true, hasAchievement: true }).map(
        (s) => s.kind,
      ),
    ).toEqual(["HERO", "LEADERBOARD", "RECENT_ACHIEVEMENT"]);
  });
  it("no leaderboard data → the leaderboard screen is skipped", () => {
    expect(
      buildRotationScreens({ ...AV0, hasLeaderboard: false, hasAchievement: true }).map(
        (s) => s.kind,
      ),
    ).toEqual(["HERO", "RECENT_ACHIEVEMENT"]);
  });
  it("no achievement feed → the achievement screen is skipped", () => {
    expect(
      buildRotationScreens({ ...AV0, hasLeaderboard: true, hasAchievement: false }).map(
        (s) => s.kind,
      ),
    ).toEqual(["HERO", "LEADERBOARD"]);
  });
  it("no data at all → HERO only (the TV never goes blank)", () => {
    expect(buildRotationScreens(AV0).map((s) => s.kind)).toEqual(["HERO"]);
  });
  it("screenSignature is a stable identity of the set", () => {
    expect(
      screenSignature(buildRotationScreens({ ...AV0, hasLeaderboard: true, hasAchievement: true })),
    ).toBe("HERO|LEADERBOARD|RECENT_ACHIEVEMENT");
  });

  it("Stage 5 — full rotation order: HERO → DAILY_PRODUCTION → LEADERBOARD → POWER_HOUR → RECENT_ACHIEVEMENT", () => {
    expect(
      buildRotationScreens({
        hasDailyProduction: true,
        hasLeaderboard: true,
        hasTeamPhoto: false,
        hasPowerHour: true,
        hasAchievement: true,
      }).map((s) => s.kind),
    ).toEqual(["HERO", "DAILY_PRODUCTION", "LEADERBOARD", "POWER_HOUR", "RECENT_ACHIEVEMENT"]);
  });
  it("Stage 5 — Daily Production sits right after HERO and is skipped when no agent produced today", () => {
    expect(buildRotationScreens({ ...AV0, hasDailyProduction: true }).map((s) => s.kind)).toEqual([
      "HERO",
      "DAILY_PRODUCTION",
    ]);
    expect(
      buildRotationScreens({ ...AV0, hasDailyProduction: false, hasLeaderboard: true }).map(
        (s) => s.kind,
      ),
    ).toEqual(["HERO", "LEADERBOARD"]);
  });
  it("Stage 5 — Power Hour screen only appears while a Power Hour is active", () => {
    expect(buildRotationScreens({ ...AV0, hasPowerHour: false }).map((s) => s.kind)).toEqual([
      "HERO",
    ]);
    expect(buildRotationScreens({ ...AV0, hasPowerHour: true }).map((s) => s.kind)).toEqual([
      "HERO",
      "POWER_HOUR",
    ]);
  });
  it("Stage 5 — Team Photo slot stays reserved (never shown — no configuration surface)", () => {
    expect(buildRotationScreens({ ...AV0, hasTeamPhoto: true }).map((s) => s.kind)).toEqual([
      "HERO",
      "TEAM_PHOTO",
    ]); // pure function honours the flag …
    // … but the TV never sets it (RotatingScreens passes hasTeamPhoto: false)
  });
});

describe("clampIndex / nextIndex — wrap safely", () => {
  it("wraps forward", () => {
    expect(nextIndex(0, 3)).toBe(1);
    expect(nextIndex(2, 3)).toBe(0);
  });
  it("clamps out-of-range / negative", () => {
    expect(clampIndex(7, 3)).toBe(1);
    expect(clampIndex(-1, 3)).toBe(2);
    expect(clampIndex(5, 0)).toBe(0);
  });
});

describe("rotationTick — timing, pause, wrap, resilience", () => {
  const base = { dtMs: 1000, rotationMs: 3000, paused: false, len: 3 };

  it("holds the screen until the dwell time is reached, then advances + resets", () => {
    let s = INITIAL_ROTATION;
    s = rotationTick(s, base); // 1000
    expect(s).toEqual({ index: 0, elapsedMs: 1000 });
    s = rotationTick(s, base); // 2000
    expect(s).toEqual({ index: 0, elapsedMs: 2000 });
    s = rotationTick(s, base); // 3000 → advance
    expect(s).toEqual({ index: 1, elapsedMs: 0 });
  });

  it("does not accumulate time while paused (interrupt on screen)", () => {
    let s = { index: 1, elapsedMs: 2000 };
    for (let i = 0; i < 20; i++) s = rotationTick(s, { ...base, paused: true });
    expect(s).toEqual({ index: 1, elapsedMs: 2000 });
  });

  it("resumes from where it left off after the pause clears", () => {
    let s = { index: 1, elapsedMs: 2000 };
    s = rotationTick(s, { ...base, paused: true });
    expect(s).toEqual({ index: 1, elapsedMs: 2000 });
    s = rotationTick(s, base); // 3000 → advance
    expect(s).toEqual({ index: 2, elapsedMs: 0 });
  });

  it("wraps at the end of the list", () => {
    let s = { index: 2, elapsedMs: 2000 };
    s = rotationTick(s, base);
    expect(s).toEqual({ index: 0, elapsedMs: 0 });
  });

  it("a shrunk screen list clamps the index without a hard reset", () => {
    const s = rotationTick({ index: 2, elapsedMs: 500 }, { ...base, len: 2 });
    expect(s.index).toBeLessThan(2);
  });

  it("len 0 → holds at index 0", () => {
    expect(rotationTick({ index: 1, elapsedMs: 900 }, { ...base, len: 0 })).toEqual({
      index: 0,
      elapsedMs: 0,
    });
  });

  it("is deterministic — same state + input → same output", () => {
    const s = { index: 1, elapsedMs: 1200 };
    const a = rotationTick(s, base);
    for (let i = 0; i < 10; i++) expect(rotationTick(s, base)).toEqual(a);
  });

  it("a tiny rotationMs is floored to 1 s — the TV can never spin faster than one tick", () => {
    // dwell floored to 1000; a 1000 ms tick meets it → advance (never sub-second)
    const s = rotationTick({ index: 0, elapsedMs: 0 }, { ...base, rotationMs: 10 });
    expect(s).toEqual({ index: 1, elapsedMs: 0 });
  });
});

describe("reconcileRotation — polling never restarts the rotation", () => {
  it("same signature → index is only clamped, elapsed preserved", () => {
    const s = { index: 2, elapsedMs: 1500 };
    expect(
      reconcileRotation(
        s,
        "HERO|LEADERBOARD|RECENT_ACHIEVEMENT",
        "HERO|LEADERBOARD|RECENT_ACHIEVEMENT",
        3,
      ),
    ).toEqual(s);
  });
  it("changed signature → restart from the first screen", () => {
    const s = { index: 2, elapsedMs: 1500 };
    expect(
      reconcileRotation(s, "HERO|LEADERBOARD", "HERO|LEADERBOARD|RECENT_ACHIEVEMENT", 3),
    ).toEqual({
      index: 0,
      elapsedMs: 0,
    });
  });
});

describe("windowLabel — the Phase-8 leaderboard window drives the heading", () => {
  it("maps every window", () => {
    expect(windowLabel("daily")).toBe("TODAY'S");
    expect(windowLabel("weekly")).toBe("THIS WEEK'S");
    expect(windowLabel("monthly")).toBe("THIS MONTH'S");
    expect(windowLabel("alltime")).toBe("ALL-TIME");
    expect(windowLabel("garbage")).toBe("TODAY'S");
  });
});
