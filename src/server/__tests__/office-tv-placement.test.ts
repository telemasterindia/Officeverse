import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const importsOf = (code: string) =>
  [...code.matchAll(/(?:import|export)[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]!);

const LIVE_FILES = readdirSync(join(root, "server", "live")).map((f) => `server/live/${f}`);
const SUPPORT_FILES = [
  "server/db/repos/office-tv.ts",
  "server/authz/office-tv.ts",
  "lib/officeverse/office-tv-fns.ts",
  "lib/officeverse/use-office-tv.ts",
];

describe("Office TV — PAYROLL ISOLATION (announcements are not money)", () => {
  it("no Office TV / celebration module imports payroll / salary / HR / incentive code", () => {
    for (const f of [...LIVE_FILES, ...SUPPORT_FILES]) {
      for (const spec of importsOf(stripComments(read(f)))) {
        // the photo store is shared infra (Phase 19) and is allowed
        if (spec.includes("photo-storage") || spec.includes("salary-slip-storage")) continue;
        expect(
          /(^|\/)(hr|payroll)(\/|$)|salary(?!-slip-storage)|regularity|incentive|commission/i.test(
            spec,
          ),
          `${f} must not import "${spec}"`,
        ).toBe(false);
      }
    }
  });

  it("no Office TV module reads a payroll / salary identifier", () => {
    for (const f of [...LIVE_FILES, ...SUPPORT_FILES]) {
      expect(stripComments(read(f))).not.toMatch(
        /calculatedSalary|baseSalary|regularityBonus|closerIncentive|payrollRun\b|salarySlip/,
      );
    }
  });

  it("the recognition wiring imports nothing from the HR/payroll tree", () => {
    for (const spec of importsOf(stripComments(read("server/live/recognition.ts")))) {
      expect(/(^|\/)(hr|payroll)(\/|$)/.test(spec)).toBe(false);
    }
  });

  it("the payroll engine does not import Office TV / celebration / recognition", () => {
    for (const f of readdirSync(join(root, "server", "hr"))) {
      const code = stripComments(readFileSync(join(root, "server", "hr", f), "utf8"));
      expect(code).not.toMatch(/live\/|office-tv|recognition|celebration/i);
    }
  });

  it("no Office TV surface renders a currency amount (points are abstract)", () => {
    for (const f of ["routes/office-tv.tsx", "routes/_shell.live.tsx", ...LIVE_FILES]) {
      expect(stripComments(read(f)), f).not.toMatch(/₹|\$\d|\bUSD\b|\bINR\b/);
    }
  });
});

describe("Office TV — follow-up exclusion", () => {
  it("the follow-up service never wires a celebration / recognition", () => {
    const code = stripComments(read("server/followups/service.ts"));
    expect(code).not.toMatch(/from ["']\.\.\/live\//);
    expect(code).not.toMatch(/recognizeSafe|onLeadAccepted|onLeadSubmitted|onSale/);
  });

  it("the orchestrator has no follow-up branch in its logic", () => {
    const code = stripComments(read("server/live/orchestrator.ts"));
    expect(code).not.toMatch(/FOLLOW.?UP/i);
  });
});

describe("Office TV — server authority & non-blocking wiring", () => {
  it("recognition is fired best-effort from confirmed lead events (never blocks the workflow)", () => {
    const code = read("server/leads/service.ts");
    expect(code).toMatch(/recognizeSafe\(onLeadSubmitted\(/);
    expect(code).toMatch(/recognizeSafe\(onLeadAccepted\(/);
    expect(code).toMatch(/recognizeSafe\(onSale\(/);
    // acceptance only fires on the guarded ASSIGNED → ACCEPTED transition
    expect(code).toMatch(/row\.status === "ASSIGNED" && to === "ACCEPTED"/);
  });

  it("recognizeSafe swallows errors — it returns void and catches", () => {
    const code = read("server/live/recognition.ts");
    expect(code).toMatch(/export function recognizeSafe/);
    expect(code).toMatch(/\.catch\(/);
  });

  it("every exported Office TV server fn derives identity via requireUser()", () => {
    const fns = read("lib/officeverse/office-tv-fns.ts");
    const handlers = fns.split(/export const \w+Fn/).slice(1);
    expect(handlers.length).toBeGreaterThan(8);
    for (const h of handlers) expect(h).toMatch(/requireUser\(\)/);
  });

  it("the client never submits a recognition event, point amount, rank or sale flag", () => {
    const fns = read("lib/officeverse/office-tv-fns.ts");
    expect(fns).not.toMatch(
      /awardFn|recognizeFn|emitEventFn|points:\s*z\.|rank:|isSale|saleHappened/,
    );
  });

  it("the /office-tv surface is token-only: no session import, no server-fn mutation", () => {
    const tv = read("routes/office-tv.tsx");
    expect(tv).not.toMatch(/useSession|meFn|_shell|requireUser/);
    expect(tv).not.toMatch(/-fns["']/); // does not import any *-fns server-function module
    expect(tv).toMatch(/x-display-token/);
  });

  it("no Office TV module lives under src/server/api (client-bundle protection)", () => {
    const apiFiles = readdirSync(join(root, "server", "api"));
    expect(apiFiles.some((f) => /office|tv|celebration|announce/i.test(f))).toBe(false);
  });
});
