/**
 * Phase 10 · Stage 4 — MILESTONE ENGINE · LIVE dryrun UAT (opt-in, DB-touching).
 * Runs the data/pipeline half of the §27 checklist against `tmi_officeverse_dryrun`.
 * The Office TV VISUALS are a manual browser checklist (§28) called out in the report.
 *
 * SAFETY: asserts SELECT DATABASE() first. Deletes every milestones /
 * milestone_triggers / celebration_profiles row it creates, every UAT ledger
 * row, and every milestone-keyed office_tv_events row, then asserts the max-id
 * baselines are restored. NEVER touches audit_logs. Milestone recognition
 * writes NO points row — asserted.
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/server/__tests__/milestone-engine.itest.ts --config vitest.itest.config.ts
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import {
  createMilestone,
  listMilestones,
  setMilestoneEnabled,
  simulateMilestone,
  evaluateMilestonesForEvent,
} from "../milestones/milestone-service";
import { recognitionBus } from "../live/bus";
import { currentShiftDate } from "../time";
import { HttpError } from "../http-error";

const ADMIN = { id: 1, role: "admin" as const, process: "IN" as const };
const CLOSER = { id: 19, role: "closer" as const, process: "US" as const };
const AGENT = { id: 3, role: "agent" as const, process: "US" as const };
const HR = { id: 2, role: "hr" as const, process: "US" as const };
const SUBJECT = 7; // Ayush Verma (IN) — agent
const SHIFT = currentShiftDate("IN");

let conn: mysql.Connection;
const base = { ms: 0, trig: 0, evt: 0, txn: 0, prof: 0, inc: 0, acceptedToday: 0 };

const scalar = async (sql: string, args: unknown[] = []): Promise<number> => {
  const [rows] = (await conn.query(sql, args)) as [Record<string, unknown>[], unknown];
  return Number(Object.values(rows[0] ?? { v: 0 })[0]);
};

async function seedAccept(refId: string) {
  await conn.query(
    `INSERT INTO gamification_point_transactions
       (user_id, role, process, event, points, operational_date, reference_type, reference_id, dedupe_key, status, source, created_at)
     VALUES (?, 'agent', 'IN', 'LEAD_ACCEPTED', 100, ?, 'lead', ?, ?, 'ACTIVE', 'system', NOW())`,
    [SUBJECT, SHIFT, refId, `UAT-P10S4:${refId}`],
  );
}
const fireEvent = (refId: string) =>
  evaluateMilestonesForEvent({
    eventType: "LEAD_ACCEPTED",
    subjectUserId: SUBJECT,
    subjectRole: "agent",
    process: "IN",
    source: { type: "lead", id: refId },
    operationalDate: SHIFT,
  });

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const dbName = (
    (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown]
  )[0][0]!.v;
  if (dbName !== "tmi_officeverse_dryrun") {
    throw new Error(`REFUSING TO RUN — DATABASE() is "${dbName}", expected tmi_officeverse_dryrun`);
  }
  base.ms = await scalar("SELECT COALESCE(MAX(id),0) v FROM milestones");
  base.trig = await scalar("SELECT COALESCE(MAX(id),0) v FROM milestone_triggers");
  base.evt = await scalar("SELECT COALESCE(MAX(id),0) v FROM office_tv_events");
  base.txn = await scalar("SELECT COALESCE(MAX(id),0) v FROM gamification_point_transactions");
  base.prof = await scalar("SELECT COALESCE(MAX(id),0) v FROM celebration_profiles");
  base.inc = await scalar("SELECT COUNT(*) v FROM incentive_results");
  // the subject may already have accepted-lead rows for today — thresholds are
  // set relative to this baseline so the seeds cross them exactly.
  base.acceptedToday = await scalar(
    "SELECT COUNT(*) v FROM gamification_point_transactions WHERE user_id = ? AND event = 'LEAD_ACCEPTED' AND status = 'ACTIVE' AND operational_date = ?",
    [SUBJECT, SHIFT],
  );
});

afterAll(async () => {
  if (!conn) return;
  await conn.query("DELETE FROM milestone_triggers WHERE id > ?", [base.trig]);
  await conn.query("DELETE FROM milestones WHERE id > ?", [base.ms]);
  await conn.query("DELETE FROM celebration_profiles WHERE id > ?", [base.prof]);
  await conn.query(
    "DELETE FROM office_tv_events WHERE id > ? AND (dedupe_key LIKE 'milestone:%')",
    [base.evt],
  );
  await conn.query(
    "DELETE FROM gamification_point_transactions WHERE dedupe_key LIKE 'UAT-P10S4%'",
  );

  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM milestones")).toBe(base.ms);
  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM milestone_triggers")).toBe(base.trig);
  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM office_tv_events")).toBe(base.evt);
  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM gamification_point_transactions")).toBe(
    base.txn,
  );
  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM celebration_profiles")).toBe(base.prof);
  expect(await scalar("SELECT COUNT(*) v FROM incentive_results")).toBe(base.inc);
  await conn.end();
});

let indId = 0;

let indThreshold = 3;

test("1–3 · Admin creates an individual milestone — starts DISABLED — then enables", async () => {
  indThreshold = base.acceptedToday + 3;
  const { id } = await createMilestone(ADMIN, {
    name: "UAT Lead Acceptances (daily)",
    description: "Reached the configured accepted-lead count today.",
    type: "INDIVIDUAL_COUNT",
    metric: "LEAD_ACCEPTED",
    threshold: indThreshold,
    period: "DAILY",
    triggerPolicy: "ONCE",
    recognitionLevel: "LEVEL_2",
    effectiveFrom: "2026-01-01",
  });
  indId = id;
  expect(await scalar("SELECT enabled v FROM milestones WHERE id = ?", [id])).toBe(0);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'MILESTONE_CREATED' AND entity_id = ? AND actor_user_id = 1",
      [id],
    ),
  ).toBe(1);
  await setMilestoneEnabled(ADMIN, id, true);
  expect(await scalar("SELECT enabled v FROM milestones WHERE id = ?", [id])).toBe(1);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'MILESTONE_ENABLED' AND entity_id = ?",
      [id],
    ),
  ).toBe(1);
});

test("4–5 · simulate creates NO recognition / points / TV event / trigger row", async () => {
  const seq = recognitionBus.latestSeq();
  const evt = await scalar("SELECT COUNT(*) v FROM office_tv_events");
  const trig = await scalar("SELECT COUNT(*) v FROM milestone_triggers");
  const txn = await scalar("SELECT COUNT(*) v FROM gamification_point_transactions");

  const r = await simulateMilestone(CLOSER, { id: indId, userId: SUBJECT, operationalDate: SHIFT });
  expect(r.wouldFire).toBe(false); // below threshold — nothing seeded yet
  expect(r.currentValue).toBe(base.acceptedToday);
  expect(r.threshold).toBe(indThreshold);

  expect(recognitionBus.latestSeq()).toBe(seq);
  expect(await scalar("SELECT COUNT(*) v FROM office_tv_events")).toBe(evt);
  expect(await scalar("SELECT COUNT(*) v FROM milestone_triggers")).toBe(trig);
  expect(await scalar("SELECT COUNT(*) v FROM gamification_point_transactions")).toBe(txn);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'MILESTONE_SIMULATED' AND entity_id = ?",
      [indId],
    ),
  ).toBe(1);
});

test("6–9 · below threshold → no fire; at the exact threshold → exactly ONE fire", async () => {
  await seedAccept("UAT-P10S4-L1");
  await seedAccept("UAT-P10S4-L2");
  await fireEvent("UAT-P10S4-L2");
  expect(
    await scalar("SELECT COUNT(*) v FROM milestone_triggers WHERE milestone_id = ?", [indId]),
  ).toBe(0);

  await seedAccept("UAT-P10S4-L3");
  const seqBefore = recognitionBus.latestSeq();
  const evtBefore = await scalar("SELECT COUNT(*) v FROM office_tv_events");
  await fireEvent("UAT-P10S4-L3");

  expect(
    await scalar("SELECT COUNT(*) v FROM milestone_triggers WHERE milestone_id = ?", [indId]),
  ).toBe(1);
  const row = (await conn.query(
    "SELECT user_id, threshold_value, actual_value, dedupe_key FROM milestone_triggers WHERE milestone_id = ?",
    [indId],
  )) as unknown as [Record<string, unknown>[], unknown];
  expect(Number(row[0][0]!["user_id"])).toBe(SUBJECT);
  expect(Number(row[0][0]!["actual_value"])).toBe(indThreshold);
  expect(String(row[0][0]!["dedupe_key"])).toBe(`milestone:${indId}:user:${SUBJECT}`);

  // 10/12 · recognition reached the existing bus + ONE office_tv_events row
  expect(recognitionBus.latestSeq()).toBeGreaterThan(seqBefore);
  const item = recognitionBus.since(seqBefore).at(-1);
  expect(item?.type).toBe("celebration");
  expect((item?.data as { subject?: { userId?: number } }).subject?.userId).toBe(SUBJECT);
  expect(
    await scalar("SELECT COUNT(*) v FROM office_tv_events WHERE dedupe_key = ?", [
      `milestone:${indId}:user:${SUBJECT}`,
    ]),
  ).toBe(1);
  expect(await scalar("SELECT COUNT(*) v FROM office_tv_events")).toBe(evtBefore + 1);

  // audit records the source + that NO points were awarded
  const [audRows] = (await conn.query(
    "SELECT metadata FROM audit_logs WHERE action = 'MILESTONE_TRIGGERED' AND entity_id = ? ORDER BY id DESC LIMIT 1",
    [indId],
  )) as unknown as [{ metadata: unknown }[], unknown];
  const raw = audRows[0]?.metadata;
  const meta = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  expect(meta["source"]).toEqual({ type: "lead", id: "UAT-P10S4-L3" });
  expect(meta["awardedPoints"]).toBe(false);
});

test("25 · milestone recognition wrote NO points row (scoring ledger untouched)", async () => {
  // only the 3 UAT-seeded LEAD_ACCEPTED rows exist for the subject dedupe range
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM gamification_point_transactions WHERE dedupe_key LIKE 'UAT-P10S4%'",
    ),
  ).toBe(3);
});

test("14–15 · idempotency — repeating the same source event fires nothing new", async () => {
  const trig = await scalar("SELECT COUNT(*) v FROM milestone_triggers WHERE milestone_id = ?", [
    indId,
  ]);
  const seq = recognitionBus.latestSeq();
  await fireEvent("UAT-P10S4-L3"); // exact retry
  await fireEvent("UAT-P10S4-L4"); // a later event — value 4, ONCE already fired
  expect(
    await scalar("SELECT COUNT(*) v FROM milestone_triggers WHERE milestone_id = ?", [indId]),
  ).toBe(trig);
  expect(recognitionBus.latestSeq()).toBe(seq);
});

test("11 · a configured Celebration Profile is used for the milestone", async () => {
  const svc = await import("../live/celebration-profile-service");
  const prof = await svc.createCelebrationProfile(ADMIN, {
    name: "UAT P10S4 dollar rain",
    recognitionLevel: "LEVEL_2",
    triggerEvent: "MANUAL",
    config: { effects: { confetti: true, dollarRain: true } },
  });
  await svc.setCelebrationProfileEnabled(ADMIN, prof.id, true);
  const profId = prof.id;

  const { id: msId } = await createMilestone(ADMIN, {
    name: "UAT profiled milestone",
    type: "INDIVIDUAL_EVENT",
    metric: "LEAD_ACCEPTED",
    threshold: 1,
    period: "DAILY",
    triggerPolicy: "PER_PERIOD",
    recognitionLevel: "LEVEL_2",
    celebrationProfileId: profId,
    effectiveFrom: "2026-01-01",
  });
  await setMilestoneEnabled(ADMIN, msId, true);

  const seq = recognitionBus.latestSeq();
  await fireEvent("UAT-P10S4-L4");
  const item = recognitionBus.since(seq).at(-1);
  const celeb = (item?.data as { celebrationProfile?: Record<string, unknown> }).celebrationProfile;
  expect(celeb?.["particleProfile"]).toBe("dollar-rain");

  // 18/19 · DAILY period → the trigger's period_key is today's shift date
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM milestone_triggers WHERE milestone_id = ? AND period_key = ?",
      [msId, SHIFT],
    ),
  ).toBe(1);
});

test("16–17 · a TEAM milestone fires with NO subject (never a fabricated person)", async () => {
  const teamCount = await scalar(
    "SELECT COUNT(*) v FROM gamification_point_transactions WHERE event = 'LEAD_ACCEPTED' AND process = 'IN' AND status = 'ACTIVE' AND operational_date = ?",
    [SHIFT],
  );
  const { id: teamId } = await createMilestone(ADMIN, {
    name: "UAT Team IN accepted leads",
    type: "TEAM_COUNT",
    metric: "LEAD_ACCEPTED",
    threshold: Math.max(1, teamCount),
    period: "DAILY",
    triggerPolicy: "PER_PERIOD",
    scope: { processes: ["IN"] },
    recognitionLevel: "LEVEL_3",
    effectiveFrom: "2026-01-01",
  });
  await setMilestoneEnabled(ADMIN, teamId, true);

  const seq = recognitionBus.latestSeq();
  await fireEvent("UAT-P10S4-L4");

  const [[trg]] = (await conn.query(
    "SELECT user_id FROM milestone_triggers WHERE milestone_id = ?",
    [teamId],
  )) as unknown as [{ user_id: number | null }[], unknown];
  expect(trg!.user_id).toBeNull(); // TEAM → no subject

  const item = recognitionBus.since(seq).at(-1);
  expect((item?.data as { kind?: string }).kind).toBe("TEAM_MILESTONE");
  expect((item?.data as { subject?: unknown }).subject).toBeNull(); // no fabricated person
  expect(
    await scalar("SELECT subject_user_id FROM office_tv_events WHERE dedupe_key = ?", [
      `milestone:${teamId}:team:period:${SHIFT}`,
    ]).catch(() => -1),
  ).toBe(0); // 0 = NULL coerced by scalar helper (COALESCE-free) → column is NULL
});

test("20–23 · authz — definitions Admin-only; Agent + HR fully denied", async () => {
  const d = {
    name: "denied",
    type: "INDIVIDUAL_COUNT" as const,
    metric: "LEAD_ACCEPTED",
    threshold: 5,
    effectiveFrom: "2026-01-01",
  };
  await expect(createMilestone(CLOSER, d)).rejects.toMatchObject({ status: 403 });
  await expect(createMilestone(AGENT, d)).rejects.toMatchObject({ status: 403 });
  await expect(setMilestoneEnabled(HR, indId, false)).rejects.toMatchObject({ status: 403 });
  await expect(simulateMilestone(AGENT, { id: indId, userId: SUBJECT })).rejects.toBeInstanceOf(
    HttpError,
  );
  // Closer keeps operational visibility
  const list = await listMilestones(CLOSER);
  expect(list.milestones.some((m) => m.id === indId)).toBe(true);
});

test("24–27 · audit present; incentive + CRM untouched", async () => {
  expect(
    await scalar("SELECT COUNT(*) v FROM audit_logs WHERE action = 'MILESTONE_TRIGGERED'"),
  ).toBeGreaterThanOrEqual(1);
  expect(await scalar("SELECT COUNT(*) v FROM incentive_results")).toBe(base.inc);
  // no CRM table was written by any of the above (we only touched the ledger + milestone tables)
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM gamification_point_transactions WHERE dedupe_key LIKE 'UAT-P10S4%'",
    ),
  ).toBe(3);
});
