/**
 * ADMIN + HR — STAFF PROFILE MANAGEMENT & LIFECYCLE · LIVE dryrun UAT
 * (opt-in, DB-touching). Runs §12 against tmi_officeverse_dryrun.
 *
 * SAFETY: asserts SELECT DATABASE() first. Creates two throwaway staff, one
 * seeded lead + follow-up, and a throwaway session; deletes every one of them
 * in afterAll (children first, then the users → agents/closers cascade). NEVER
 * deletes any pre-existing historical row; never touches audit_logs.
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/server/__tests__/staff-lifecycle.itest.ts --config vitest.itest.config.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import { getDb } from "@/lib/db";
import { followUps } from "@/lib/db/schema";
import type { User } from "@/lib/db/schema";
import {
  createStaff,
  listStaff,
  promoteAgentToCloser,
  removeStaff,
  updateStaffProfile,
} from "@/server/staff/service";
import { setProfilePhoto } from "@/server/hr/photo-service";
import { listAgentRoster, listCloserRoster } from "@/server/db/repos/assignments";
import { listAgentPresence } from "@/server/presence/service";
import { resolveSession } from "@/server/session";
import { currentShiftDate, nowIST } from "@/server/time";

const ADMIN = { id: 1, role: "admin", process: "US" } as unknown as User;
const HR = { id: 2, role: "hr", process: "IN" } as unknown as User;
const AGENT = { id: 3, role: "agent", process: "US" } as unknown as User;
const CLOSER = { id: 5, role: "closer", process: "US" } as unknown as User;

/** PNG header the photo validator can read: signature + IHDR declaring 64×64.
 *  (The validator only sniffs magic bytes + IHDR dimensions — no CRC / IDAT.) */
const PNG = (() => {
  const b = Buffer.alloc(96);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  b.writeUInt32BE(13, 8); // IHDR length
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(64, 16); // width
  b.writeUInt32BE(64, 20); // height
  b[24] = 8; // bit depth
  b[25] = 2; // colour type (truecolour)
  return new Uint8Array(b);
})();

let conn: mysql.Connection;
const suffix = Date.now().toString().slice(-8);
const AGENT_EMAIL = `uat.lc.agent.${suffix}@officeverse.local`;
const CLOSER_EMAIL = `uat.lc.closer.${suffix}@officeverse.local`;

let agentCode = "";
let closerCode = "";
let agentUserId = 0;
let closerUserId = 0;
let agentStaffId = 0; // agents.id
let seededLeadId = 0;
let seededFuId = 0;
let promotedCloserCode = "";
const sessionToken = randomBytes(32).toString("base64url");
const sessionId = createHash("sha256").update(sessionToken).digest("hex");

const scalar = async (sql: string, args: unknown[] = []): Promise<number> => {
  const [r] = (await conn.query(sql, args)) as [Record<string, unknown>[], unknown];
  return Number(Object.values(r[0] ?? { v: 0 })[0]);
};
const str = async (sql: string, args: unknown[] = []): Promise<string | null> => {
  const [r] = (await conn.query(sql, args)) as [Record<string, unknown>[], unknown];
  const v = r[0] ? Object.values(r[0])[0] : null;
  return v == null ? null : String(v);
};

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const db = (
    (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown]
  )[0][0]!.v;
  if (db !== "tmi_officeverse_dryrun") throw new Error(`REFUSING — DATABASE() is "${db}"`);

  const a = await createStaff(ADMIN, {
    kind: "agent",
    full_name: "UAT LC Agent",
    email: AGENT_EMAIL,
    password: "uat-password-1234",
    process: "US",
    joining_date: "2023-03-01",
  });
  agentCode = a.code;
  agentUserId = a.user_id;
  agentStaffId = await scalar("SELECT id v FROM agents WHERE user_id = ?", [agentUserId]);

  const c = await createStaff(ADMIN, {
    kind: "closer",
    full_name: "UAT LC Closer",
    email: CLOSER_EMAIL,
    password: "uat-password-1234",
    process: "US",
  });
  closerCode = c.code;
  closerUserId = c.user_id;

  // seed history that MUST survive promotion + deactivation
  const now = nowIST();
  await conn.query(
    `INSERT INTO leads (lead_code, shift_date, customer_name, phone, phone_normalized, debt_amount,
       agent_id, status, source, created_at, updated_at)
     VALUES (?, ?, 'UAT LC Lead', '+1 (305) 555-0155', '13055550155', '0.00', ?, 'NEW', 'app', ?, ?)`,
    [`TMI_9${suffix.slice(-7).padStart(7, "0")}`, currentShiftDate("US"), agentStaffId, now, now],
  );
  seededLeadId = await scalar("SELECT COALESCE(MAX(id),0) v FROM leads");

  await getDb()
    .insert(followUps)
    .values({
      followUpCode: `FU_${String(90_000_000 + seededLeadId).slice(-8)}`,
      ownerUserId: agentUserId,
      ownerRole: "agent",
      customerName: "UAT LC Lead",
      phone: "+1 (305) 555-0155",
      captureDate: currentShiftDate("US"),
      scheduledAt: now,
      status: "SCHEDULED",
      source: "app",
      createdByUserId: ADMIN.id,
      createdAt: now,
      updatedAt: now,
    } as typeof followUps.$inferInsert);
  seededFuId = await scalar(
    "SELECT COALESCE(MAX(id),0) v FROM follow_ups WHERE owner_user_id = ?",
    [agentUserId],
  );
});

