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
    const code = stripComments(read("server/leads/service.ts"));
    // Phase 5: LEAD_SUBMITTED recognition now flows through the ONE canonical
    // BusinessEvent (dispatcher → recognition bridge), not a direct call.
    expect(code).toMatch(/emitBusinessEvent\(/);
    expect(code).not.toMatch(/recognizeSafe\(onLeadSubmitted\(/);
    // LEAD_ACCEPTED / SALE are still direct (not migrated)
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

describe("Phase 10 Stage 3 — TV rotation + screens stay presentation-only", () => {
  const TV_DIR = join(root, "components", "officeverse", "tv");
  const tvFiles = readdirSync(TV_DIR)
    .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.endsWith(".test.ts"))
    .map((f) => `components/officeverse/tv/${f}`);

  it("the rotation dir exists with the pure model + the single hook + the screens", () => {
    expect(tvFiles.sort()).toEqual(
      [
        "components/officeverse/tv/tv-rotation.ts",
        "components/officeverse/tv/tv-screens.tsx",
        "components/officeverse/tv/useTvRotation.ts",
      ].sort(),
    );
  });

  for (const f of tvFiles) {
    const src = stripComments(read(f));
    it(`${f} imports no server / scoring / events / db / *-fns code and does not fetch`, () => {
      for (const spec of importsOf(src)) {
        expect(
          /(^|\/)(server|scoring|events|db)\//.test(spec) ||
            /-fns["']?$/.test(spec) ||
            /gamification|incentive|business-event|dispatcher/.test(spec),
          `${f} imports "${spec}"`,
        ).toBe(false);
      }
      expect(src).not.toMatch(/\bfetch\s*\(|new WebSocket|EventSource|XMLHttpRequest/);
      expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/);
      // no point / rank arithmetic — the leaderboard rows arrive fully resolved
      expect(src).not.toMatch(/rankLeaderboard|awardScored|points\s*=\s*\d{2,}|\.reduce\(.*points/);
    });
  }

  it("tv-rotation.ts is a PURE model — no React, no timers", () => {
    const src = stripComments(read("components/officeverse/tv/tv-rotation.ts"));
    expect(src).not.toMatch(/from ["']react["']|useEffect|useState|setInterval|setTimeout/);
  });

  it("useTvRotation owns exactly ONE interval and cleans it up (no scattered setTimeout)", () => {
    const src = stripComments(read("components/officeverse/tv/useTvRotation.ts"));
    expect((src.match(/setInterval\(/g) ?? []).length).toBe(1);
    expect(src).toMatch(/return \(\) => clearInterval\(/);
    expect(src).not.toMatch(/setTimeout\(/); // timing lives in the pure reducer only
    // every timing decision is delegated to the pure reducer
    expect(src).toMatch(/rotationTick\(/);
  });

  it("the screen components never own a timer — the hook is the single clock", () => {
    const src = stripComments(read("components/officeverse/tv/tv-screens.tsx"));
    expect(src).not.toMatch(/setInterval\(|setTimeout\(|requestAnimationFrame\(/);
  });

  it("office-tv.tsx renders the rotation and still keeps its interrupt queue + polling", () => {
    const src = read("routes/office-tv.tsx");
    expect(src).toMatch(/RotatingScreens/);
    expect(src).toMatch(/from "@\/components\/officeverse\/tv\/tv-screens"/);
    // the Stage-1/2 interrupt machinery is untouched
    expect(src).toMatch(/queueRef\.current\.push\(/);
    expect(src).toMatch(/if \(current \|\| queueRef\.current\.length === 0\) return/);
    expect(src).toMatch(/\/api\/office-tv\/state/);
    expect(src).toMatch(/POLL_MS/);
    // rotation pauses while an interrupt is on screen
    expect(src).toMatch(/paused=\{interrupted\}/);
  });

  it("tv-service recent enrichment reads the AUTHORITATIVE ledger, never recomputes", () => {
    const src = stripComments(read("server/live/tv-service.ts"));
    expect(src).toMatch(/pointsByReferences\(/); // ACTIVE-ledger SUM, no scoring
    expect(src).toMatch(/buildRecentRecognitionFeed\(/);
    expect(src).not.toMatch(/awardScored|evaluateScoring|scoring\.ingest/);
    // leaderboard still comes from the Phase-8 service, not a browser calc
    expect(src).toMatch(/getLeaderboard\(/);
  });
});
