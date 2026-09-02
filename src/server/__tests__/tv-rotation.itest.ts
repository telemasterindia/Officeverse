/**
 * Phase 10 · Stage 3 — OFFICE TV ROTATION + LEADERBOARD + ACHIEVEMENT · LIVE
 * dryrun UAT (opt-in, DB-touching). Runs the data/pipeline half of the §27
 * checklist against `tmi_officeverse_dryrun`. The rotation TIMING + screen ORDER
 * are proven by the pure unit tests; the VISUALS are a manual browser checklist
 * (§28) called out in the report.
 *
 * SAFETY: asserts SELECT DATABASE() first. Deletes every office_tv_events /
 * gamification_point_transactions row it creates by dedupe key + id > baseline,
 * restores office_tv_settings.leaderboard_window, drops its throwaway display
 * token row, and asserts every baseline is restored. NEVER touches audit_logs.
 * Never runs scoring — the points row is inserted directly and cleaned up.
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/server/__tests__/tv-rotation.itest.ts --config vitest.itest.config.ts
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import { tvState } from "../live/tv-service";
import { recognitionBus } from "../live/bus";
import { currentShiftDate } from "../time";

const RAW_TOKEN = "ovtv_uat_p10s3_" + "y".repeat(40);
const TOKEN_HASH = createHash("sha256").update(RAW_TOKEN).digest("hex");
const SUBJECT = 3; // Rahul Sharma (US)
const SHIFT = currentShiftDate("US");
const DEDUPE = `UAT-P10S3:lead:UAT-P10S3-L1`;

let conn: mysql.Connection;
const base = { evt: 0, txn: 0, displayCount: 0 };
let origWindow = "daily";
let displayId = 0;

const scalar = async (sql: string, args: unknown[] = []): Promise<number> => {
  const [rows] = (await conn.query(sql, args)) as [Record<string, unknown>[], unknown];
  return Number(Object.values(rows[0] ?? { v: 0 })[0]);
};
const str = async (sql: string): Promise<string> => {
  const [rows] = (await conn.query(sql)) as [Record<string, unknown>[], unknown];
  return String(Object.values(rows[0] ?? { v: "" })[0]);
};

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const dbName = (
    (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown]
  )[0][0]!.v;
  if (dbName !== "tmi_officeverse_dryrun") {
    throw new Error(`REFUSING TO RUN — DATABASE() is "${dbName}", expected tmi_officeverse_dryrun`);
  }
  base.evt = await scalar("SELECT COALESCE(MAX(id),0) v FROM office_tv_events");
  base.txn = await scalar("SELECT COALESCE(MAX(id),0) v FROM gamification_point_transactions");
  base.displayCount = await scalar("SELECT COUNT(*) v FROM office_tv_displays");
  origWindow = await str("SELECT leaderboard_window FROM office_tv_settings WHERE id = 1");

  const [res] = (await conn.query(
    "INSERT INTO office_tv_displays (name, token_hash, token_prefix, scope, enabled, created_at) VALUES (?,?,?,?,1,NOW())",
    ["ZZ_P10S3_UAT_DELETE_ME", TOKEN_HASH, RAW_TOKEN.slice(0, 12), "tv_read"],
  )) as [mysql.ResultSetHeader, unknown];
  displayId = res.insertId;
});

afterAll(async () => {
  if (!conn) return;
  await conn.query(
    "DELETE FROM gamification_point_transactions WHERE dedupe_key LIKE 'UAT-P10S3%'",
  );
  await conn.query("DELETE FROM office_tv_events WHERE dedupe_key LIKE 'UAT-P10S3%'");
  await conn.query("UPDATE office_tv_settings SET leaderboard_window = ? WHERE id = 1", [
    origWindow,
  ]);
  if (displayId)
    await conn.query("DELETE FROM office_tv_displays WHERE id = ? LIMIT 1", [displayId]);

  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM office_tv_events")).toBe(base.evt);
  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM gamification_point_transactions")).toBe(
    base.txn,
  );
  expect(await scalar("SELECT COUNT(*) v FROM office_tv_displays")).toBe(base.displayCount);
  expect(await str("SELECT leaderboard_window FROM office_tv_settings WHERE id = 1")).toBe(
    origWindow,
  );
  await conn.end();
});

test("W · the state API stays display-token protected — no token / short token → 401", async () => {
  await expect(tvState(null)).rejects.toMatchObject({ status: 401 });
  await expect(tvState("short")).rejects.toMatchObject({ status: 401 });
});

test("D · the TV consumes the authoritative Phase-8 leaderboard (no browser calc)", async () => {
  const s = await tvState(RAW_TOKEN);
  expect(Array.isArray(s.leaderboard)).toBe(true);
  expect(typeof s.window).toBe("string");
  expect(typeof s.config.rotationSec).toBe("number"); // drives the rotation dwell
  // leaderboard rows are the resolved representation — rank + points + name
  for (const r of s.leaderboard) {
    expect(r).toHaveProperty("rank");
    expect(r).toHaveProperty("points");
    expect(r).toHaveProperty("name");
  }
});

test("E–H · office_tv_settings.leaderboard_window actually drives the on-screen window", async () => {
  await conn.query("UPDATE office_tv_settings SET leaderboard_window = 'weekly' WHERE id = 1");
  expect((await tvState(RAW_TOKEN)).window).toBe("weekly");

  await conn.query("UPDATE office_tv_settings SET leaderboard_window = 'monthly' WHERE id = 1");
  expect((await tvState(RAW_TOKEN)).window).toBe("monthly");

  await conn.query("UPDATE office_tv_settings SET leaderboard_window = 'daily' WHERE id = 1");
  expect((await tvState(RAW_TOKEN)).window).toBe("daily");
});

test("I–J · Recent Achievement screen — enriched from the authoritative recognition log + ledger", async () => {
  // a real recognition row (the recognition engine writes these) …
  await conn.query(
    `INSERT INTO office_tv_events (kind, subject_user_id, tier, message, reference_type, reference_id, dedupe_key, operational_date, created_at)
     VALUES ('LEAD_ACCEPTED', ?, 2, NULL, 'lead', 'UAT-P10S3-L1', ?, ?, NOW())`,
    [SUBJECT, DEDUPE, SHIFT],
  );
  // … and its authoritative points in the ACTIVE ledger (inserted directly; the
  // TV only READS this — it never recomputes)
  await conn.query(
    `INSERT INTO gamification_point_transactions
       (user_id, role, process, event, points, operational_date, reference_type, reference_id, dedupe_key, status, source, created_at)
     VALUES (?, 'agent', 'US', 'LEAD_ACCEPTED', 500, ?, 'lead', 'UAT-P10S3-L1', 'UAT-P10S3:txn:L1', 'ACTIVE', 'system', NOW())`,
    [SUBJECT, SHIFT],
  );

  const s = await tvState(RAW_TOKEN);
  const item = s.recent.find((r) => r.kind === "LEAD_ACCEPTED" && r.subjectUserId === SUBJECT);
  expect(item).toBeDefined();
  expect(item!.name).toBe("Rahul Sharma (US)");
  expect(item!.eventLabel).toBe("Lead accepted");
  expect(item!.headline).toBe("LEAD ACCEPTED");
  expect(item!.level).toBe("LEVEL_2");
  expect(item!.points).toBe(500); // from the ledger, not fabricated
});

test("U · a duplicate recognition row is ignored (dedupe key) — no double achievement", async () => {
  const before = await scalar("SELECT COUNT(*) v FROM office_tv_events WHERE dedupe_key = ?", [
    DEDUPE,
  ]);
  await conn
    .query(
      `INSERT INTO office_tv_events (kind, subject_user_id, tier, reference_type, reference_id, dedupe_key, operational_date, created_at)
       VALUES ('LEAD_ACCEPTED', ?, 2, 'lead', 'UAT-P10S3-L1', ?, ?, NOW())`,
      [SUBJECT, DEDUPE, SHIFT],
    )
    .catch(() => undefined); // unique index rejects the duplicate
  expect(
    await scalar("SELECT COUNT(*) v FROM office_tv_events WHERE dedupe_key = ?", [DEDUPE]),
  ).toBe(before);
});

test("L / P–R · celebration + announcement interrupts are delivered on the existing bus", async () => {
  const seq0 = recognitionBus.latestSeq();
  recognitionBus.publish("celebration", {
    kind: "LEAD_ACCEPTED",
    tier: 2,
    celebrationLevel: "LEVEL_2",
    celebrationProfile: { level: "LEVEL_2", particleProfile: "dollar-rain" },
    points: 500,
    subject: { userId: SUBJECT, name: "Rahul Sharma (US)", role: "agent", photoAvailable: false },
  });
  recognitionBus.publish("announcement", {
    kind: "ANNOUNCEMENT",
    announcementId: 999,
    title: "POWER HOUR",
    message: "Attention team!",
    priority: "IMPORTANT",
    durationMs: 12000,
    timeline: { openingAtMs: 0, ttsAtMs: 650, closingAtMs: 11500, celebrationAtMs: null },
    audio: {
      openingSound: "bell",
      closingSound: "bell",
      ttsEnabled: true,
      spokenText: "Attention team!",
      tts: { voiceName: null, rate: 1, pitch: 1, volume: 1, lang: "en-US" },
    },
    celebration: null,
    preview: false,
  });

  const s = await tvState(RAW_TOKEN, { sinceSeq: seq0 });
  const kinds = s.live.items.map((i) => i.type);
  expect(kinds).toContain("celebration");
  expect(kinds).toContain("announcement");
  // the TV drains these into its interrupt queue; the rotation resumes after —
  // proven deterministically by tv-rotation.test.ts (rotationTick + paused).
});
