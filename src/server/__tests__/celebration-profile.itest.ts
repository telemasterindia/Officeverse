/**
 * Phase 10 · Stage 1 — CELEBRATION PROFILE · LIVE dryrun UAT (opt-in, DB-touching).
 *
 * Proves the operator control surface end to end against `tmi_officeverse_dryrun`:
 *   - Closer creates a profile (created disabled) + audit CELEBRATION_PROFILE_CREATED
 *   - enable it + audit CELEBRATION_PROFILE_ENABLED
 *   - pickCelebrationProfileForTrigger("LEAD_ACCEPTED") returns it → the payload
 *     the recognition bridge would publish carries the composed effects
 *   - playCelebrationProfile publishes ONE synthetic celebration to the bus
 *     (no office_tv_events row, no ledger row) + audit CELEBRATION_PLAYED
 *   - preview resolves the renderer payload without publishing
 *
 * SAFETY: asserts SELECT DATABASE() first. Deletes every celebration_profiles
 * row it creates by id > baseline in afterAll and asserts the max-id baseline is
 * restored. NEVER touches audit_logs (its rows are expected to remain).
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/server/__tests__/celebration-profile.itest.ts --config vitest.itest.config.ts
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import {
  createCelebrationProfile,
  playCelebrationProfile,
  previewCelebrationProfile,
  setCelebrationProfileEnabled,
  pickCelebrationProfileForTrigger,
} from "../live/celebration-profile-service";
import { buildCelebrationPayload } from "../live/celebration-profile";
import { recognitionBus } from "../live/bus";

const CLOSER = { id: 19, role: "closer" as const, fullName: "Mokam" };
let conn: mysql.Connection;
let baseId = 0;

const scalar = async (sql: string, args: unknown[] = []): Promise<number> => {
  const [rows] = (await conn.query(sql, args)) as [Record<string, unknown>[], unknown];
  return Number(Object.values(rows[0] ?? { v: 0 })[0]);
};

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const dbName = (
    (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown]
  )[0][0]!.v;
  if (dbName !== "tmi_officeverse_dryrun") {
    throw new Error(`REFUSING TO RUN — DATABASE() is "${dbName}", expected tmi_officeverse_dryrun`);
  }
  baseId = await scalar("SELECT COALESCE(MAX(id),0) v FROM celebration_profiles");
});

afterAll(async () => {
  if (!conn) return;
  await conn.query("DELETE FROM celebration_profiles WHERE id > ?", [baseId]);
  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM celebration_profiles")).toBe(baseId);
  await conn.end();
});

const draft = {
  name: "UAT P10 Level 2 dollar rain",
  recognitionLevel: "LEVEL_2" as const,
  triggerEvent: "LEAD_ACCEPTED" as const,
  priority: 10,
  config: {
    durationMs: 5200,
    intensity: "high",
    effects: { confetti: true, colourParticles: true, lightBurst: true, dollarRain: true },
    show: { photo: true, name: true, achievementText: true, points: true, incentive: false },
    sound: { opening: "bell", closing: "chime" },
    tts: {
      enabled: true,
      template: "Attention team! {employeeName} has just accepted a lead.",
      rate: 1,
      pitch: 1,
      volume: 1,
      lang: "en-US",
    },
    achievementText: "LEAD ACCEPTED",
  },
};

let profileId = 0;

test("Closer creates a profile — created DISABLED, audited", async () => {
  const { id } = await createCelebrationProfile(CLOSER, draft);
  profileId = id;
  expect(await scalar("SELECT enabled v FROM celebration_profiles WHERE id = ?", [id])).toBe(0);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'CELEBRATION_PROFILE_CREATED' AND entity_id = ? AND actor_user_id = ? AND actor_role = 'closer'",
      [id, CLOSER.id],
    ),
  ).toBe(1);

  // a disabled profile is NOT picked for its trigger yet
  expect(await pickCelebrationProfileForTrigger("LEAD_ACCEPTED")).toBeNull();
});

test("enable → the profile drives the LEAD_ACCEPTED celebration the bridge would publish", async () => {
  await setCelebrationProfileEnabled(CLOSER, profileId, true);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'CELEBRATION_PROFILE_ENABLED' AND entity_id = ?",
      [profileId],
    ),
  ).toBe(1);

  const picked = await pickCelebrationProfileForTrigger("LEAD_ACCEPTED");
  expect(picked).not.toBeNull();
  expect(picked!.level).toBe("LEVEL_2");

  const payload = buildCelebrationPayload({
    config: picked!.config,
    level: picked!.level,
    kind: "LEAD_ACCEPTED",
    employeeName: "Amit",
    employeePhotoRef: "7",
    headline: "LEAD ACCEPTED",
    points: 500, // authoritative scoring points — passed through, never computed here
  });
  expect(payload["particleProfile"]).toBe("dollar-rain");
  expect(payload["durationMs"]).toBe(5200);
  expect(payload["audioProfile"]).toBe("level2-broadcast"); // bell + TTS → broadcast cue
  expect(payload["points"]).toBe(500);
  expect((payload["effects"] as Record<string, boolean>)["dollarRain"]).toBe(true);
});

test("preview resolves the renderer payload without publishing", async () => {
  const seqBefore = recognitionBus.latestSeq();
  const { payload } = await previewCelebrationProfile(CLOSER, profileId);
  expect((payload as Record<string, unknown>)["preview"]).toBe(true);
  expect((payload as Record<string, unknown>)["particleProfile"]).toBe("dollar-rain");
  expect(recognitionBus.latestSeq()).toBe(seqBefore); // nothing published
});

test("Play on TV — one synthetic celebration on the bus, no ledger / office_tv_events row, audited", async () => {
  const seqBefore = recognitionBus.latestSeq();
  const evtBefore = await scalar("SELECT COUNT(*) v FROM office_tv_events");
  const { seq } = await playCelebrationProfile(CLOSER, { id: profileId, employeeName: "Amit" });
  expect(seq).toBe(seqBefore + 1);
  expect(await scalar("SELECT COUNT(*) v FROM office_tv_events")).toBe(evtBefore); // no persisted row
  const item = recognitionBus.since(seqBefore).at(-1);
  expect(item?.type).toBe("celebration");
  expect((item?.data as { points?: number }).points).toBe(0); // play is demo-only, never points
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'CELEBRATION_PLAYED' AND entity_id = ? AND actor_user_id = ?",
      [profileId, CLOSER.id],
    ),
  ).toBe(1);
});
