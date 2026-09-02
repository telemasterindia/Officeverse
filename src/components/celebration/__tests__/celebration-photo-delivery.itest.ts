/**
 * Phase 6 — LIVE dryrun UAT (opt-in, DB-touching).
 *
 * Verifies the ONE new server behaviour Phase 6 introduced: `tv-service.tvState`
 * injects the celebration subject's REAL official photo (a token-authed data
 * URL, via the EXISTING Office-TV photo path) onto `live.items[].data.subject`
 * — and that the frozen Phase-5 payload then maps cleanly through
 * `toCelebrationInput` into the cinematic scene view model.
 *
 * SAFETY: uses only `tmi_officeverse_dryrun`; asserts `SELECT DATABASE()` first;
 * writes exactly ONE throwaway `office_tv_displays` row (no audit row) and
 * deletes it by its exact id; never touches audit_logs / business data; never
 * sets SCORING_ENGINE_ENABLED; never submits a lead or runs the scoring engine.
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/components/celebration/__tests__/celebration-photo-delivery.itest.ts \
 *     --exclude '**\/node_modules/**'
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import { recognitionBus } from "@/server/live/bus";
import { tvState } from "@/server/live/tv-service";
import { toCelebrationInput } from "@/components/celebration/celebration-visuals";

const RAW_TOKEN = "ovtv_uat_phase6_" + "x".repeat(40); // >= 16 chars, deterministic
const tokenHash = createHash("sha256").update(RAW_TOKEN).digest("hex");

let conn: mysql.Connection;
let tempDisplayId = 0;
let baselineDisplayCount = 0;

const celebPayload = (userId: number, name: string, photoRef: string | null) => ({
  kind: "LEAD_SUBMITTED",
  tier: 1,
  effect: "ENERGY",
  assetCategory: "none",
  assetId: null,
  hasVideo: false,
  durationMs: 4000,
  headline: "LEAD SUBMITTED",
  subheadline: "High-value debt lead",
  celebrationLevel: "LEVEL_1",
  celebrationProfile: {
    level: "LEVEL_1",
    profile: "standard",
    employeeName: name,
    employeePhotoRef: photoRef,
    headline: "LEAD SUBMITTED",
    subheadline: "High-value debt lead",
    points: 200,
    soundProfile: "chime",
    particleProfile: "confetti-light",
    durationMs: 4000,
  },
  points: 200,
  subject: { userId, name, role: "agent", photoAvailable: photoRef != null },
});

const scalar = async (sql: string): Promise<unknown> => {
  const [rows] = (await conn.query(sql)) as [Record<string, unknown>[], unknown];
  const row = rows[0] ?? {};
  return Object.values(row)[0];
};

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const dbName = await scalar("SELECT DATABASE() AS db");
  if (dbName !== "tmi_officeverse_dryrun") {
    throw new Error(`REFUSING TO RUN — DATABASE() is "${dbName}", expected tmi_officeverse_dryrun`);
  }

  baselineDisplayCount = Number(await scalar("SELECT COUNT(*) AS n FROM office_tv_displays"));

  // one throwaway read-only display token — inserted directly (no audit row)
  const [res] = (await conn.query(
    "INSERT INTO office_tv_displays (name, token_hash, token_prefix, scope, enabled, created_at) VALUES (?,?,?,?,?,NOW())",
    ["ZZ_PHASE6_UAT_DELETE_ME", tokenHash, RAW_TOKEN.slice(0, 12), "tv_read", 1],
  )) as [mysql.ResultSetHeader, unknown];
  tempDisplayId = res.insertId;
});

afterAll(async () => {
  if (conn && tempDisplayId > 0) {
    await conn.query("DELETE FROM office_tv_displays WHERE id = ? LIMIT 1", [tempDisplayId]);
    const after = Number(await scalar("SELECT COUNT(*) AS n FROM office_tv_displays"));
    expect(after).toBe(baselineDisplayCount); // baseline restored exactly
  }
  await conn?.end();
});

test("celebration live.items carry the real photo (data URL) or a clean null fallback", async () => {
  const sinceSeq = recognitionBus.latestSeq();

  // user 18 HAS a stored official photo on disk (staff_photos.id 7 → u18/v1.jpg)
  recognitionBus.publish("celebration", celebPayload(18, "UAT Agent Eighteen", "18"));
  // user 3 (AG-90001) has NO photo file → must degrade to null (initials)
  recognitionBus.publish("celebration", celebPayload(3, "UAT Agent Three", "3"));

  const state = await tvState(RAW_TOKEN, { sinceSeq });
  const items = state.live.items.filter((i) => i.type === "celebration");
  expect(items.length).toBe(2);

  const byUser = (uid: number) =>
    items.find((i) => (i.data as { subject?: { userId?: number } }).subject?.userId === uid)
      ?.data as Record<string, unknown> & {
      subject: { photo?: string | null; userId: number };
    };

  const withPhoto = byUser(18);
  const noPhoto = byUser(3);

  // --- the new Phase-6 injection ---
  expect(typeof withPhoto.subject.photo).toBe("string");
  expect(withPhoto.subject.photo as string).toMatch(/^data:image\/[a-z]+;base64,/);
  expect((withPhoto.subject.photo as string).length).toBeGreaterThan(500); // a real image, not a stub
  expect(noPhoto.subject.photo ?? null).toBeNull();

  // --- frozen Phase-5 fields still intact on the wire ---
  expect(withPhoto["celebrationLevel"]).toBe("LEVEL_1");
  expect(withPhoto["points"]).toBe(200);
  expect((withPhoto["celebrationProfile"] as Record<string, unknown>)["employeePhotoRef"]).toBe(
    "18",
  );

  // --- end-to-end: payload → cinematic scene view model ---
  const scene = toCelebrationInput(withPhoto);
  expect(scene.level).toBe("LEVEL_1");
  expect(scene.points).toBe(200);
  expect(scene.durationMs).toBe(4000);
  expect(scene.photoSrc).toBe(withPhoto.subject.photo);
  expect(scene.headline).toBe("LEAD SUBMITTED");
  expect(scene.particleProfile).toBe("confetti-light");
  expect(scene.soundProfile).toBe("chime");

  const sceneNoPhoto = toCelebrationInput(noPhoto);
  expect(sceneNoPhoto.photoSrc).toBeNull(); // scene shows initials, does not crash
  expect(sceneNoPhoto.level).toBe("LEVEL_1");

  console.log(
    "[Phase6 UAT] withPhoto.photoSrc =",
    (withPhoto.subject.photo as string).slice(0, 48) + "…",
    "| bytes(b64) =",
    (withPhoto.subject.photo as string).length,
    "\n[Phase6 UAT] noPhoto.photoSrc  =",
    sceneNoPhoto.photoSrc,
    "\n[Phase6 UAT] scene =",
    JSON.stringify({
      level: scene.level,
      points: scene.points,
      durationMs: scene.durationMs,
      profileName: scene.profileName,
      particleProfile: scene.particleProfile,
      soundProfile: scene.soundProfile,
    }),
  );
});
