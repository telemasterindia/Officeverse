/**
 * Phase 8 — Performance Intelligence architecture guards.
 *
 * A READ-ONLY visibility layer over the EXISTING point ledger. It never awards,
 * recomputes, or duplicates scoring; imports no CRM / HR / payroll code; adds no
 * table / migration; and does not touch the Office TV boundary.
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
  "server/gamification/performance.ts",
  "lib/officeverse/performance-fns.ts",
  "routes/_shell.performance.tsx",
];

describe("Phase 8 — performance layer stays in its lane", () => {
  for (const f of FILES) {
    const src = strip(read(f));
    it(`${f} imports no CRM / HR / payroll / scoring-evaluator code`, () => {
      for (const spec of importsOf(src)) {
        expect(
          /leads\/service|followups\/service|(^|\/)hr\/|payroll|salary|regularity|attendance/.test(
            spec,
          ) ||
            /scoring\/(ingest|evaluate|conditions|operators|dry-run)/.test(spec) ||
            /events\/(business-event|dispatcher|emit)/.test(spec),
          `${f} imports "${spec}"`,
        ).toBe(false);
      }
    });
    it(`${f} never awards / recomputes points and hard-codes no business value`, () => {
      expect(src).not.toMatch(
        /awardScored|awardEvent|emitBusinessEvent|evaluateScoring|insertPointTransaction/,
      );
      // no fabricated point/threshold/incentive math
      expect(src).not.toMatch(
        /points\s*=\s*\d{2,}|debt\s*[<>]=|threshold\s*=\s*\d|incentive\s*=\s*\d/i,
      );
      // no hard-coded employee / closer ids
      expect(src).not.toMatch(/userId\s*===\s*\d{2,}|closerId\s*===\s*\d/);
    });
  }

  it("the service AGGREGATES the ledger — sum/count only, never a per-event value table", () => {
    const src = strip(read("server/gamification/performance.ts"));
    expect(src).toMatch(
      /repo\.(performanceAggregate|eventBreakdown|ruleBreakdown|userLedger|sumActivePoints)/,
    );
    // reuses the existing pure ranking + windows
    expect(src).toMatch(/rankLeaderboard/);
    expect(src).toMatch(/windowBounds|customWindow/);
    // operational-date only — no createdAt / browser clock as the scoring date
    expect(src).not.toMatch(/Date\.now\(\)|new Date\(\)\.toISOString|createdAt.*window/);
  });

  it("incentive readiness is a READ MODEL — no incentive value / eligibility computed", () => {
    const src = read("server/gamification/performance.ts");
    expect(src).toMatch(/incentiveReadySnapshot/);
    expect(src).not.toMatch(/incentiveAmount|eligible\s*=|payout|bonusAmount/);
  });

  it("the /performance route is gated to admin + closer via RoleGate", () => {
    expect(read("routes/_shell.performance.tsx")).toMatch(/RoleGate allow={\["admin", "closer"\]}/);
  });

  it("Office TV + display-token security untouched by Phase 8", () => {
    for (const f of FILES)
      expect(strip(read(f))).not.toMatch(/verifyDisplayToken|tv_read|office-tv/i);
  });

  it("Phase 8 added no migration / leaderboard table (aggregates the existing ledger)", () => {
    const sql = readdirSync(join(root, "..", "drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(sql.some((f) => /leaderboard|performance/i.test(f))).toBe(false);
    expect(read("lib/db/schema.ts")).not.toMatch(
      /mysqlTable\(\s*["'](leaderboards?|performance_)/i,
    );
  });

  it("existing gamification/leaderboard primitives are unchanged in signature", () => {
    const src = read("server/gamification/leaderboard.ts");
    expect(src).toMatch(
      /export function rankLeaderboard\(rows: LeaderboardInputRow\[\]\): LeaderboardRow\[\]/,
    );
    expect(src).toMatch(
      /export function windowBounds\(kind: LeaderboardKind, operationalDate: string\)/,
    );
    // additive only
    expect(src).toMatch(/export function customWindow\(from: string, to: string\)/);
  });
});
