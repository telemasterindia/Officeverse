/**
 * Phase 5 — architectural separation guards for the recognition bridge.
 *
 *   BusinessEvent → Dispatcher → { Scoring , Recognition }
 *   Scoring never recognises · Recognition never scores · one canonical event.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const importsOf = (code: string) =>
  [...code.matchAll(/(?:import|export)[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]!);

describe("Phase 5 — dispatcher stays infrastructure-only", () => {
  const disp = strip(read("server/events/dispatcher.ts"));
  it("no STATIC import of the recognition / Office-TV implementation", () => {
    for (const spec of importsOf(disp)) {
      expect(
        /(^|\/)live\//.test(spec) || /office-tv/i.test(spec),
        `dispatcher imports "${spec}"`,
      ).toBe(false);
    }
  });
  it("the recognition bridge is reached only via a dynamic import()", () => {
    expect(disp).toMatch(/import\(\s*["']\.\/recognition-bridge["']\s*\)/);
    expect(importsOf(disp)).not.toContain("./recognition-bridge");
  });
  it("the dispatcher never awards points itself — it delegates", () => {
    expect(disp).not.toMatch(/awardScored\(|awardEvent\(/);
    expect(disp).toMatch(/runLegacyPointsFallback\(/);
  });
});

describe("Phase 5 — recognition never imports the scoring engine", () => {
  for (const f of [
    "server/live/recognition.ts",
    "server/live/celebration-level.ts",
    "server/live/bus.ts",
    "server/live/orchestrator.ts",
  ]) {
    it(`${f} imports nothing from events/* or scoring/*`, () => {
      for (const spec of importsOf(strip(read(f)))) {
        expect(
          /(^|\/)(scoring)\//.test(spec) ||
            /events\/(business-event|dispatcher|emit|adapters|legacy-points|recognition-bridge)/.test(
              spec,
            ),
          `${f} imports "${spec}"`,
        ).toBe(false);
      }
    });
  }
  it("recognition.ts drives the moment only — no awardScored anywhere", () => {
    expect(strip(read("server/live/recognition.ts"))).not.toMatch(/awardScored/);
  });
});

describe("Phase 5 — celebration-level.ts is a pure semantic contract", () => {
  const src = strip(read("server/live/celebration-level.ts"));
  it("no data-access / engine / HR / payroll imports", () => {
    for (const spec of importsOf(src)) {
      expect(
        /(^|\/)(db|scoring|events|hr|payroll|gamification|live)\//.test(spec),
        `imports "${spec}"`,
      ).toBe(false);
    }
    // in fact it imports nothing at all
    expect(importsOf(src)).toEqual([]);
  });
  it("carries no currency / payroll identifier", () => {
    expect(src).not.toMatch(/₹|\$\d|\bUSD\b|\bINR\b|salary|payroll|incentive|commission/i);
  });
  it("exposes the LEVEL_0..LEVEL_4 scale + the temp default map, not point thresholds", () => {
    expect(src).toMatch(/LEVEL_0[\s\S]*LEVEL_4/);
    expect(src).toMatch(/DEFAULT_KIND_LEVEL/);
    // level is NOT derived from a numeric points threshold
    expect(src).not.toMatch(/points\s*[<>]=?\s*\d|>=\s*\d{2,}/);
  });
});

describe("Phase 5 — the recognition bridge is the ONE seam", () => {
  const evFiles = readdirSync(join(root, "server", "events"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `server/events/${f}`);

  it("recognition-bridge.ts is the only events/* file that imports live/*", () => {
    for (const f of evFiles) {
      const hasLive = importsOf(strip(read(f))).some((s) => /(^|\/)live\//.test(s));
      if (f.endsWith("recognition-bridge.ts")) expect(hasLive).toBe(true);
      else expect(hasLive, `${f} must not import live/*`).toBe(false);
    }
  });

  it("the bridge consumes the scoring RESULT read-only and awards nothing", () => {
    const src = strip(read("server/events/recognition-bridge.ts"));
    expect(src).not.toMatch(/evaluateScoring|awardScored|awardEvent|\bingest\(/);
    expect(src).toMatch(/ScoringDecision \| null/); // null-safe consumption
    expect(src).toMatch(/registerRecognitionSink\(recognitionBridge\)/);
  });

  it("legacy-points.ts reaches only the existing ledger (gamification), never the evaluator or live/*", () => {
    for (const spec of importsOf(strip(read("server/events/legacy-points.ts")))) {
      expect(
        /(^|\/)(live)\//.test(spec) || /scoring\/(ingest|conditions|modes|operators)/.test(spec),
        `legacy-points imports "${spec}"`,
      ).toBe(false);
    }
    expect(strip(read("server/events/legacy-points.ts"))).toMatch(/awardEvent/);
  });
});

describe("Phase 5 — one canonical LEAD_SUBMITTED event, no second emitter", () => {
  it("leads/service.ts emits it exactly once and keeps no direct onLeadSubmitted call", () => {
    const code = strip(read("server/leads/service.ts"));
    const emits = code.match(/buildLeadSubmittedEvent\(/g) ?? [];
    expect(emits).toHaveLength(1);
    expect(code).not.toMatch(/\bonLeadSubmitted\b/);
  });
  it("no OTHER server file emits a LEAD_SUBMITTED BusinessEvent", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return walk(p);
        return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
      });
    const offenders = walk(join(root, "server"))
      .filter((p) => !p.replace(/\\/g, "/").endsWith("server/leads/service.ts"))
      .filter((p) => !p.replace(/\\/g, "/").endsWith("server/events/adapters/lead-submitted.ts"))
      .filter((p) => /buildLeadSubmittedEvent\(/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("follow-ups + office-tv route remain untouched by the bridge", () => {
    expect(strip(read("server/followups/service.ts"))).not.toMatch(
      /emitBusinessEvent|recognition-bridge|celebration-level|BusinessEvent|awardScored/,
    );
    for (const spec of importsOf(read("routes/office-tv.tsx"))) {
      expect(/events\/|scoring\/|celebration-level|recognition-bridge/.test(spec)).toBe(false);
    }
  });
});

describe("Phase 5 — the recognition BRIDGE added no migration", () => {
  it("no recognition / business_event migration exists; the only celebration one is Phase 10's additive profiles table", () => {
    const files = readdirSync(join(root, "..", "drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    // Phase 5 added nothing (recognition is transient metadata on the bus).
    // Phase 10 adds ONE additive table for admin-authored celebration profiles.
    expect(files.some((f) => /recognition|business_event/i.test(f))).toBe(false);
    expect(files.filter((f) => /celebration/i.test(f))).toEqual(["0019_celebration_profiles.sql"]);
  });
  it("the bridge still awards nothing — profiles only change PRESENTATION", () => {
    const src = strip(read("server/events/recognition-bridge.ts"));
    expect(src).not.toMatch(/evaluateScoring|awardScored|awardEvent|\bingest\(/);
    // the profile lookup is null-safe: the default decideCelebration() path stays
    expect(src).toMatch(/pickCelebrationProfileForTrigger/);
    expect(src).toMatch(/decideCelebration\(/);
  });
});
