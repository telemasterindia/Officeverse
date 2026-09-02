import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const importsOf = (code: string) =>
  [...code.matchAll(/(?:import|export)[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]!);

const ENGINE_FILES = [
  "server/events/business-event.ts",
  "server/events/dispatcher.ts",
  "server/events/emit.ts",
  "server/events/adapters/lead-submitted.ts",
  "server/scoring/events.ts",
  "server/scoring/fields.ts",
  "server/scoring/operators.ts",
  "server/scoring/conditions.ts",
  "server/scoring/modes.ts",
  "server/scoring/versions.ts",
  "server/scoring/service.ts",
  "server/scoring/ingest.ts",
  "server/scoring/dry-run.ts",
  "server/scoring/flags.ts",
  "server/db/repos/scoring.ts",
];

describe("scoring engine — SEPARATION from CRM workflows", () => {
  it("no engine file imports leads / follow-ups / assignments / HR / payroll code", () => {
    for (const f of ENGINE_FILES) {
      for (const spec of importsOf(stripComments(read(f)))) {
        expect(
          /(^|\/)(leads|followups|assignments|hr|payroll)(\/|$)|leads\/service|followups\/service|salary|regularity|incentive|commission/i.test(
            spec,
          ),
          `${f} must not import "${spec}"`,
        ).toBe(false);
      }
    }
  });

  it("no engine file imports the recognition / Office-TV implementation (live/*)", () => {
    for (const f of ENGINE_FILES) {
      for (const spec of importsOf(stripComments(read(f)))) {
        expect(/(^|\/)live\//.test(spec) || /office-tv/i.test(spec), `${f} imports "${spec}"`).toBe(
          false,
        );
      }
    }
  });

  it("the engine only APPENDS to the ledger — it never updates/deletes point rows", () => {
    for (const f of [
      "server/scoring/ingest.ts",
      "server/scoring/service.ts",
      "server/db/repos/scoring.ts",
    ]) {
      const code = stripComments(read(f));
      expect(code).not.toMatch(/gamificationPointTransactions[\s\S]{0,40}\.(update|delete)\(/);
      expect(code).not.toMatch(/update\(\s*gamificationPointTransactions/);
    }
  });

  it("no currency / money identifier anywhere in the engine", () => {
    for (const f of ENGINE_FILES) {
      expect(stripComments(read(f)), f).not.toMatch(/₹|\$\d|\bUSD\b|\bINR\b|salarySlip|payrollRun/);
    }
  });
});

describe("scoring engine — CRM / recognition code is not reached by scoring", () => {
  // leads/service.ts is intentionally NOT here: Phase 4 lets it emit a
  // BusinessEvent (see the "Phase 4" block below).
  const PROTECTED = [
    "server/followups/service.ts",
    "server/db/repos/leads.ts",
    "server/db/repos/followups.ts",
    "server/live/recognition.ts",
    "server/live/bus.ts",
    "server/live/orchestrator.ts",
    "routes/office-tv.tsx",
  ];

  it("no protected CRM / recognition / Office-TV file imports the scoring engine", () => {
    for (const f of PROTECTED) {
      const code = stripComments(read(f));
      for (const spec of importsOf(code)) {
        expect(
          /scoring\/|events\/business-event|events\/dispatcher|events\/emit|events\/adapters/.test(
            spec,
          ),
          `${f} must not import "${spec}"`,
        ).toBe(false);
      }
      expect(code).not.toMatch(
        /emitBusinessEvent|dispatchBusinessEvent|scoring\.ingest|awardScored/,
      );
    }
  });

  it("follow-up service still wires no scoring / recognition", () => {
    const code = stripComments(read("server/followups/service.ts"));
    expect(code).not.toMatch(
      /awardEvent|awardScored|emitBusinessEvent|scoring\/|recognizeSafe|buildCelebration/,
    );
  });
});

describe("scoring engine — no seeded business scoring values", () => {
  it("no engine file hard-codes example point values (100 / 60 / 15 / 50 / 500 …)", () => {
    for (const f of ENGINE_FILES) {
      const code = stripComments(read(f));
      // the only bare numeric literals allowed are structural (scale, limits, depth…)
      for (const m of code.matchAll(/points:\s*(-?\d+)/g)) {
        expect(["0"], `${f} has points: ${m[1]}`).toContain(m[1]);
      }
    }
  });
});

describe("scoring engine — migration 0014 is additive-only", () => {
  const sql = read("../drizzle/0014_scoring_engine_foundation.sql");

  it("creates the three scoring tables", () => {
    expect(sql).toMatch(/CREATE TABLE `scoring_rules`/);
    expect(sql).toMatch(/CREATE TABLE `scoring_rule_versions`/);
    expect(sql).toMatch(/CREATE TABLE `scoring_runs`/);
  });
  it("adds five nullable columns to the ledger and widens `event` to varchar", () => {
    expect(sql).toMatch(/ADD `rule_id`/);
    expect(sql).toMatch(/ADD `rule_version`/);
    expect(sql).toMatch(/ADD `rule_name`/);
    expect(sql).toMatch(/ADD `context`/);
    expect(sql).toMatch(/ADD `score_run_id`/);
    expect(sql).toMatch(/MODIFY COLUMN `event` varchar\(64\)/);
  });
  it("contains NO destructive statement (FK ON DELETE actions don't count)", () => {
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|DATABASE|INDEX)/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/\bRESET\b/i);
  });
  it("does not touch migrations 0000–0013", () => {
    const files = readdirSync(join(root, "..", "drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files).toContain("0014_scoring_engine_foundation.sql");
    // every pre-scoring migration is still present and un-renumbered
    for (let i = 0; i <= 13; i++) {
      const p = String(i).padStart(4, "0");
      expect(files.some((f) => f.startsWith(`${p}_`))).toBe(true);
    }
    // 0014 was never clobbered by a later `drizzle-kit generate`
    expect(files.filter((f) => f.startsWith("0014_"))).toEqual([
      "0014_scoring_engine_foundation.sql",
    ]);
  });
});

/* ---------------------------- Phase 3: Admin console ---------------------------- */

describe("scoring console (Phase 3) — Admin only, no CRM / recognition reach", () => {
  const CONSOLE_FILES = [
    "lib/officeverse/scoring-fns.ts",
    "lib/officeverse/use-scoring.ts",
    "lib/officeverse/scoring-ui.ts",
    "routes/_shell.scoring.tsx",
    "components/officeverse/scoring/rule-builder.tsx",
    "components/officeverse/scoring/condition-builder.tsx",
    "components/officeverse/scoring/dry-run-panel.tsx",
    "components/officeverse/scoring/history-panel.tsx",
  ];

  it("every scoring server function requires an Operations role (Phase 6.5: admin + closer)", () => {
    const code = read("lib/officeverse/scoring-fns.ts");
    const handlers = code.split(/export const \w+Fn/).slice(1);
    expect(handlers.length).toBe(7);
    // Phase 6.5 — the Closer is the Operations Manager and manages incentive /
    // scoring RULE DEFINITIONS through the business UI. No other role is added;
    // editing historical point transactions stays on authz/gamification.
    for (const h of handlers) expect(h).toMatch(/requireRole\("admin", "closer"\)/);
  });

  it("no console file wires the CRM / recognition or flips the live flag", () => {
    for (const f of CONSOLE_FILES) {
      const code = stripComments(read(f));
      expect(code, f).not.toMatch(
        /emitBusinessEvent|dispatchBusinessEvent|recognizeSafe|buildCelebration|SCORING_ENGINE_ENABLED\s*=/,
      );
      for (const spec of importsOf(code)) {
        expect(
          /(^|\/)live\//.test(spec) || /leads\/service|followups\/service/.test(spec),
          `${f} imports ${spec}`,
        ).toBe(false);
      }
    }
  });

  it("the client route + components import VALUES only from lib/* (server = type-only)", () => {
    for (const f of CONSOLE_FILES.filter(
      (x) => x.startsWith("routes/") || x.startsWith("components/"),
    )) {
      const code = read(f);
      const valueImports = [
        ...code.matchAll(/^import\s+(?!type\b)([^;]*?)\s+from\s*["'](@\/server\/[^"']+)["']/gm),
      ];
      for (const m of valueImports) {
        const bare = (m[1] ?? "")
          .replace(/\{[^}]*\}/, (b) => b.replace(/\btype\s+[\w$]+/g, ""))
          .replace(/[{},\s]/g, "");
        expect(bare === "", `${f}: non-type value import from ${m[2]}`).toBe(true);
      }
    }
  });

  it("no seeded business point values in the console (only 0 / limits)", () => {
    for (const f of ["lib/officeverse/scoring-fns.ts", "lib/officeverse/scoring-ui.ts"]) {
      const code = stripComments(read(f));
      for (const m of code.matchAll(/points:\s*(-?\d+)/g)) {
        expect(["0"], `${f} has points: ${m[1]}`).toContain(m[1]);
      }
    }
  });

  it("the live-scoring flag stays false in .env.example", () => {
    expect(read("../.env.example")).toMatch(/SCORING_ENGINE_ENABLED=false/);
  });
});

/* ---------------------- Phase 4: LEAD_SUBMITTED integration --------------------- */

describe("LEAD_SUBMITTED integration (Phase 4) — Lead service only emits an event", () => {
  const svc = () => stripComments(read("server/leads/service.ts"));
  const adapter = () => stripComments(read("server/events/adapters/lead-submitted.ts"));

  it("leads/service.ts emits the BusinessEvent through the event layer ONLY", () => {
    const code = svc();
    expect(code).toMatch(/emitBusinessEvent\(/);
    expect(code).toMatch(/buildLeadSubmittedEvent\(/);
  });

  it("leads/service.ts never calls the scoring engine or the ledger directly", () => {
    const code = svc();
    expect(code).not.toMatch(
      /awardScored|awardEvent\(|scoring\.ingest|\bingest\(|dispatchBusinessEvent/,
    );
    for (const spec of importsOf(code)) {
      expect(
        /(^|\/)scoring\//.test(spec) ||
          /events\/dispatcher/.test(spec) ||
          /db\/repos\/gamification/.test(spec),
        `leads/service.ts must not import "${spec}"`,
      ).toBe(false);
    }
  });

  it("Phase 5: leads/service.ts routes LEAD_SUBMITTED recognition through the ONE BusinessEvent — no direct recognizeSafe(onLeadSubmitted) call", () => {
    const code = svc();
    // the canonical path is the only path
    expect(code).toMatch(/emitBusinessEvent\(/);
    // the old direct recognition call was retired (comments stripped)
    expect(code).not.toMatch(/recognizeSafe\(\s*onLeadSubmitted\(/);
    expect(code).not.toMatch(/\bonLeadSubmitted\b/);
    // LEAD_ACCEPTED / SALE are NOT migrated — their direct calls remain
    expect(code).toMatch(/recognizeSafe\(\s*onLeadAccepted\(/);
    expect(code).toMatch(/recognizeSafe\(\s*onSale\(/);
  });

  it("Phase 5: onLeadSubmitted in live/recognition.ts no longer awards points (scoring / legacy-points bridge own that)", () => {
    const reco = stripComments(read("server/live/recognition.ts"));
    const fn = reco.slice(
      reco.indexOf("export async function onLeadSubmitted"),
      reco.indexOf("export async function onLeadAccepted"),
    );
    expect(fn).not.toMatch(/awardEvent\(/);
    expect(reco).toMatch(/recognizeFromBusinessEvent/);
  });

  it("leads/service.ts emits LEAD_ACCEPTED (Phase 7) via the adapter, but NOT SALE / FOLLOW_UP", () => {
    const code = svc();
    // Phase 7 — LEAD_ACCEPTED now flows through the canonical BusinessEvent path
    expect(code).toMatch(/buildLeadAcceptedEvent\(/);
    // SALE / FOLLOW_UP integration remains a later phase
    expect(code).not.toMatch(/"SALE"|"FOLLOW_UP_COMPLETED"|buildSaleEvent|buildFollowUpEvent/);
  });

  it("the payload adapter is PURE — no scoring / gamification / live / data-access imports", () => {
    for (const spec of importsOf(adapter())) {
      expect(
        /(^|\/)(scoring|gamification|live)\//.test(spec) || /db\/repos\//.test(spec),
        `adapter must not import "${spec}"`,
      ).toBe(false);
    }
  });

  it("the adapter emits only registered fields and invents no future business values", () => {
    const code = adapter();
    // future registry fields must NOT be populated by the Lead adapter
    expect(code).not.toMatch(
      /lead_type:|lead_grade:|qualified:|sale_amount:|closer_tenure_days:|follow_up_/,
    );
    // team has no CRM model yet → explicitly null
    expect(code).toMatch(/team:\s*null/);
    // no hard-coded scoring points
    expect(code).not.toMatch(/points/);
  });

  it("followups + live/* remain untouched by the integration", () => {
    expect(stripComments(read("server/followups/service.ts"))).not.toMatch(
      /emitBusinessEvent|BusinessEvent|adapters\//,
    );
    for (const f of ["server/live/recognition.ts", "server/live/bus.ts"]) {
      expect(stripComments(read(f))).not.toMatch(/emitBusinessEvent|events\/adapters|scoring\//);
    }
  });
});
