/**
 * Phase 9 — INCENTIVE ENGINE architecture guards.
 *
 *   CRM EVENT → SCORING ENGINE → POINT LEDGER → PERFORMANCE/LEADERBOARD
 *             → [ INCENTIVE ENGINE ] → INCENTIVE RESULT
 *
 * The Incentive Engine is a CONSUMER of the Phase-8 snapshot. It must NOT:
 *   - re-implement scoring (no rule→points math, no scoring ingest/evaluate import)
 *   - award points / emit a business event / write the ledger
 *   - touch CRM lead/follow-up services, HR, payroll or salary
 *   - process a payment (calculated ≠ paid)
 *   - touch the Office TV display-token boundary
 * Its migration (0018) is purely additive — no DROP / TRUNCATE / column change.
 * Every mutation is audited through the whitelisted OPERATIONS_AUDIT_ACTIONS.
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
  "server/incentive/conditions.ts",
  "server/incentive/reward.ts",
  "server/incentive/evaluator.ts",
  "server/incentive/service.ts",
  "server/db/repos/incentive.ts",
  "lib/officeverse/incentive-fns.ts",
];

describe("Phase 9 — the Incentive Engine stays in its lane", () => {
  for (const f of FILES) {
    const src = strip(read(f));

    it(`${f} imports no CRM / HR / payroll / scoring-evaluator code`, () => {
      for (const spec of importsOf(src)) {
        expect(
          /leads\/service|followups\/service|(^|\/)hr\/|payroll|salary|regularity|attendance/.test(
            spec,
          ) ||
            /scoring\/(ingest|evaluate|conditions|operators|dry-run|modes|award)/.test(spec) ||
            /events\/(business-event|dispatcher|emit|adapters)/.test(spec) ||
            /office-tv|display-token/.test(spec),
          `${f} imports "${spec}"`,
        ).toBe(false);
      }
    });

    it(`${f} never scores / awards points and hard-codes no business value`, () => {
      expect(src).not.toMatch(
        /awardScored|awardEvent|emitBusinessEvent|dispatchBusinessEvent|evaluateScoring|insertPointTransaction|gamification_point_transactions/,
      );
      // no re-implemented scoring math (e.g. `if debtAmount >= 20000 then points = 200`)
      expect(src).not.toMatch(/debt\w*\s*[<>]=?\s*\d|points\s*=\s*\d{2,}|score\s*\+=/i);
      // no hard-coded employee / closer ids
      expect(src).not.toMatch(/userId\s*===\s*\d{2,}|closerId\s*===\s*\d/);
    });
  }

  it("the evaluator is PURE — no DB, no audit, no I/O", () => {
    const specs = importsOf(strip(read("server/incentive/evaluator.ts")));
    expect(specs.every((s) => s.startsWith("./"))).toBe(true);
    for (const dep of ["conditions", "reward"]) expect(specs).toContain(`./${dep}`);
  });

  it("conditions + reward are PURE (only import each other)", () => {
    expect(importsOf(strip(read("server/incentive/conditions.ts")))).toEqual([]);
    expect(importsOf(strip(read("server/incentive/reward.ts")))).toEqual(["./conditions"]);
  });

  it("the SAME evaluator backs dry-run and live calculation (no second code path)", () => {
    const src = strip(read("server/incentive/service.ts"));
    expect(src).toMatch(/import\s*\{[^}]*\bevaluateScheme\b[^}]*\}\s*from\s*["']\.\/evaluator["']/);
    // dry-run must NOT persist a result
    const dry = src.slice(
      src.indexOf("export async function dryRunIncentive"),
      src.indexOf("export interface CalculateInput"),
    );
    expect(dry).toMatch(/evaluateScheme/);
    expect(dry).not.toMatch(/repo\.insertResult|repo\.updateResult/);
  });

  it("the service CONSUMES the Phase-8 snapshot — it does not rebuild it", () => {
    const src = strip(read("server/incentive/service.ts"));
    expect(src).toMatch(/buildIncentiveSnapshotRows/);
    expect(src).toMatch(/from\s*["']\.\.\/gamification\/performance["']/);
    // version selection reuses the scoring-rule helper, not a private copy
    expect(src).toMatch(/selectVersionForDate/);
  });

  it("every incentive mutation is audited through a whitelisted action", () => {
    const src = read("server/incentive/service.ts");
    const authz = read("server/authz/operations.ts");
    const required = [
      "INCENTIVE_SCHEME_CREATED",
      "INCENTIVE_SCHEME_UPDATED",
      "INCENTIVE_SCHEME_ENABLED",
      "INCENTIVE_SCHEME_DISABLED",
      "INCENTIVE_CALCULATION_RUN",
      "INCENTIVE_RESULT_RECALCULATED",
      "INCENTIVE_RESULT_REVIEWED",
      "INCENTIVE_RESULT_APPROVED",
      "INCENTIVE_RESULT_FINALIZED",
      "INCENTIVE_RESULT_REVERSED",
    ];
    for (const a of required) {
      expect(src, `service records ${a}`).toContain(a);
      expect(authz, `OPERATIONS_AUDIT_ACTIONS whitelists ${a}`).toContain(a);
    }
    // the actor is always the server session, never taken from the client payload
    expect(strip(read("lib/officeverse/incentive-fns.ts"))).not.toMatch(
      /data\.(actorUserId|actorRole|role)\b/,
    );
  });

  it("approve / finalize / reverse is Admin-only; review is Ops", () => {
    const authz = read("server/authz/operations.ts");
    expect(authz).toMatch(
      /export function canFinalizeIncentive\(role: string\): boolean \{\s*return role === "admin";/,
    );
    const svc = strip(read("server/incentive/service.ts"));
    expect(svc).toMatch(/to === "REVIEWED"\)\s*assertCanRunOperations/);
    expect(svc).toMatch(/else\s*assertCanFinalizeIncentive/);
  });

  it("calculated ≠ paid — no payroll / payment write anywhere in the engine", () => {
    for (const f of FILES)
      expect(strip(read(f))).not.toMatch(
        /payslip|salary_slip|payroll_run|disburse|payout\(|makePayment|creditSalary/i,
      );
  });

  it("Office TV + display-token security untouched by Phase 9", () => {
    for (const f of FILES)
      expect(strip(read(f))).not.toMatch(/verifyDisplayToken|tv_read|office-tv|recognitionBus/i);
  });

  it("migration 0018 is purely additive — CREATE only, no DROP / TRUNCATE / column change", () => {
    const files = readdirSync(join(root, "..", "drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const mig = files.find((f) => /incentive/i.test(f));
    expect(mig).toBe("0018_incentive_engine.sql");
    const sql = readFileSync(join(root, "..", "drizzle", mig!), "utf8");
    expect(sql).not.toMatch(/\bDROP\b|\bTRUNCATE\b|DELETE FROM|MODIFY COLUMN|RENAME COLUMN/i);
    // only the three additive tables
    const created = [...sql.matchAll(/CREATE TABLE `([^`]+)`/g)].map((m) => m[1]);
    expect(created.sort()).toEqual([
      "incentive_results",
      "incentive_scheme_versions",
      "incentive_schemes",
    ]);
    // 0018 is the incentive migration and was never clobbered by a later generate
    // (a later phase may add its own higher-numbered migration — that's fine).
    expect(files.indexOf("0018_incentive_engine.sql")).toBeGreaterThanOrEqual(0);
  });

  it("the incentive tables are additive in the schema — no existing table redefined", () => {
    const schema = read("lib/db/schema.ts");
    for (const t of ["incentive_schemes", "incentive_scheme_versions", "incentive_results"])
      expect(schema).toMatch(new RegExp(`mysqlTable\\(\\s*["']${t}["']`));
    // no hard-coded / seeded scheme rows
    expect(schema).not.toMatch(/High Performer|Power Hour Bonus|seedIncentive/i);
  });

  it("no scheme is seeded / hard-coded anywhere in the engine", () => {
    for (const f of FILES) {
      const src = strip(read(f));
      expect(src).not.toMatch(/tiers:\s*\[\s*\{\s*min:\s*5000/); // the spec's EXAMPLE tiers must never be embedded
      expect(src).not.toMatch(/seedScheme|DEFAULT_SCHEME|BUILT_IN_SCHEMES/);
    }
  });
});
