/**
 * OFFICEVERSE — STAGE 5 · Daily Production TV screen (PURE / structural).
 *
 * Proves the Stage-5 additions are wiring-only:
 *   - the "Today's Production" data comes from the SAME authoritative per-agent
 *     aggregation the Performance screen uses (`performanceAggregate`), for the
 *     today window — no new scoring, no duplicated aggregation, no hard-coded
 *     names / numbers.
 *   - the screen component is presentation-only (no fetch, no timer, no ranking).
 *   - the rotation gains exactly one normal screen (DAILY_PRODUCTION), keeps its
 *     single interval + interrupt model, and the Stage-5 order is deterministic.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRotationScreens, TV_SCREEN_KINDS } from "@/components/officeverse/tv/tv-rotation";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("Daily Production — authoritative data source, no duplicate aggregation", () => {
  const svc = stripComments(read("server/live/tv-service.ts"));

  it("tv-service reads the existing per-agent aggregation for TODAY's operational window", () => {
    expect(svc).toMatch(/performanceAggregate\(/);
    expect(svc).toMatch(/resolvePerformancePeriod\(serverDate, \{ period: "today" \}\)/);
    // it is the agent-wise numbers, filtered to agents, capped — not a leaderboard
    expect(svc).toMatch(/\.filter\(\(r\) => r\.role === "agent"\)/);
    expect(svc).toMatch(/leadsSubmitted: r\.leadsSubmitted/);
    expect(svc).toMatch(/leadsAccepted: r\.leadsAccepted/);
    expect(svc).toMatch(/sales: r\.sales/);
  });

  it("Daily Production NEVER writes points / runs scoring / mutates CRM", () => {
    // no scoring-engine or CRM write from the TV state builder
    expect(svc).not.toMatch(/awardScored|evaluateScoring|scoring\.ingest|dispatchBusinessEvent/);
    expect(svc).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(svc).not.toMatch(/recordAudit\(/); // building TV state audits nothing
  });

  it("no hard-coded employees or production numbers on the TV path", () => {
    const screens = stripComments(read("components/officeverse/tv/tv-screens.tsx"));
    for (const bad of ["AMIT", "RAHUL", "MOHIT", "Pratibha"]) {
      expect(svc.includes(bad)).toBe(false);
      expect(screens.includes(bad)).toBe(false);
    }
    // the screen renders whatever rows it is given
    expect(screens).toMatch(/data\.dailyProduction\.slice\(/);
    expect(screens).toMatch(/\{r\.name\}/);
    expect(screens).toMatch(/\{r\.leadsSubmitted\}/);
    expect(screens).toMatch(/\{r\.leadsAccepted\}/);
    expect(screens).toMatch(/\{r\.sales\}/);
  });
});

describe("Daily Production screen — presentation only", () => {
  const screens = stripComments(read("components/officeverse/tv/tv-screens.tsx"));
  it("owns no timer, does not fetch, imports no server / *-fns code", () => {
    expect(screens).not.toMatch(/setInterval\(|setTimeout\(|requestAnimationFrame\(/);
    expect(screens).not.toMatch(/\bfetch\s*\(|new WebSocket|EventSource/);
    for (const line of screens.split("\n").filter((l) => l.startsWith("import "))) {
      expect(/(^|\/)(server|scoring|db)\//.test(line) || /-fns["']/.test(line)).toBe(false);
    }
  });
  it("exports a DailyProductionScreen and routes DAILY_PRODUCTION to it", () => {
    expect(screens).toMatch(/export function DailyProductionScreen/);
    expect(screens).toMatch(/case "DAILY_PRODUCTION":\s*\n?\s*return <DailyProductionScreen/);
    expect(screens).toMatch(/TODAY&apos;S PRODUCTION/);
  });
});

describe("rotation — Daily Production is an ordinary normal screen (Stage-5 order)", () => {
  it("DAILY_PRODUCTION is a registered screen kind, right after HERO", () => {
    expect([...TV_SCREEN_KINDS]).toContain("DAILY_PRODUCTION");
    const full = buildRotationScreens({
      hasDailyProduction: true,
      hasLeaderboard: true,
      hasTeamPhoto: false,
      hasPowerHour: false,
      hasAchievement: true,
    }).map((s) => s.kind);
    expect(full).toEqual(["HERO", "DAILY_PRODUCTION", "LEADERBOARD", "RECENT_ACHIEVEMENT"]);
  });

  it("no agent produced today → the screen is simply skipped (TV never blank)", () => {
    expect(
      buildRotationScreens({
        hasDailyProduction: false,
        hasLeaderboard: false,
        hasTeamPhoto: false,
        hasPowerHour: false,
        hasAchievement: false,
      }).map((s) => s.kind),
    ).toEqual(["HERO"]);
  });

  it("the single-interval + interrupt model is untouched", () => {
    const hook = stripComments(read("components/officeverse/tv/useTvRotation.ts"));
    expect((hook.match(/setInterval\(/g) ?? []).length).toBe(1);
    expect(hook).toMatch(/return \(\) => clearInterval\(/);
    const route = read("routes/office-tv.tsx");
    expect(route).toMatch(/paused=\{interrupted\}/);
    expect(route).toMatch(/queueRef\.current\.push\(/);
    expect(route).toMatch(/const POLL_MS = 2500/); // unchanged, one poller
    expect((route.match(/setInterval\(/g) ?? []).length).toBe(2); // poll + celebration driver, pre-existing
  });
});

describe("Power Hour on the TV reuses the existing announcement (no new engine)", () => {
  const svc = stripComments(read("server/live/tv-service.ts"));
  it("powerHour is derived from announcement.effect === POWERHOUR", () => {
    expect(svc).toMatch(/announcement\.effect === "POWERHOUR"/);
    expect(svc).not.toMatch(/new .*PowerHour.*Engine|powerHourScore|powerHourLeaderboard/);
  });
  it("teamPhoto stays a reserved null slot (no configuration surface added)", () => {
    expect(svc).toMatch(/teamPhoto: null/);
  });
});
