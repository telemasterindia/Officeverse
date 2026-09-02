/**
 * OFFICEVERSE — STAGE 5 · Daily Production + TV polish · LIVE dryrun UAT
 * (opt-in, DB-touching). Runs the data half of §18 against tmi_officeverse_dryrun.
 * Rotation TIMING + ORDER are proven by tv-rotation.test.ts; the VISUALS are the
 * §19 manual browser checklist.
 *
 * SAFETY: asserts SELECT DATABASE() first. Only inserts rows it deletes by
 * dedupe key + id > baseline (a throwaway display token, a few directly-inserted
 * ledger rows, one throwaway POWERHOUR announcement). NEVER runs scoring, NEVER
 * touches leads / incentive_results / audit_logs. Restores every baseline.
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/server/__tests__/daily-production.itest.ts --config vitest.itest.config.ts
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import { tvState } from "../live/tv-service";
import { recognitionBus } from "../live/bus";
import { currentShiftDate } from "../time";

const RAW_TOKEN = "ovtv_uat_s5_" + "z".repeat(44);
const TOKEN_HASH = createHash("sha256").update(RAW_TOKEN).digest("hex");
const SHIFT = currentShiftDate("US");
const A1 = 3; // Rahul Sharma (US) — agent
const A2 = 4; // Priya Patel (US) — agent
const DEDUPE_LIKE = "UAT-S5:%";

let conn: mysql.Connection;
const base = { txn: 0, ann: 0, aud: 0, leads: 0, inc: 0 };
let displayId = 0;
let annId = 0;

const scalar = async (sql: string, args: unknown[] = []): Promise<number> => {
  const [r] = (await conn.query(sql, args)) as [Record<string, unknown>[], unknown];
  return Number(Object.values(r[0] ?? { v: 0 })[0]);
};

async function seedTxn(userId: number, event: string, ref: string): Promise<void> {
  await conn.query(
    `INSERT INTO gamification_point_transactions
       (user_id, role, process, event, points, operational_date, reference_type, reference_id,
        dedupe_key, status, source, created_at)
     VALUES (?, 'agent', 'US', ?, 10, ?, 'lead', ?, ?, 'ACTIVE', 'system', NOW())`,
    [userId, event, SHIFT, ref, `UAT-S5:${userId}:${event}:${ref}`],
  );
}

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const db = (
    (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown]
  )[0][0]!.v;
  if (db !== "tmi_officeverse_dryrun") throw new Error(`REFUSING — DATABASE() is "${db}"`);

  base.txn = await scalar("SELECT COALESCE(MAX(id),0) v FROM gamification_point_transactions");
  base.ann = await scalar("SELECT COALESCE(MAX(id),0) v FROM office_tv_announcements");
  base.aud = await scalar("SELECT COUNT(*) v FROM audit_logs");
  base.leads = await scalar("SELECT COUNT(*) v FROM leads");
  base.inc = await scalar("SELECT COUNT(*) v FROM incentive_results");

  await conn.query("DELETE FROM gamification_point_transactions WHERE dedupe_key LIKE ?", [
    DEDUPE_LIKE,
  ]);

  const [res] = (await conn.query(
    "INSERT INTO office_tv_displays (name, token_hash, token_prefix, scope, enabled, created_at) VALUES (?,?,?,?,1,NOW())",
    ["ZZ_S5_UAT_DELETE_ME", TOKEN_HASH, RAW_TOKEN.slice(0, 12), "tv_read"],
  )) as unknown as [{ insertId: number }, unknown];
  displayId = res.insertId;

  // agent A1: 2 submitted, 1 accepted, 1 sale   ·   agent A2: 1 submitted
  await seedTxn(A1, "LEAD_SUBMITTED", "S5-A1a");
  await seedTxn(A1, "LEAD_SUBMITTED", "S5-A1b");
  await seedTxn(A1, "LEAD_ACCEPTED", "S5-A1a");
  await seedTxn(A1, "SALE", "S5-A1a");
  await seedTxn(A2, "LEAD_SUBMITTED", "S5-A2a");
});

afterAll(async () => {
  await conn.query("DELETE FROM gamification_point_transactions WHERE dedupe_key LIKE ?", [
    DEDUPE_LIKE,
  ]);
  if (annId) await conn.query("DELETE FROM office_tv_announcements WHERE id = ?", [annId]);
  if (displayId) await conn.query("DELETE FROM office_tv_displays WHERE id = ?", [displayId]);
  await conn.query("DELETE FROM office_tv_announcements WHERE id > ?", [base.ann]);
  // audit_logs is append-only — leave it.
  await conn.end();
});

test("§18.1 — the state API stays display-token protected (no token / short / bad → 401)", async () => {
  await expect(tvState(null)).rejects.toMatchObject({ status: 401 });
  await expect(tvState("short")).rejects.toMatchObject({ status: 401 });
  await expect(tvState("ovtv_not_a_real_token_x".padEnd(40, "x"))).rejects.toMatchObject({
    status: 401,
  });
});

test("§18.2–4 — agent-wise submitted / accepted / sales are correct and match the ledger", async () => {
  const s = await tvState(RAW_TOKEN);
  expect(Array.isArray(s.dailyProduction)).toBe(true);

  // independent aggregation over the SAME authoritative ledger + today window
  const [ledger] = (await conn.query(
    `SELECT t.user_id AS userId, u.full_name AS name,
        SUM(t.event = 'LEAD_SUBMITTED') AS submitted,
        SUM(t.event IN ('LEAD_ACCEPTED','THIRD_ACCEPTED_LEAD')) AS accepted,
        SUM(t.event = 'SALE') AS sales
       FROM gamification_point_transactions t
       JOIN users u ON u.id = t.user_id
      WHERE t.operational_date = ? AND u.role = 'agent'
      GROUP BY t.user_id, u.full_name`,
    [SHIFT],
  )) as unknown as [
    { userId: number; name: string; submitted: number; accepted: number; sales: number }[],
    unknown,
  ];
  const byUser = new Map(ledger.map((r) => [r.userId, r]));

  for (const uid of [A1, A2]) {
    const tv = s.dailyProduction.find((r) => r.userId === uid);
    const l = byUser.get(uid)!;
    expect(tv, `TV row for user ${uid}`).toBeTruthy();
    expect(tv!.name).toBe(l.name); // real name from users, not hard-coded
    expect(tv!.leadsSubmitted).toBe(Number(l.submitted));
    expect(tv!.leadsAccepted).toBe(Number(l.accepted));
    expect(tv!.sales).toBe(Number(l.sales));
  }
  // the seeded contribution is visible
  const a1 = s.dailyProduction.find((r) => r.userId === A1)!;
  expect(a1.leadsSubmitted).toBeGreaterThanOrEqual(2);
  expect(a1.leadsAccepted).toBeGreaterThanOrEqual(1);
  expect(a1.sales).toBeGreaterThanOrEqual(1);

  // agents ONLY — no closer appears
  const [closerIds] = (await conn.query("SELECT user_id FROM closers")) as unknown as [
    { user_id: number }[],
    unknown,
  ];
  const closerSet = new Set(closerIds.map((c) => c.user_id));
  expect(s.dailyProduction.some((r) => closerSet.has(r.userId))).toBe(false);
});

test("§18.6–7 — leaderboard still present AND Daily Production is a different shape", async () => {
  const s = await tvState(RAW_TOKEN);
  expect(Array.isArray(s.leaderboard)).toBe(true);
  // leaderboard rows carry rank + points; production rows carry work counts, no rank/points
  for (const r of s.dailyProduction) {
    expect(r).not.toHaveProperty("rank");
    expect(r).not.toHaveProperty("points");
    expect(typeof r.leadsSubmitted).toBe("number");
  }
});

test("§18.10 — Power Hour surfaces on the TV only while an announcement (effect POWERHOUR) is active", async () => {
  expect((await tvState(RAW_TOKEN)).powerHour).toBeNull();

  // announcement times are IST wall-clock strings (UTC + 5:30), not UTC.
  const istWall = (msFromNow: number) =>
    new Date(Date.now() + 5.5 * 3_600_000 + msFromNow).toISOString().slice(0, 19).replace("T", " ");
  const [ins] = (await conn.query(
    `INSERT INTO office_tv_announcements
       (title, message, effect, priority, audience, status, enabled, publish_at, published_at,
        expires_at, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, 'POWERHOUR', 'IMPORTANT', 'all', 'published', 1, NULL, ?, ?, 1, NOW(), NOW())`,
    ["UAT S5 Power Hour", "Push hard for the next hour", istWall(-60_000), istWall(2 * 3_600_000)],
  )) as unknown as [{ insertId: number }, unknown];
  annId = ins.insertId;

  const s = await tvState(RAW_TOKEN);
  expect(s.powerHour).toMatchObject({ title: "UAT S5 Power Hour" });

  await conn.query("DELETE FROM office_tv_announcements WHERE id = ?", [annId]);
  annId = 0;
  expect((await tvState(RAW_TOKEN)).powerHour).toBeNull();
});

test("§18.13–20 — celebration + announcement bus interrupts are still delivered", async () => {
  const seq0 = recognitionBus.latestSeq();
  recognitionBus.publish("celebration", {
    kind: "LEAD_ACCEPTED",
    subject: { userId: A1, name: "Rahul", role: "agent", photoAvailable: false },
    celebrationLevel: "LEVEL_2",
    celebrationProfile: { level: "LEVEL_2", particleProfile: "dollar-rain" },
  } as unknown as Parameters<typeof recognitionBus.publish>[1]);
  recognitionBus.publish("announcement", {
    kind: "announcement",
    announcementId: 991,
    title: "UAT S5",
    message: "hello floor",
    priority: "NORMAL",
    durationMs: 9000,
    audio: { ttsEnabled: true, spokenText: "hello floor" },
    celebration: null,
  } as unknown as Parameters<typeof recognitionBus.publish>[1]);

  const s = await tvState(RAW_TOKEN, { sinceSeq: seq0 });
  const kinds = s.live.items.map((i) => i.type);
  expect(kinds).toContain("celebration");
  expect(kinds).toContain("announcement");
});

test("§18.21–23 — building TV state mutates NO CRM / scoring / incentive / audit data", async () => {
  await tvState(RAW_TOKEN);
  await tvState(RAW_TOKEN, { kind: "weekly" });
  await tvState(RAW_TOKEN);
  expect(await scalar("SELECT COUNT(*) v FROM leads")).toBe(base.leads);
  expect(await scalar("SELECT COUNT(*) v FROM incentive_results")).toBe(base.inc);
  expect(await scalar("SELECT COUNT(*) v FROM audit_logs")).toBe(base.aud);
  // only the rows this test seeded exist above the baseline
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM gamification_point_transactions WHERE id > ? AND dedupe_key NOT LIKE ?",
      [base.txn, DEDUPE_LIKE],
    ),
  ).toBe(0);
});
