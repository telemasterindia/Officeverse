/**
 * Phase 9 — INCENTIVE ENGINE · LIVE dryrun UAT (opt-in, DB-touching).
 *
 * Exercises the real service against `tmi_officeverse_dryrun`:
 *   - Closer creates a scheme (supported path) + enables it
 *   - Employee A (points over the 7 500 tier)  → ELIGIBLE  → INR 5 000
 *   - Employee B (points below the 5 000 gate) → NOT_ELIGIBLE → INR 0
 *   - Employee C (points over the 10 000 tier) → ELIGIBLE  → INR 10 000
 *   - dry-run uses the SAME evaluator and persists nothing
 *   - scheme version change: a September result stays on the September version
 *   - re-running the same calculation creates NO duplicate incentive row
 *   - every mutation writes an audit row with the SERVER actor id
 *   - an Agent sees only their own result; HR keeps its existing boundary
 *
 * SAFETY: asserts `SELECT DATABASE()` first. Seeds only `gamification_point_transactions`
 * rows keyed `UAT-P9-*` and rows in `incentive_*`; deletes every one by `id > baseline`
 * in afterAll and asserts the max-id baseline is restored. NEVER touches `audit_logs`
 * (audit rows are immutable — the ones this test creates are expected to remain).
 * Never enables the scoring engine; never dispatches a business event.
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/server/__tests__/incentive-engine.itest.ts --exclude '**\/node_modules/**'
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import {
  approveIncentiveResult,
  calculateIncentives,
  createIncentiveScheme,
  dryRunIncentive,
  listIncentiveResults,
  listIncentiveSchemes,
  myIncentive,
  setIncentiveSchemeEnabled,
  updateIncentiveScheme,
  type SchemeDraft,
} from "../incentive/service";
import { HttpError } from "../http-error";

const A = 3; // Rahul Sharma (US) — over the 7 500 tier
const B = 4; // Priya Patel (US) — below the 5 000 gate
const C = 18; // Amit (US)        — over the 10 000 tier
const CLOSER = { id: 19, role: "closer" as const, process: "US" as const };
const ADMIN = { id: 1, role: "admin" as const, process: "US" as const };
const HR = { id: 2, role: "hr" as const, process: "US" as const };
const AGENT_A = { id: A, role: "agent" as const, process: "US" as const };

const SEP = { from: "2026-09-15", to: "2026-09-15" };
const OCT = { from: "2026-10-15", to: "2026-10-15" };

let conn: mysql.Connection;
const base = { schemes: 0, versions: 0, results: 0, txns: 0 };

const scalar = async (sql: string, args: unknown[] = []): Promise<number> => {
  const [rows] = (await conn.query(sql, args)) as [Record<string, unknown>[], unknown];
  return Number(Object.values(rows[0] ?? { v: 0 })[0]);
};

async function seedPoints(userId: number, date: string, total: number, tag: string) {
  await conn.query(
    `INSERT INTO gamification_point_transactions
       (user_id, role, process, event, points, operational_date, reference_type, reference_id,
        dedupe_key, status, source, created_at)
     VALUES (?, 'agent', 'US', 'LEAD_ACCEPTED', ?, ?, 'uat', ?, ?, 'ACTIVE', 'system', NOW())`,
    [userId, total, date, tag, `UAT-P9-${tag}`],
  );
}

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const dbName = (
    (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown]
  )[0][0]!.v;
  if (dbName !== "tmi_officeverse_dryrun") {
    throw new Error(`REFUSING TO RUN — DATABASE() is "${dbName}", expected tmi_officeverse_dryrun`);
  }

  base.schemes = await scalar("SELECT COALESCE(MAX(id),0) v FROM incentive_schemes");
  base.versions = await scalar("SELECT COALESCE(MAX(id),0) v FROM incentive_scheme_versions");
  base.results = await scalar("SELECT COALESCE(MAX(id),0) v FROM incentive_results");
  base.txns = await scalar("SELECT COALESCE(MAX(id),0) v FROM gamification_point_transactions");

  await seedPoints(A, SEP.from, 8250, "A-SEP");
  await seedPoints(B, SEP.from, 3100, "B-SEP");
  await seedPoints(C, SEP.from, 12000, "C-SEP");
  await seedPoints(A, OCT.from, 8250, "A-OCT");
});

afterAll(async () => {
  if (!conn) return;
  await conn.query("DELETE FROM incentive_results WHERE id > ?", [base.results]);
  await conn.query("DELETE FROM incentive_scheme_versions WHERE id > ?", [base.versions]);
  await conn.query("DELETE FROM incentive_schemes WHERE id > ?", [base.schemes]);
  await conn.query("DELETE FROM gamification_point_transactions WHERE id > ? AND dedupe_key LIKE 'UAT-P9-%'", [
    base.txns,
  ]);

  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM incentive_schemes")).toBe(base.schemes);
  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM incentive_scheme_versions")).toBe(base.versions);
  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM incentive_results")).toBe(base.results);
  expect(
    await scalar("SELECT COUNT(*) v FROM gamification_point_transactions WHERE dedupe_key LIKE 'UAT-P9-%'"),
  ).toBe(0);
  await conn.end();
});

const draft = (effectiveFrom: string, reward: unknown): SchemeDraft => ({
  name: "UAT P9 High Performer",
  periodType: "custom",
  priority: 100,
  combineMode: "independent",
  eligibility: { op: "AND", nodes: [{ metric: "points", operator: "gte", value: 5000 }] },
  reward,
  effectiveFrom,
});

const SEP_TIERS = {
  kind: "TIERED",
  metric: "points",
  tiers: [
    { min: 5000, amount: 2500 },
    { min: 7500, amount: 5000 },
    { min: 10000, amount: 10000 },
  ],
};
const OCT_TIERS = {
  kind: "TIERED",
  metric: "points",
  tiers: [
    { min: 5000, amount: 4000 },
    { min: 7500, amount: 8000 },
    { min: 10000, amount: 16000 },
  ],
};

let schemeId = 0;

test("Closer creates + enables a scheme (audited with the server actor id)", async () => {
  const created = await createIncentiveScheme(CLOSER, draft("2026-09-01", SEP_TIERS));
  schemeId = created.schemeId;
  expect(created.version).toBe(1);

  // created DISABLED — Operations enables after a dry run
  expect(await scalar("SELECT enabled v FROM incentive_schemes WHERE id = ?", [schemeId])).toBe(0);
  await setIncentiveSchemeEnabled(CLOSER, schemeId, true);
  expect(await scalar("SELECT enabled v FROM incentive_schemes WHERE id = ?", [schemeId])).toBe(1);

  const auditCreated = await scalar(
    "SELECT COUNT(*) v FROM audit_logs WHERE action = 'INCENTIVE_SCHEME_CREATED' AND entity_id = ? AND actor_user_id = ? AND actor_role = 'closer'",
    [schemeId, CLOSER.id],
  );
  expect(auditCreated).toBe(1);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'INCENTIVE_SCHEME_ENABLED' AND entity_id = ?",
      [schemeId],
    ),
  ).toBe(1);
});

test("dry-run uses the same evaluator and persists nothing", async () => {
  const before = await scalar("SELECT COUNT(*) v FROM incentive_results");
  const dry = await dryRunIncentive(CLOSER, {
    schemeId,
    userId: A,
    period: "custom",
    from: SEP.from,
    to: SEP.to,
  });
  expect(dry.version).toBe(1);
  expect(dry.result?.eligibility).toBe("ELIGIBLE");
  expect(dry.result?.rewardAmount).toBe(5000);
  expect(await scalar("SELECT COUNT(*) v FROM incentive_results")).toBe(before); // nothing written
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'INCENTIVE_CALCULATION_RUN' AND JSON_EXTRACT(metadata, '$.dryRun') = true",
    ),
  ).toBeGreaterThanOrEqual(1);
});

test("live calculation — A eligible / B not eligible / C higher tier", async () => {
  const { results } = await calculateIncentives(CLOSER, {
    schemeId,
    period: "custom",
    from: SEP.from,
    to: SEP.to,
    userIds: [A, B, C],
  });
  const byUser = new Map(results.map((r) => [r.userId, r]));

  expect(byUser.get(A)).toMatchObject({ status: "CALCULATED", rewardAmount: 5000, schemeVersion: 1 });
  expect(byUser.get(B)).toMatchObject({ status: "NOT_ELIGIBLE", rewardAmount: 0 });
  expect(byUser.get(C)).toMatchObject({ status: "CALCULATED", rewardAmount: 10000, schemeVersion: 1 });

  // persisted, one row per (scheme, version, user, period)
  expect(
    await scalar("SELECT COUNT(*) v FROM incentive_results WHERE scheme_id = ? AND period_from = ?", [
      schemeId,
      SEP.from,
    ]),
  ).toBe(3);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'INCENTIVE_CALCULATION_RUN' AND JSON_EXTRACT(metadata, '$.dryRun') = false",
    ),
  ).toBeGreaterThanOrEqual(1);
});

test("scheme version change — the September result stays on the September version", async () => {
  const upd = await updateIncentiveScheme(CLOSER, schemeId, draft("2026-10-01", OCT_TIERS));
  expect(upd.version).toBe(2);

  // capture A's September row id, then recalculate the SAME September window
  const sepRowId = await scalar(
    "SELECT id v FROM incentive_results WHERE scheme_id = ? AND user_id = ? AND period_from = ?",
    [schemeId, A, SEP.from],
  );
  const rerun = await calculateIncentives(CLOSER, {
    schemeId,
    period: "custom",
    from: SEP.from,
    to: SEP.to,
    userIds: [A, B, C],
  });
  const aSep = rerun.results.find((r) => r.userId === A)!;
  expect(aSep.schemeVersion).toBe(1); // NOT bumped to v2
  expect(aSep.rewardAmount).toBe(5000); // still the September tier value
  // same row, no duplicate
  expect(
    await scalar("SELECT id v FROM incentive_results WHERE scheme_id = ? AND user_id = ? AND period_from = ?", [
      schemeId,
      A,
      SEP.from,
    ]),
  ).toBe(sepRowId);

  // an October calculation picks up v2
  const oct = await calculateIncentives(CLOSER, {
    schemeId,
    period: "custom",
    from: OCT.from,
    to: OCT.to,
    userIds: [A],
  });
  const aOct = oct.results.find((r) => r.userId === A)!;
  expect(aOct.schemeVersion).toBe(2);
  expect(aOct.rewardAmount).toBe(8000); // the October tier value
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'INCENTIVE_SCHEME_UPDATED' AND entity_id = ?",
      [schemeId],
    ),
  ).toBe(1);
});

test("idempotency — re-running the same calculation creates no duplicate incentive", async () => {
  const before = await scalar("SELECT COUNT(*) v FROM incentive_results WHERE scheme_id = ?", [schemeId]);
  await calculateIncentives(CLOSER, {
    schemeId,
    period: "custom",
    from: SEP.from,
    to: SEP.to,
    userIds: [A, B, C],
  });
  await calculateIncentives(CLOSER, {
    schemeId,
    period: "custom",
    from: SEP.from,
    to: SEP.to,
    userIds: [A, B, C],
  });
  expect(await scalar("SELECT COUNT(*) v FROM incentive_results WHERE scheme_id = ?", [schemeId])).toBe(
    before,
  );
});

test("Agent sees only their own result; HR keeps its existing boundary", async () => {
  const mine = await myIncentive(AGENT_A, { period: "custom", from: SEP.from, to: SEP.to });
  expect(mine.results.every((r) => r.userId === A)).toBe(true);
  expect(mine.results.length).toBeGreaterThan(0);

  // agent asks for someone else → forced back to self
  const forced = await listIncentiveResults(AGENT_A, { userId: B });
  expect(forced.selfOnly).toBe(true);
  expect(forced.results.every((r) => r.userId === A)).toBe(true);

  // HR: no scheme management, no dry-run
  await expect(listIncentiveSchemes(HR)).rejects.toMatchObject({ status: 403 });
  await expect(
    dryRunIncentive(HR, { schemeId, userId: A, period: "custom", from: SEP.from, to: SEP.to }),
  ).rejects.toBeInstanceOf(HttpError);
});

test("Closer cannot approve / finalize — that is Admin-only", async () => {
  const rowId = await scalar(
    "SELECT id v FROM incentive_results WHERE scheme_id = ? AND user_id = ? AND period_from = ? AND status = 'CALCULATED'",
    [schemeId, A, SEP.from],
  );
  await expect(approveIncentiveResult(CLOSER, rowId)).rejects.toMatchObject({ status: 403 });
  // Admin may (transition to APPROVED from CALCULATED is legal)
  const ok = await approveIncentiveResult(ADMIN, rowId, "UAT approve");
  expect(ok.status).toBe("APPROVED");
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'INCENTIVE_RESULT_APPROVED' AND entity_id = ? AND actor_user_id = ?",
      [rowId, ADMIN.id],
    ),
  ).toBe(1);

  // a re-run must now leave the APPROVED row untouched
  await calculateIncentives(CLOSER, {
    schemeId,
    period: "custom",
    from: SEP.from,
    to: SEP.to,
    userIds: [A],
  });
  expect(await scalar("SELECT status = 'APPROVED' v FROM incentive_results WHERE id = ?", [rowId])).toBe(1);
});