afterAll(async () => {
  await conn.query("DELETE FROM follow_ups WHERE id = ?", [seededFuId]);
  await conn.query("DELETE FROM leads WHERE id = ?", [seededLeadId]);
  await conn.query("DELETE FROM salary_profiles WHERE user_id IN (?, ?)", [
    agentUserId,
    closerUserId,
  ]);
  await conn.query("DELETE FROM staff_photos WHERE user_id IN (?, ?)", [agentUserId, closerUserId]);
  await conn.query("DELETE FROM sessions WHERE user_id IN (?, ?) OR id = ?", [
    agentUserId,
    closerUserId,
    sessionId,
  ]);
  // users → agents / closers / notifications cascade
  await conn.query("DELETE FROM users WHERE id IN (?, ?)", [agentUserId, closerUserId]);
  await conn.end();
});

/* ---------------------------- §12 edits ---------------------------- */

test("Admin edits the Agent profile (name / phone / process / DOB / anniversary); joining date untouched", async () => {
  await updateStaffProfile(ADMIN, {
    kind: "agent",
    code: agentCode,
    full_name: "UAT LC Agent EDITED",
    phone: "999-000",
    process: "IN",
    dob: "1991-04-05",
    anniversary_date: "2024-03-01",
  });
  expect(await str("SELECT full_name v FROM users WHERE id = ?", [agentUserId])).toBe(
    "UAT LC Agent EDITED",
  );
  expect(await str("SELECT phone v FROM users WHERE id = ?", [agentUserId])).toBe("999-000");
  expect(await str("SELECT process v FROM users WHERE id = ?", [agentUserId])).toBe("IN");
  expect(
    await str("SELECT DATE_FORMAT(dob,'%Y-%m-%d') v FROM agents WHERE id = ?", [agentStaffId]),
  ).toBe("1991-04-05");
  expect(
    await str("SELECT DATE_FORMAT(anniversary_date,'%Y-%m-%d') v FROM agents WHERE id = ?", [
      agentStaffId,
    ]),
  ).toBe("2024-03-01");
  // joining date was NOT in the patch → unchanged
  expect(
    await str("SELECT DATE_FORMAT(joining_date,'%Y-%m-%d') v FROM agents WHERE id = ?", [
      agentStaffId,
    ]),
  ).toBe("2023-03-01");
});

test("HR edits the same Agent (DOB) — succeeds", async () => {
  await updateStaffProfile(HR, { kind: "agent", code: agentCode, dob: "1992-01-02" });
  expect(
    await str("SELECT DATE_FORMAT(dob,'%Y-%m-%d') v FROM agents WHERE id = ?", [agentStaffId]),
  ).toBe("1992-01-02");
});

test("Admin + HR edit the Closer profile (DOB / anniversary / name)", async () => {
  await updateStaffProfile(ADMIN, {
    kind: "closer",
    code: closerCode,
    dob: "1988-08-08",
    anniversary_date: "2022-09-01",
  });
  await updateStaffProfile(HR, { kind: "closer", code: closerCode, full_name: "UAT LC Closer HR" });
  expect(
    await str("SELECT DATE_FORMAT(dob,'%Y-%m-%d') v FROM closers WHERE user_id = ?", [
      closerUserId,
    ]),
  ).toBe("1988-08-08");
  expect(
    await str("SELECT DATE_FORMAT(anniversary_date,'%Y-%m-%d') v FROM closers WHERE user_id = ?", [
      closerUserId,
    ]),
  ).toBe("2022-09-01");
  expect(await str("SELECT full_name v FROM users WHERE id = ?", [closerUserId])).toBe(
    "UAT LC Closer HR",
  );
});

