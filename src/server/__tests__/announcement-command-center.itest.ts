/**
 * Phase 10 · Stage 2 — ANNOUNCEMENT COMMAND CENTER · LIVE dryrun UAT
 * (opt-in, DB-touching). Runs the §21 checklist against `tmi_officeverse_dryrun`.
 *
 * SAFETY: asserts SELECT DATABASE() first. Deletes every office_tv_announcements
 * / celebration_profiles row it creates by id > baseline in afterAll and asserts
 * the max-id baselines are restored. NEVER touches audit_logs (rows are expected
 * to remain). Never creates a scored event / points / office_tv_events row.
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/server/__tests__/announcement-command-center.itest.ts --config vitest.itest.config.ts
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import {
  createAnnouncement,
  listAnnouncements,
  setAnnouncementEnabled,
  updateAnnouncementFields,
} from "../live/service";
import { playAnnouncementNow, previewAnnouncement } from "../live/announcement-ops";
import {
  createCelebrationProfile,
  setCelebrationProfileEnabled,
} from "../live/celebration-profile-service";
import { createPowerHour, startPowerHour } from "../live/power-hour";
import { recognitionBus } from "../live/bus";
import { HttpError } from "../http-error";

const ADMIN = { id: 1, role: "admin" as const, fullName: "UAT Admin" };
const CLOSER = { id: 19, role: "closer" as const, fullName: "Mokam" };
const HR = { id: 2, role: "hr" as const };
const AGENT = { id: 3, role: "agent" as const };

let conn: mysql.Connection;
const base = { ann: 0, prof: 0, evt: 0 };

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
  base.ann = await scalar("SELECT COALESCE(MAX(id),0) v FROM office_tv_announcements");
  base.prof = await scalar("SELECT COALESCE(MAX(id),0) v FROM celebration_profiles");
  base.evt = await scalar("SELECT COALESCE(MAX(id),0) v FROM office_tv_events");
});

afterAll(async () => {
  if (!conn) return;
  await conn.query("DELETE FROM office_tv_announcements WHERE id > ?", [base.ann]);
  await conn.query("DELETE FROM celebration_profiles WHERE id > ?", [base.prof]);
  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM office_tv_announcements")).toBe(base.ann);
  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM celebration_profiles")).toBe(base.prof);
  // Play-on-TV must NEVER create an office_tv_events row
  expect(await scalar("SELECT COALESCE(MAX(id),0) v FROM office_tv_events")).toBe(base.evt);
  await conn.end();
});

let annId = 0;
let profileId = 0;

test("1–3 · Admin creates an announcement — it starts DISABLED — then enables it", async () => {
  const { id } = await createAnnouncement(ADMIN, {
    title: "POWER HOUR",
    message: "Attention team! Power Hour starts now. Double points for 60 minutes.",
    priority: "IMPORTANT",
    ttsEnabled: true,
    ttsConfig: { voiceName: null, rate: 1, pitch: 1, volume: 1, lang: "en-US" },
    openingSound: "bell",
    closingSound: "bell",
    publishNow: false,
  });
  annId = id;
  expect(await scalar("SELECT enabled v FROM office_tv_announcements WHERE id = ?", [id])).toBe(0);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'ANNOUNCEMENT_CREATED' AND entity_id = ? AND actor_user_id = 1",
      [id],
    ),
  ).toBe(1);

  await setAnnouncementEnabled(ADMIN, id, true);
  expect(await scalar("SELECT enabled v FROM office_tv_announcements WHERE id = ?", [id])).toBe(1);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'ANNOUNCEMENT_ENABLED' AND entity_id = ?",
      [id],
    ),
  ).toBe(1);
});

test("4–5 · Preview resolves the full sequence and creates NO production TV event / audit", async () => {
  const seqBefore = recognitionBus.latestSeq();
  const audBefore = await scalar("SELECT COUNT(*) v FROM audit_logs");
  const { payload } = await previewAnnouncement(CLOSER, annId);
  const p = payload as Record<string, unknown>;
  expect(p["kind"]).toBe("ANNOUNCEMENT");
  expect(p["preview"]).toBe(true);
  const audio = p["audio"] as { openingSound: string; closingSound: string; spokenText: string };
  expect(audio.openingSound).toBe("bell");
  expect(audio.closingSound).toBe("bell");
  expect(audio.spokenText).toContain("Power Hour"); // 10 · TTS payload
  const tl = p["timeline"] as { openingAtMs: number; ttsAtMs: number; closingAtMs: number };
  expect(tl.openingAtMs).toBe(0); // 11 · opening bell first
  expect(tl.ttsAtMs).toBeGreaterThan(tl.openingAtMs); // pause → TTS
  expect(tl.closingAtMs).toBeGreaterThan(tl.ttsAtMs); // 12 · closing bell last
  expect(recognitionBus.latestSeq()).toBe(seqBefore); // nothing published
  expect(await scalar("SELECT COUNT(*) v FROM audit_logs")).toBe(audBefore); // no audit for preview
});

test("6–8 · Play on TV → exactly one bus command, audited, no TV DB row", async () => {
  const seqBefore = recognitionBus.latestSeq();
  const evtBefore = await scalar("SELECT COUNT(*) v FROM office_tv_events");
  const { seq } = await playAnnouncementNow(CLOSER, annId);
  expect(seq).toBe(seqBefore + 1); // exactly one
  const item = recognitionBus.since(seqBefore).at(-1);
  expect(item?.type).toBe("announcement");
  expect((item?.data as { kind?: string }).kind).toBe("ANNOUNCEMENT");
  expect(await scalar("SELECT COUNT(*) v FROM office_tv_events")).toBe(evtBefore); // no persisted TV row
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'ANNOUNCEMENT_PLAYED' AND entity_id = ? AND actor_user_id = ?",
      [annId, CLOSER.id],
    ),
  ).toBe(1);

  // 18 · Play again — an explicit operator action MAY repeat (a 2nd bus item + 2nd audit)
  const again = await playAnnouncementNow(CLOSER, annId);
  expect(again.seq).toBe(seq + 1);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'ANNOUNCEMENT_PLAYED' AND entity_id = ?",
      [annId],
    ),
  ).toBe(2);
});

test("9 · edit — TTS config + optional celebration profile persist and reach the payload", async () => {
  const prof = await createCelebrationProfile(CLOSER, {
    name: "UAT P10S2 announcement visual",
    recognitionLevel: "LEVEL_2",
    triggerEvent: "MANUAL",
    config: {
      effects: { confetti: true, dollarRain: true },
      sound: { opening: "none", closing: "none" },
    },
  });
  profileId = prof.id;
  await setCelebrationProfileEnabled(CLOSER, profileId, true);

  await updateAnnouncementFields(ADMIN, annId, {
    title: "POWER HOUR",
    message: "Great job {employeeName}! Power Hour is now active.",
    priority: "URGENT",
    ttsEnabled: true,
    ttsConfig: { voiceName: "Daniel", rate: 1.2, pitch: 0.9, volume: 1, lang: "en-GB" },
    openingSound: "bell",
    closingSound: "victory",
    celebrationProfileId: profileId,
  });
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'ANNOUNCEMENT_UPDATED' AND entity_id = ?",
      [annId],
    ),
  ).toBe(1);

  const { payload } = await previewAnnouncement(ADMIN, annId);
  const p = payload as Record<string, unknown>;
  const audio = p["audio"] as {
    tts: { rate: number; lang: string };
    closingSound: string;
    spokenText: string;
  };
  expect(audio.tts.rate).toBe(1.2);
  expect(audio.tts.lang).toBe("en-GB");
  expect(audio.closingSound).toBe("victory");
  expect(audio.spokenText).not.toMatch(/[{}]/); // placeholder interpolated + sanitised
  expect(p["celebration"]).not.toBeNull(); // the optional mid-sequence visual is attached
  const tl = p["timeline"] as { celebrationAtMs: number | null };
  expect(typeof tl.celebrationAtMs).toBe("number");
});

test("13–14 · Closer can operate the command center", async () => {
  const { rows } = await listAnnouncements(CLOSER);
  expect(rows.some((r) => r.id === annId)).toBe(true);
  await expect(setAnnouncementEnabled(CLOSER, annId, false)).resolves.toMatchObject({ ok: true });
  await setAnnouncementEnabled(CLOSER, annId, true);
});

test("15–16 · Agent + HR cannot operate the command center (403)", async () => {
  for (const u of [AGENT, HR]) {
    await expect(listAnnouncements(u)).rejects.toMatchObject({ status: 403 });
    await expect(previewAnnouncement(u, annId)).rejects.toBeInstanceOf(HttpError);
    await expect(playAnnouncementNow(u, annId)).rejects.toMatchObject({ status: 403 });
  }
});

test("17 · Power Hour reuses the announcement layer (POWER_HOUR_ANNOUNCEMENT_TRIGGERED)", async () => {
  const ph = await createPowerHour(CLOSER, {
    title: "POWER HOUR",
    message: "Attention team! Power Hour is now active.",
    startsAt: "2026-09-01 10:00",
    endsAt: "2026-09-01 11:00",
  });
  const seqBefore = recognitionBus.latestSeq();
  await startPowerHour(CLOSER, ph.id);
  const items = recognitionBus.since(seqBefore);
  expect(items.some((i) => i.type === "announcement")).toBe(true);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM audit_logs WHERE action = 'POWER_HOUR_ANNOUNCEMENT_TRIGGERED' AND entity_id = ?",
      [ph.id],
    ),
  ).toBe(1);
  // scoring is untouched — no points row was written by any of the above
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM gamification_point_transactions WHERE dedupe_key LIKE 'UAT-P10S2%'",
    ),
  ).toBe(0);
});
