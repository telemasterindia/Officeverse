/**
 * Phase 6.5 — Operations Control architecture guards.
 *
 *   CRM ≠ Scoring Engine ≠ Recognition Engine ≠ Operations UI ≠ Office TV.
 *
 * The Operations layer configures the existing engines through their server
 * APIs. It never imports scoring internals into Lead/Follow-up services, never
 * calculates points/incentives, never mutates or deletes an audit row, and
 * never touches the Office TV display-token security boundary.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const importsOf = (code: string) =>
  [...code.matchAll(/(?:import|export)[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]!);

const OPS_SERVER_FILES = [
  "server/authz/operations.ts",
  "server/live/celebration-ops.ts",
  "server/live/power-hour.ts",
  "server/live/ops-audit.ts",
];

describe("Phase 6.5 — Operations server modules stay in their lane", () => {
  it("authz/operations.ts is PURE (only imports http-error)", () => {
    const specs = importsOf(strip(read("server/authz/operations.ts")));
    expect(specs).toEqual(["../http-error"]);
  });

  for (const f of OPS_SERVER_FILES) {
    const src = strip(read(f));
    it(`${f} imports nothing from CRM / scoring internals / HR / payroll`, () => {
      for (const spec of importsOf(src)) {
        expect(
          /leads\/service|followups\/service|(^|\/)hr\/|payroll|salary|regularity/.test(spec) ||
            /scoring\/(ingest|evaluate|conditions|operators|dry-run|modes)/.test(spec) ||
            /events\/(business-event|dispatcher)/.test(spec),
          `${f} imports "${spec}"`,
        ).toBe(false);
      }
    });
    it(`${f} never awards points / emits a business event / computes a score`, () => {
      expect(src).not.toMatch(
        /awardScored|awardEvent|emitBusinessEvent|evaluateScoring|scoring\.ingest/,
      );
      expect(src).not.toMatch(/points\s*=\s*\d{2,}|debt|amount\s*[<>]=/i);
    });
  }

  it("celebration-ops publishes to the EXISTING recognitionBus and writes no ledger / event row", () => {
    const src = strip(read("server/live/celebration-ops.ts"));
    expect(src).toMatch(/recognitionBus\.publish\("celebration"/);
    expect(src).not.toMatch(/insertTvEvent|gamification_point_transactions|insert\(.*points/i);
    expect(src).toMatch(/points:\s*0/); // a test celebration always carries 0 points
  });

  it("ops-audit.ts is READ-ONLY — no update / delete against audit_logs", () => {
    const src = strip(read("server/live/ops-audit.ts"));
    expect(src).toMatch(/\.select\(/);
    expect(src).not.toMatch(/\.delete\(|\.update\(|deleteFrom|drop table/i);
    expect(src).toMatch(/assertCanRunOperations/);
  });
});

describe("Phase 6.5 — authorization boundaries", () => {
  it("every scoring server function requires admin + closer (Operations role)", () => {
    const code = read("lib/officeverse/scoring-fns.ts");
    const handlers = code.split(/export const \w+Fn/).slice(1);
    for (const h of handlers) expect(h).toMatch(/requireRole\("admin", "closer"\)/);
  });

  it("every operations-fns handler requires admin + closer and takes the actor from the session", () => {
    const code = read("lib/officeverse/operations-fns.ts");
    const handlers = code.split(/export const \w+Fn/).slice(1);
    expect(handlers.length).toBeGreaterThanOrEqual(7);
    for (const h of handlers) {
      expect(h).toMatch(/requireRole\("admin", "closer"\)/);
      // actor is the resolved session user, never taken from `data`
      expect(h).not.toMatch(/data\.(actorUserId|actorRole|role)\b/);
    }
  });

  it("live/service.ts — announcements use ops authz; displays/settings/assets stay Admin-only", () => {
    const src = read("server/live/service.ts");
    // the four announcement functions
    const annBlock = src.slice(src.indexOf("export async function listAnnouncements"));
    for (const fn of [
      "listAnnouncements",
      "createAnnouncement",
      "publishAnnouncementNow",
      "stopAnnouncement",
    ]) {
      const i = annBlock.indexOf(`function ${fn}`);
      const body = annBlock.slice(i, i + 400);
      expect(body, fn).toMatch(/assertCanRunOperations\(actor\.role\)/);
    }
    // displays / settings / assets / seed remain admin-only
    for (const fn of [
      "createDisplay",
      "revokeDisplay",
      "rotateDisplay",
      "updateSettings",
      "uploadAsset",
      "deleteAsset",
      "seedOfficeTv",
    ]) {
      const i = src.indexOf(`function ${fn}`);
      const body = src.slice(i, i + 400);
      expect(body, fn).toMatch(/assertCanManageOfficeTv\(actor\.role\)/);
    }
  });

  it("authz/office-tv.ts is unchanged — canManageOfficeTv is still Admin-only", () => {
    const src = read("server/authz/office-tv.ts");
    expect(src).toMatch(
      /export function canManageOfficeTv\(role: string\): boolean \{\s*return role === "admin";/,
    );
    expect(src).not.toMatch(/role === "closer"/);
  });

  it("the /operations route is gated to admin + closer via RoleGate", () => {
    const src = read("routes/_shell.operations.tsx");
    expect(src).toMatch(/RoleGate allow={\["admin", "closer"\]}/);
  });
});

describe("Phase 6.5 — Office TV security boundary untouched", () => {
  it("/office-tv route still takes NO CRM login (root-level, display token only)", () => {
    const src = read("routes/office-tv.tsx");
    expect(src).toMatch(/createFileRoute\("\/office-tv"\)/);
    expect(src).not.toMatch(/requireRole|requireUser|assertCanRunOperations/);
  });
  it("/api/office-tv/state still verifies the display token via tvState", () => {
    const src = read("server/internal-routes.ts");
    expect(src).toMatch(/"\/api\/office-tv\/state"/);
    expect(src).toMatch(/x-display-token/);
    expect(src).toMatch(/tvState\(token/);
  });
});

describe("Phase 6.5 — no database migration of its own", () => {
  it("added no power-hour / operations migration (Phase 9 owns incentive tables)", () => {
    const files = readdirSync(join(root, "..", "drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files.some((f) => /power.?hour|operations/i.test(f))).toBe(false);
  });
  it("no power_hours table in the schema (Power Hour reuses office_tv_announcements)", () => {
    const schema = read("lib/db/schema.ts");
    expect(schema).not.toMatch(/mysqlTable\(\s*["']power_hours?["']/i);
  });
});