test("§4 — impossible dates are rejected server-side", async () => {
  await expect(
    updateStaffProfile(ADMIN, { kind: "agent", code: agentCode, dob: "2024-02-30" }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    updateStaffProfile(ADMIN, { kind: "closer", code: closerCode, anniversary_date: "2023-13-01" }),
  ).rejects.toMatchObject({ status: 400 });
});

test("Salary edit routes to the existing salary-profile model (future-effective); Closer salary rejected", async () => {
  const before = await scalar("SELECT COUNT(*) v FROM salary_profiles WHERE user_id = ?", [
    agentUserId,
  ]);
  await updateStaffProfile(ADMIN, {
    kind: "agent",
    code: agentCode,
    base_salary: 45000,
    salary_effective_from: "2099-01-01",
  });
  expect(
    await scalar("SELECT COUNT(*) v FROM salary_profiles WHERE user_id = ?", [agentUserId]),
  ).toBe(before + 1);
  expect(
    await str(
      "SELECT DATE_FORMAT(effective_from,'%Y-%m-%d') v FROM salary_profiles WHERE user_id = ? ORDER BY id DESC LIMIT 1",
      [agentUserId],
    ),
  ).toBe("2099-01-01");

  await expect(
    updateStaffProfile(ADMIN, { kind: "closer", code: closerCode, base_salary: 1 }),
  ).rejects.toMatchObject({ status: 400 });
});

test("§3 — Admin AND HR can replace the profile photo (existing Phase-19 system)", async () => {
  await setProfilePhoto(ADMIN, { targetUserId: agentUserId, bytes: PNG });
  expect(
    await scalar("SELECT photo_asset_id v FROM users WHERE id = ?", [agentUserId]),
  ).toBeGreaterThan(0);
  const asset1 = await scalar("SELECT photo_asset_id v FROM users WHERE id = ?", [agentUserId]);

  await setProfilePhoto(HR, { targetUserId: closerUserId, bytes: PNG });
  expect(
    await scalar("SELECT photo_asset_id v FROM users WHERE id = ?", [closerUserId]),
  ).toBeGreaterThan(0);

  // the directory now reports photo_available for the agent
  const { staff } = await listStaff(ADMIN, { kind: "agent" });
  expect(staff.find((s) => s.code === agentCode)?.photo_available).toBe(true);
  // replacing again yields a fresh asset id (one authoritative photo per user)
  await setProfilePhoto(ADMIN, { targetUserId: agentUserId, bytes: PNG });
  const asset2 = await scalar("SELECT photo_asset_id v FROM users WHERE id = ?", [agentUserId]);
  expect(asset2).not.toBe(asset1);
});

/* ------------------------ §11 authorization ----------------------- */

test("§11 — HR cannot promote or remove; Agent / Closer cannot do any lifecycle action", async () => {
  await expect(promoteAgentToCloser(HR, agentCode)).rejects.toMatchObject({ status: 403 });
  await expect(removeStaff(HR, { kind: "agent", code: agentCode })).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    updateStaffProfile(AGENT, { kind: "agent", code: agentCode, phone: "x" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    updateStaffProfile(CLOSER, { kind: "closer", code: closerCode, phone: "x" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(promoteAgentToCloser(AGENT, agentCode)).rejects.toMatchObject({ status: 403 });
  await expect(removeStaff(CLOSER, { kind: "closer", code: closerCode })).rejects.toMatchObject({
    status: 403,
  });
});

/* -------------------------- §5/§6 promotion ---------------------- */

test("§5/§6 — promotion moves the employee Agent → Closer and preserves ALL history", async () => {
  const leadsBefore = await scalar("SELECT COUNT(*) v FROM leads WHERE agent_id = ?", [
    agentStaffId,
  ]);
  const fuBefore = await scalar("SELECT COUNT(*) v FROM follow_ups WHERE owner_user_id = ?", [
    agentUserId,
  ]);

  const res = await promoteAgentToCloser(ADMIN, agentCode);
  promotedCloserCode = res.closer_code;
  expect(res.new_role).toBe("closer");
  expect(res.leads_moved).toBe(0);
  expect(res.followups_moved).toBe(0);

  // users.role flipped; same users.id; historical agents row kept
  expect(await str("SELECT role v FROM users WHERE id = ?", [agentUserId])).toBe("closer");
  expect(await scalar("SELECT COUNT(*) v FROM agents WHERE user_id = ?", [agentUserId])).toBe(1);
  expect(await scalar("SELECT COUNT(*) v FROM closers WHERE user_id = ?", [agentUserId])).toBe(1);

  // gone from EVERY agent-facing surface …
  const agentDir = await listStaff(ADMIN, { kind: "agent" });
  expect(agentDir.staff.some((s) => s.code === agentCode)).toBe(false);
  expect((await listAgentRoster()).some((r) => r.userId === agentUserId)).toBe(false);
  const presence = await listAgentPresence();
  expect(presence.agents.some((p) => p.agentCode === agentCode)).toBe(false);

  // … present on closer surfaces
  const closerDir = await listStaff(ADMIN, { kind: "closer" });
  expect(closerDir.staff.some((s) => s.user_id === agentUserId)).toBe(true);
  expect((await listCloserRoster()).some((r) => r.userId === agentUserId)).toBe(true);

  // history untouched — the lead still points at the same historical agents.id
  expect(await scalar("SELECT COUNT(*) v FROM leads WHERE agent_id = ?", [agentStaffId])).toBe(
    leadsBefore,
  );
  expect(
    await scalar("SELECT COUNT(*) v FROM follow_ups WHERE owner_user_id = ?", [agentUserId]),
  ).toBe(fuBefore);
  expect(await str("SELECT owner_role v FROM follow_ups WHERE id = ?", [seededFuId])).toBe("agent");
});

/* ------------------------- §8/§9 remove ------------------------- */

test("§8/§9 — Admin remove = deactivation: login blocked, sessions revoked, ZERO rows deleted", async () => {
  // a live session for the (now-closer) UAT employee
  const wall = (msFromNow: number) =>
    new Date(Date.now() + 5.5 * 3_600_000 + msFromNow).toISOString().slice(0, 19).replace("T", " ");
  await conn.query(
    "INSERT INTO sessions (id,user_id,created_at,last_seen_at,expires_at,ip,user_agent,revoked_at,origin_ip,office_network_id,attendance_eligible) VALUES (?,?,?,?,?,?,?,NULL,?,NULL,0)",
    [sessionId, agentUserId, wall(0), wall(0), wall(6 * 3_600_000), "127.0.0.1", "uat-lc", null],
  );
  expect(await resolveSession(sessionToken)).not.toBeNull();

  const usersBefore = await scalar("SELECT COUNT(*) v FROM users");
  const closersBefore = await scalar("SELECT COUNT(*) v FROM closers");
  const leadsBefore = await scalar("SELECT COUNT(*) v FROM leads");
  const fuBefore = await scalar("SELECT COUNT(*) v FROM follow_ups");

  const res = await removeStaff(ADMIN, { kind: "closer", code: promotedCloserCode });
  expect(res.model).toBe("deactivated");
  expect(res.sessions_revoked).toBe(true);

  // status flipped, session dead
  expect(await str("SELECT status v FROM users WHERE id = ?", [agentUserId])).toBe("inactive");
  expect(await resolveSession(sessionToken)).toBeNull();

  // NOTHING deleted
  expect(await scalar("SELECT COUNT(*) v FROM users")).toBe(usersBefore);
  expect(await scalar("SELECT COUNT(*) v FROM closers")).toBe(closersBefore);
  expect(await scalar("SELECT COUNT(*) v FROM leads")).toBe(leadsBefore);
  expect(await scalar("SELECT COUNT(*) v FROM follow_ups")).toBe(fuBefore);
  expect(await scalar("SELECT COUNT(*) v FROM agents WHERE user_id = ?", [agentUserId])).toBe(1);

  // gone from operational lists, still resolvable in the directory (badged)
  expect(
    (await listStaff(ADMIN, { kind: "closer", activeOnly: true })).staff.some(
      (s) => s.user_id === agentUserId,
    ),
  ).toBe(false);
  const dir = await listStaff(ADMIN, { kind: "closer" });
  const row = dir.staff.find((s) => s.user_id === agentUserId);
  expect(row).toBeTruthy();
  expect(row!.status).toBe("inactive"); // identity + history still resolve
});
