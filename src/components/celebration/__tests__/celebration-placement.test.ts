/**
 * Phase 6 — architectural guards for the cinematic celebration engine.
 *
 * ONLY the presentation layer changed. This test pins that boundary:
 *   - the celebration components never score, mutate, fetch business data,
 *     open a socket, or import the CRM / scoring / events / HR layers
 *   - data flow is ONE-WAY: payload -> scene -> visuals
 *   - every timer / rAF / listener is cleaned up on unmount (no leak over a
 *     long-running Office TV session)
 *   - office-tv still polls + queues one celebration at a time (queue intact)
 *   - tv-service gained NO scoring / HR / payroll import
 *   - NO new migration, NO new event bus / websocket / celebration table
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = join(__dirname, "..", "..", "..");
const repoRoot = join(srcRoot, "..");
const read = (rel: string) => readFileSync(join(srcRoot, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const importsOf = (code: string) =>
  [...code.matchAll(/(?:import|export)[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]!);

const CELEB_DIR = join(srcRoot, "components", "celebration");
const celebFiles = readdirSync(CELEB_DIR)
  .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.endsWith(".test.ts"))
  .map((f) => `components/celebration/${f}`);

describe("Phase 6 — the celebration layer is presentation-only", () => {
  it("has the expected file set (visuals + audio-profiles model + 5 view components + audio hook)", () => {
    expect(celebFiles.sort()).toEqual(
      [
        "components/celebration/CelebrationLightBurst.tsx",
        "components/celebration/CelebrationParticles.tsx",
        "components/celebration/CelebrationPhoto.tsx",
        "components/celebration/CelebrationScene.tsx",
        "components/celebration/CelebrationText.tsx",
        "components/celebration/celebration-audio-profiles.ts",
        "components/celebration/celebration-visuals.ts",
        "components/celebration/useCelebrationAudio.ts",
      ].sort(),
    );
  });

  for (const f of celebFiles) {
    const src = strip(read(f));

    it(`${f} imports nothing from scoring / events / db / hr / payroll / gamification / leads`, () => {
      for (const spec of importsOf(src)) {
        expect(
          /(^|\/)(scoring|events|db|hr|payroll|gamification|leads|server)\//.test(spec) ||
            /scoring|business-event|dispatcher|recognition-bridge|awardScored/.test(spec),
          `${f} imports "${spec}"`,
        ).toBe(false);
      }
    });

    it(`${f} never scores, mutates, or reaches the network / a socket`, () => {
      expect(src).not.toMatch(
        /awardScored|awardEvent|evaluateScoring|scoring\.ingest|resolveOutcome/,
      );
      expect(src).not.toMatch(
        /emitBusinessEvent|buildLeadSubmittedEvent|recognizeFromBusinessEvent/,
      );
      expect(src).not.toMatch(/\bfetch\s*\(|new WebSocket|EventSource|XMLHttpRequest|axios/);
      // no new persistence / bus / queue of its own
      expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/);
      expect(src).not.toMatch(/new Worker|BroadcastChannel/);
    });

    it(`${f} keeps data flow ONE-WAY (no point arithmetic on the payload in the view)`, () => {
      // the renderer receives `points` and displays it — it must not branch on
      // a debt / amount threshold or a specific employee id
      expect(src).not.toMatch(/debt|amount\s*[<>]=|points\s*=\s*\d{2,}/i);
      expect(src).not.toMatch(/userId\s*===\s*\d|employee\s*===/i);
    });
  }
});

describe("Phase 6 — animation / timer / listener cleanup (no leak over hours)", () => {
  for (const f of [
    "components/celebration/CelebrationScene.tsx",
    "components/celebration/CelebrationParticles.tsx",
    "components/celebration/useCelebrationAudio.ts",
  ]) {
    it(`${f} every useEffect returns a cleanup function`, () => {
      const src = strip(read(f));
      const effects = src.match(/useEffect\(/g) ?? [];
      const cleanups = src.match(/return\s*\(\s*\)\s*=>/g) ?? [];
      expect(effects.length).toBeGreaterThan(0);
      expect(cleanups.length).toBeGreaterThanOrEqual(effects.length);
    });
  }

  it("CelebrationScene cancels its rAF + safety timeout and guards onDone once", () => {
    const src = strip(read("components/celebration/CelebrationScene.tsx"));
    expect(src).toMatch(/cancelAnimationFrame\(/);
    expect(src).toMatch(/clearTimeout\(/);
    expect(src).toMatch(/doneRef\.current/); // fires onDone at most once
    expect(src).toMatch(/let stopped = false/); // rAF loop self-terminates
    expect(src).toMatch(/phaseAt\(t, tl\) === "done"/); // loop has an end condition
  });

  it("CelebrationParticles removes its resize listener, cancels rAF, drops particles", () => {
    const src = strip(read("components/celebration/CelebrationParticles.tsx"));
    expect(src).toMatch(/window\.addEventListener\("resize", resize\)/);
    expect(src).toMatch(/window\.removeEventListener\("resize", resize\)/);
    expect(src).toMatch(/cancelAnimationFrame\(raf\)/);
    expect(src).toMatch(/particles\.length = 0/);
    // the loop terminates itself once nothing is left and spawning stopped
    expect(src).toMatch(/particles\.length === 0 && !spawning/);
    // and particles can never outlive the scene
    expect(src).toMatch(/elapsed > durationMs/);
  });

  it("useCelebrationAudio is fully guarded and never throws when audio is blocked", () => {
    const src = strip(read("components/celebration/useCelebrationAudio.ts"));
    expect(src).toMatch(/getAudioCtor\(\)/);
    expect(src).toMatch(/if \(!Ctor\) return/);
    expect(src).toMatch(/catch\s*\{/); // playback wrapped
    expect(src).toMatch(/\.catch\(\(\) => undefined\)/); // resume() rejection swallowed
    expect(src).toMatch(/clearTimeout\(t\)/);
    // no bundled / downloaded audio asset
    expect(src).not.toMatch(/\.mp3|\.wav|\.ogg|new Audio\(|<audio/);
  });

  it("CelebrationLightBurst is pure CSS — no JS timer / rAF at all", () => {
    const src = strip(read("components/celebration/CelebrationLightBurst.tsx"));
    expect(src).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|useEffect/);
  });
});

describe("Phase 6 — Office TV route: polling + single-celebration queue intact", () => {
  const src = strip(read("routes/office-tv.tsx"));

  it("still polls GET /api/office-tv/state on an interval", () => {
    expect(src).toMatch(/\/api\/office-tv\/state/);
    expect(src).toMatch(/setInterval\(/);
    expect(src).toMatch(/POLL_MS/);
  });

  it("keeps the client-side queue and plays ONE celebration at a time", () => {
    expect(src).toMatch(/queueRef/);
    expect(src).toMatch(/queueRef\.current\.push\(/);
    expect(src).toMatch(/queueRef\.current\.shift\(\)/);
    // the driver only starts a new one when nothing is currently playing
    expect(src).toMatch(/if \(current \|\| queueRef\.current\.length === 0\) return/);
  });

  it("has a hard safety cap so a broken scene can never wedge the TV", () => {
    expect(src).toMatch(/playTimerRef/);
    expect(src).toMatch(/setTimeout\(\(\) => setCurrent\(null\)/);
  });

  it("delegates all celebration visuals to CelebrationScene and never scores", () => {
    expect(src).toMatch(/from "@\/components\/celebration\/CelebrationScene"/);
    expect(src).not.toMatch(/awardScored|emitBusinessEvent|evaluateScoring|scoring\//);
    for (const spec of importsOf(src)) {
      expect(
        /events\/|scoring\/|celebration-level|recognition-bridge/.test(spec),
        `office-tv imports "${spec}"`,
      ).toBe(false);
    }
  });
});

describe("Phase 6 — tv-service: only a minimal photo-delivery compatibility change", () => {
  const src = strip(read("server/live/tv-service.ts"));

  it("gained NO scoring / events / HR / payroll / gamification-award import", () => {
    for (const spec of importsOf(src)) {
      expect(
        /(^|\/)(scoring|events)\//.test(spec) ||
          /business-event|dispatcher|recognition-bridge|awardScored/.test(spec),
        `tv-service imports "${spec}"`,
      ).toBe(false);
    }
  });

  it("delivers the subject photo through the EXISTING token-authed photo path", () => {
    expect(src).toMatch(/photosFor\(/); // reuses the existing helper
    expect(src).toMatch(/subject: \{ \.\.\.d\.subject, photo: photos\[uid\] \?\? null \}/);
    // never embeds raw bytes in the event
    expect(src).not.toMatch(/toString\("base64"\)[\s\S]{0,40}subject/);
  });

  it("still returns the recognition bus items (no new bus / queue introduced)", () => {
    expect(src).toMatch(/recognitionBus\.since\(/);
    expect(src).not.toMatch(/new EventEmitter|new WebSocketServer|createServer\(/);
  });
});

describe("Phase 6 — the celebration RENDERER added no migration of its own", () => {
  it("the only celebration-domain migration is Phase 10's additive celebration_profiles", () => {
    const files = readdirSync(join(repoRoot, "drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    // Phase 6 added nothing; Phase 10 (Recognition Command Center) adds ONE
    // additive table for admin-authored profiles — no `recognition` /
    // `office_tv_event` migration exists.
    expect(files.filter((f) => /celebration/i.test(f))).toEqual(["0019_celebration_profiles.sql"]);
    expect(files.some((f) => /recognition|office_tv_event/i.test(f))).toBe(false);
    const sql = readFileSync(join(repoRoot, "drizzle", "0019_celebration_profiles.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\b|\bTRUNCATE\b|DELETE FROM|MODIFY COLUMN|RENAME COLUMN/i);
    expect([...sql.matchAll(/CREATE TABLE `([^`]+)`/g)].map((m) => m[1])).toEqual([
      "celebration_profiles",
    ]);
  });

  it("the RENDERER components still declare no table (profiles live server-side)", () => {
    const schema = read("lib/db/schema.ts");
    // a bare `celebrations` table would mean the renderer persists state — that
    // must never happen; `celebration_profiles` (Phase 10 ops config) is fine.
    expect(schema).not.toMatch(/mysqlTable\(\s*["']celebrations["']/i);
    for (const f of celebFiles) expect(strip(read(f))).not.toMatch(/mysqlTable\(|drizzle-orm/);
  });
});
