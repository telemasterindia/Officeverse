/**
 * Phase 10 Stage 4 — MILESTONE ENGINE architecture guards.
 *
 *   BUSINESS EVENT → SCORING → LEDGER → [ MILESTONE ENGINE ] → RECOGNITION
 *                  → CELEBRATION / ANNOUNCEMENT → OFFICE TV
 *
 * The Milestone Engine is a RECOGNITION consumer. It must NOT: score, award
 * points, re-rank, import CRM / scoring-evaluator / payroll / incentive code,
 * or fabricate a person for a team milestone. Its migration (0021) is purely
 * additive. Every mutation + automatic trigger is audited.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const importsOf = (code: string) =>
  [...code.matchAll(/(?:import|export)[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]!);

const FILES = [
  "server/milestones/milestone-model.ts",
  "server/milestones/milestone-eval.ts",
  "server/milestones/milestone-service.ts",
  "server/db/repos/milestones.ts",
];

describe("Phase 10 Stage 4 — the Milestone Engine stays in its lane", () => {
  for (const f of FILES) {
    const src = strip(read(f));
    it(`${f} imports no CRM / scoring-evaluator / payroll / incentive code`, () => {
      for (const spec of importsOf(src)) {
        expect(
          /leads\/service|followups\/service|(^|\/)hr\/|payroll|salary|regularity|attendance/.test(
            spec,
          ) ||
            /scoring\/(ingest|evaluate|conditions|operators|dry-run|modes)/.test(spec) ||
            /(^|\/)incentive\/|commission/.test(spec) ||
            /events\/(business-event|dispatcher|adapters)/.test(spec),
          `${f} imports "${spec}"`,
        ).toBe(false);
      }
    });
    it(`${f} never awards points / recomputes a score / writes the ledger`, () => {
      expect(src).not.toMatch(
        /awardScored|awardEvent|emitBusinessEvent|evaluateScoring|insertPointTransaction/,
      );
      // it may READ the ledger (SUM/COUNT) but never WRITE it
      expect(src).not.toMatch(/\.insert\(\s*gamificationPointTransactions/);
      expect(src).not.toMatch(/userId\s*===\s*\d{2,}/);
    });
  }

  it("the eval CORE compares against the configured threshold, never a literal", () => {
    const evalSrc = strip(read("server/milestones/milestone-eval.ts"));
    // the crossing decision reads i.threshold / i.actualValue — no numeric literal
    expect(evalSrc).toMatch(/i\.actualValue >= i\.threshold/);
    expect(evalSrc).not.toMatch(/actualValue >= \d|value >= \d{2,}/);
    const svc = strip(read("server/milestones/milestone-service.ts"));
    expect(svc).toMatch(/value < m\.threshold/); // the fired gate uses the config field
    expect(svc).not.toMatch(/value >= \d{2,}|>= 100\b|>= 5000\b/);
  });

  it("model + eval are PURE (no DB, no I/O)", () => {
    for (const f of [
      "server/milestones/milestone-model.ts",
      "server/milestones/milestone-eval.ts",
    ]) {
      const specs = importsOf(strip(read(f)));
      for (const s of specs) {
        expect(/db|repos|@\/lib\/db|audit|http-error|live\//.test(s), `${f} imports "${s}"`).toBe(
          false,
        );
      }
    }
  });

  it("the engine READS the authoritative ledger — SUM / COUNT only, never a recompute", () => {
    const repo = strip(read("server/db/repos/milestones.ts"));
    expect(repo).toMatch(/coalesce\(sum\(|count\(\*\)/i);
    expect(repo).toMatch(/status["']?,\s*["']ACTIVE["']|status, "ACTIVE"/);
    const svc = strip(read("server/milestones/milestone-service.ts"));
    // milestones NEVER award points
    expect(svc).toMatch(/awardedPoints:\s*false/);
    expect(svc).not.toMatch(/awardScored|insertPointTransaction/);
  });

  it("a team milestone carries NO subject (never a fabricated person)", () => {
    const evalSrc = strip(read("server/milestones/milestone-eval.ts"));
    expect(evalSrc).toMatch(/isTeam \? null :/); // subject id is nulled for team
    const svc = strip(read("server/milestones/milestone-service.ts"));
    expect(svc).toMatch(/userId:\s*team \? null :/);
  });

  it("idempotency — a deterministic dedupe key + a unique index block a retry", () => {
    const evalSrc = strip(read("server/milestones/milestone-eval.ts"));
    expect(evalSrc).toMatch(/milestone:\$\{i\.milestoneId\}/);
    expect(read("lib/db/schema.ts")).toMatch(/milestone_triggers_dedupe_uq/);
    const repo = strip(read("server/db/repos/milestones.ts"));
    expect(repo).toMatch(/firedKeysForMilestone/); // the eval core is fed the fired set
  });

  it("the recognition bridge triggers milestone evaluation AFTER the base celebration", () => {
    const src = strip(read("server/events/recognition-bridge.ts"));
    expect(src).toMatch(/evaluateMilestonesForEvent/);
    expect(src).toMatch(/await runMilestones\(\)/);
    // still awards nothing itself
    expect(src).not.toMatch(/awardScored|awardEvent|evaluateScoring|\bingest\(/);
  });

  it("milestone recognition reuses the EXISTING recognition path (no 2nd TV mechanism)", () => {
    const svc = strip(read("server/milestones/milestone-service.ts"));
    expect(svc).toMatch(/recognizeMilestone\(/);
    expect(svc).not.toMatch(/new EventEmitter|recognitionBus\.publish\(|insertTvEvent/);
    // celebration uses the Stage-1 profile payload builder
    expect(svc).toMatch(/celebrationPayloadForProfileId\(/);
    // announcement uses the Stage-2 path
    expect(svc).toMatch(/fireMilestoneAnnouncement\(/);
  });

  it("every mutation + automatic trigger is audited (actor from server session / 'system')", () => {
    const svc = read("server/milestones/milestone-service.ts");
    for (const a of [
      "MILESTONE_CREATED",
      "MILESTONE_UPDATED",
      "MILESTONE_ENABLED",
      "MILESTONE_DISABLED",
      "MILESTONE_TRIGGERED",
      "MILESTONE_SIMULATED",
    ]) {
      expect(svc, `records ${a}`).toContain(a);
    }
    // an automatic trigger records the source event + actor "system"
    expect(strip(read("server/milestones/milestone-service.ts"))).toMatch(
      /actorRole:\s*"system"[\s\S]{0,400}source:\s*\{\s*type:\s*ctx\.source\.type/,
    );
  });

  it("migration 0021 is purely additive — CREATE only, no DROP / TRUNCATE / column change", () => {
    const files = readdirSync(join(root, "..", "drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const mig = files.find((f) => /milestone/i.test(f));
    expect(mig).toBe("0021_milestones.sql");
    const sql = readFileSync(join(root, "..", "drizzle", mig!), "utf8");
    expect(sql).not.toMatch(/\bDROP\b|\bTRUNCATE\b|DELETE FROM|MODIFY COLUMN|RENAME COLUMN/i);
    expect([...sql.matchAll(/CREATE TABLE `([^`]+)`/g)].map((m) => m[1]).sort()).toEqual([
      "milestone_triggers",
      "milestones",
    ]);
  });

  it("no milestone table redefines an existing one; nothing is seeded", () => {
    const schema = read("lib/db/schema.ts");
    for (const t of ["milestones", "milestone_triggers"])
      expect(schema).toMatch(new RegExp(`mysqlTable\\(\\s*["']${t}["']`));
    for (const f of FILES) {
      const src = strip(read(f));
      expect(src).not.toMatch(/seedMilestone|DEFAULT_MILESTONES|"10 Lead Acceptances"/);
    }
  });

  it("Office TV / kiosk security is untouched by Stage 4", () => {
    for (const f of FILES)
      expect(strip(read(f))).not.toMatch(/verifyDisplayToken|PUBLIC_PATHS|office-tv|tv_read/);
  });
});
