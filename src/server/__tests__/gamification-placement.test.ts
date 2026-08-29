import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const GAM_SERVER_FILES = [
  "server/gamification/points.ts",
  "server/gamification/leaderboard.ts",
  "server/gamification/streaks.ts",
  "server/gamification/achievements.ts",
  "server/gamification/service.ts",
  "server/db/repos/gamification.ts",
  "server/authz/gamification.ts",
];

const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const importsOf = (code: string) =>
  [...code.matchAll(/(?:import|export)[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]!);

describe("gamification — PAYROLL ISOLATION (points are not money)", () => {
  it("no gamification server module imports payroll / salary / HR / incentive code", () => {
    for (const f of GAM_SERVER_FILES) {
      const code = stripComments(read(f));
      for (const spec of importsOf(code)) {
        expect(
          /(^|\/)(hr|payroll)(\/|$)|salary|regularity|incentive|commission/i.test(spec),
          `${f} must not import "${spec}"`,
        ).toBe(false);
      }
    }
  });

  it("no gamification server module reads a payroll / salary identifier", () => {
    for (const f of GAM_SERVER_FILES) {
      const code = stripComments(read(f));
      expect(code).not.toMatch(
        /calculatedSalary|baseSalary|regularityBonus|closerIncentive|payrollRun|salarySlip/,
      );
    }
  });

  it("no gamification file renders a currency amount", () => {
    const files = [
      ...GAM_SERVER_FILES,
      "lib/officeverse/gamification-fns.ts",
      "lib/officeverse/use-gamification.ts",
      "routes/_shell.leaderboard.tsx",
    ];
    for (const f of files) {
      const code = stripComments(read(f));
      expect(code, `${f}`).not.toMatch(/₹|\$\d|USD|INR|\bpaise\b/);
    }
  });

  it("the payroll engine does not import gamification", () => {
    const payrollFiles = readdirSync(join(root, "server", "hr")).map((f) =>
      readFileSync(join(root, "server", "hr", f), "utf8"),
    );
    for (const code of payrollFiles) {
      expect(stripComments(code)).not.toMatch(/gamification/i);
    }
  });
});

describe("gamification — points engine surface", () => {
  it("the auto-award events are exactly the approved five (no follow-up activity)", () => {
    const code = read("server/gamification/points.ts");
    const block = code.slice(code.indexOf("AUTO_AWARD_EVENTS")).split("= [")[1]!.split("]")[0]!;
    expect(block).toMatch(/LEAD_SUBMITTED/);
    expect(block).toMatch(/LEAD_ACCEPTED/);
    expect(block).toMatch(/SALE/);
    expect(block).toMatch(/TEAM_MILESTONE/);
    expect(block).toMatch(/ACHIEVEMENT_UNLOCKED/);
    expect(block).not.toMatch(/FOLLOW|VIEW|OPEN|CLICK|EDIT/i);
  });

  it("no hard-coded example point values (+1 / +5 / +20) in the engine", () => {
    const code = stripComments(read("server/gamification/points.ts"));
    // the only numeric literal in a default rule is `points: 0`
    for (const m of code.matchAll(/points:\s*(-?\d+)/g)) {
      expect(m[1]).toBe("0");
    }
  });
});

describe("gamification — client trust boundary", () => {
  const fns = read("lib/officeverse/gamification-fns.ts");

  it("every exported server fn derives identity via requireUser()", () => {
    const handlers = fns.split(/export const \w+Fn/).slice(1);
    expect(handlers.length).toBeGreaterThan(0);
    for (const h of handlers) expect(h).toMatch(/requireUser\(\)/);
  });

  it("the client never submits a point amount for an award, nor a rank / score / achievement", () => {
    // there is no "award" endpoint at all
    expect(fns).not.toMatch(/awardEventFn|givePointsFn|addPointsFn/);
    // no input schema accepts a rank / score / achievement code / sale flag
    expect(fns).not.toMatch(/rank:|score:|achievementCode|isSale|saleHappened/);
    // `points:` appears only for the admin adjustment + the admin rule config
    const pointsUses = [...fns.matchAll(/points:\s*z\./g)];
    expect(pointsUses.length).toBe(2);
  });

  it("no gamification module lives under src/server/api (client-bundle protection)", () => {
    const apiFiles = readdirSync(join(root, "server", "api"));
    expect(apiFiles.some((f) => /gamif|leaderboard|points|streak|achievement/i.test(f))).toBe(
      false,
    );
  });

  it("the leaderboard route reassures that points are not money", () => {
    const route = read("routes/_shell.leaderboard.tsx");
    expect(route).toMatch(/no effect on pay|not.*money|recognition score only/i);
  });
});
