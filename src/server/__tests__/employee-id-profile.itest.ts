/**
 * FINAL SMALL FIX — Employee ID on /profile + code STABILITY · LIVE dryrun UAT.
 *
 * SAFETY: asserts SELECT DATABASE() first. Creates throwaway agents + closers +
 * one lead; deletes every seeded row in afterAll (including a hard DELETE of the
 * throwaway staff used for the "gap" proof). Never touches a pre-existing row
 * or audit_logs.
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/server/__tests__/employee-id-profile.itest.ts --config vitest.itest.config.ts
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import type { User } from "@/lib/db/schema";
import {
  createStaff,
  promoteAgentToCloser,
  removeStaff,
  updateStaffProfile,
} from "@/server/staff/service";
import { listStaffRows } from "@/server/db/repos/staff";
import { currentPublicUser } from "@/server/auth/service";
import { getUserById } from "@/server/db/repos/users";
import { currentShiftDate, nowIST } from "@/server/time";

const ADMIN = { id: 1, role: "admin", process: "US" } as unknown as User;
const CANON_AGENT = /^TMI_CC_\d{3,}$/;
const CANON_CLOSER = /^TMI_CL_\d{3,}$/;
const sfx = Date.now().toString().slice(-8);
let conn: mysql.Connection;

const created: number[] = []; // every user id we create → cleaned in afterAll
let editAgent = { code: "", userId: 0 };
let promoteAgent = { code: "", userId: 0, closerCode: "" };
let eidCloser = { code: "", userId: 0 };
let gapUserIds: number[] = [];
let leadId = 0;

const scalar = async (sql: string, args: unknown[] = []): Promise<number> => {
  const [r] = (await conn.query(sql, args)) as [Record<string, unknown>[], unknown];
  return Number(Object.values(r[0] ?? { v: 0 })[0]);
};
const codesSnapshot = async () => {
  const [ag] = (await conn.query("SELECT id, agent_code FROM agents ORDER BY id")) as [
    Array<{ id: number; agent_code: string }>,
    unknown,
  ];
  const [cl] = (await conn.query("SELECT id, closer_code FROM closers ORDER BY id")) as [
    Array<{ id: number; closer_code: string }>,
    unknown,
  ];
  return {
    agents: new Map(ag.map((r) => [r.id, r.agent_code])),
    closers: new Map(cl.map((r) => [r.id, r.closer_code])),
  };
};
const mkAgent = async (tag: string) => {
  const r = await createStaff(ADMIN, {
    kind: "agent",
    full_name: `UAT EID ${tag} ${sfx}`,
    email: `uat.eid.${tag}.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
  });
  created.push(r.user_id);
  return { code: r.code, userId: r.user_id };
};

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const [r] = (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown];
  if (r[0]!.v !== "tmi_officeverse_dryrun") throw new Error(`REFUSING — ${r[0]!.v}`);

  editAgent = await mkAgent("edit");
  promoteAgent = { ...(await mkAgent("promo")), closerCode: "" };

  const closer = await createStaff(ADMIN, {
    kind: "closer",
    full_name: `UAT EID closer ${sfx}`,
    email: `uat.eid.closer.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
  });
  created.push(closer.user_id);
  eidCloser = { code: closer.code, userId: closer.user_id };

  const agentStaffId = await scalar("SELECT id v FROM agents WHERE user_id = ?", [
    editAgent.userId,
  ]);
  const now = nowIST();
  await conn.query(
    `INSERT INTO leads (lead_code, shift_date, customer_name, phone, phone_normalized, debt_amount,
       agent_id, status, source, created_at, updated_at)
     VALUES (?, ?, ?, '+1 (305) 555-0190', '13055550190', '0.00', ?, 'NEW', 'app', ?, ?)`,
    [
      `TMI_9${sfx.slice(-7).padStart(7, "0")}`,
      currentShiftDate("US"),
      `UAT EID Lead ${sfx}`,
      agentStaffId,
      now,
      now,
    ],
  );
  leadId = await scalar("SELECT id v FROM leads WHERE lead_code = ?", [
    `TMI_9${sfx.slice(-7).padStart(7, "0")}`,
  ]);
});

afterAll(async () => {
  if (leadId) await conn.query("DELETE FROM leads WHERE id = ?", [leadId]);
  const all = [...created, ...gapUserIds].filter(Boolean);
  await conn.query("DELETE FROM salary_profiles WHERE user_id IN (?)", [all]);
  await conn.query("DELETE FROM sessions WHERE user_id IN (?)", [all]);
  await conn.query("DELETE FROM users WHERE id IN (?)", [all]); // cascades agents/closers
  await conn.end();
});

/* ------------------------------- item 1 ------------------------------- */

test("currentPublicUser exposes the CURRENT canonical Employee ID from the authoritative column", async () => {
  const agentUser = await getUserById(editAgent.userId);
  const pu = await currentPublicUser(agentUser!);
  expect(pu.employeeCode).toBe(editAgent.code);
  expect(pu.employeeCode).toMatch(CANON_AGENT);

  const closerUser = await getUserById(eidCloser.userId);
  const cpu = await currentPublicUser(closerUser!);
  expect(cpu.employeeCode).toBe(eidCloser.code);
  expect(cpu.employeeCode).toMatch(CANON_CLOSER);

  // parity with Staff Directory / Agent List (same column)
  const agentRow = (await listStaffRows("agent", {})).find((x) => x.userId === editAgent.userId);
  expect(pu.employeeCode).toBe(agentRow?.code);

  // Admin (user id 1) has no staff record → null, never users.id
  const admin = await getUserById(1);
  const apu = await currentPublicUser(admin!);
  expect(
    apu.employeeCode === null ||
      CANON_AGENT.test(apu.employeeCode!) ||
      CANON_CLOSER.test(apu.employeeCode!),
  ).toBe(true);
  expect(apu.employeeCode).not.toBe("1");
});

test("the displayed Employee ID is STABLE across a profile edit and a re-fetch", async () => {
  const before = editAgent.code;
  await updateStaffProfile(ADMIN, {
    code: before,
    kind: "agent",
    full_name: `UAT EID edit ${sfx} RENAMED`,
    phone: "+1 (305) 555-0191",
  });
  const u = await getUserById(editAgent.userId);
  const pu = await currentPublicUser(u!);
  expect(pu.employeeCode).toBe(before); // unchanged by the edit
  // and again on a second fetch (refresh)
  expect((await currentPublicUser((await getUserById(editAgent.userId))!)).employeeCode).toBe(
    before,
  );
});

/* ------------------------------- item 2 ------------------------------- */

test("creating another employee does NOT change any existing code", async () => {
  const before = await codesSnapshot();
  const extra = await mkAgent("extra1");
  expect(extra.code).toMatch(CANON_AGENT);
  const after = await codesSnapshot();
  for (const [id, code] of before.agents) expect(after.agents.get(id)).toBe(code);
  for (const [id, code] of before.closers) expect(after.closers.get(id)).toBe(code);
});

test("deactivating an employee does NOT change any existing code", async () => {
  const victim = await mkAgent("victim");
  const before = await codesSnapshot();
  await removeStaff(ADMIN, { kind: "agent", code: victim.code });
  const after = await codesSnapshot();
  for (const [id, code] of before.agents) expect(after.agents.get(id)).toBe(code);
  for (const [id, code] of before.closers) expect(after.closers.get(id)).toBe(code);
  // the deactivated row keeps its own code too (identity is permanent)
  expect(
    after.agents.get(await scalar("SELECT id v FROM agents WHERE agent_code = ?", [victim.code])),
  ).toBe(victim.code);
});

test("a NEW employee gets MAX(suffix)+1 and never reuses a freed number", async () => {
  // three fresh agents in a row → strictly increasing suffixes
  const a = await mkAgent("gapA");
  const b = await mkAgent("gapB");
  const c = await mkAgent("gapC");
  const num = (code: string) => Number(code.slice("TMI_CC_".length));
  expect(num(b.code)).toBe(num(a.code) + 1);
  expect(num(c.code)).toBe(num(b.code) + 1);

  // HARD-delete the MIDDLE one (throwaway rows only) to open a real gap …
  gapUserIds = [a.userId, b.userId, c.userId];
  await conn.query("DELETE FROM users WHERE id = ?", [b.userId]); // cascades its agents row
  created.splice(created.indexOf(a.userId), 1);
  created.splice(created.indexOf(b.userId), 1);
  created.splice(created.indexOf(c.userId), 1);

  // … the next agent must be MAX+1 (== num(c)+1), NOT the freed num(b)
  const d = await mkAgent("gapD");
  gapUserIds.push(d.userId);
  expect(num(d.code)).toBe(num(c.code) + 1);
  expect(num(d.code)).not.toBe(num(b.code));
});

test("promotion Agent→Closer does not renumber any unrelated Agent or Closer", async () => {
  const before = await codesSnapshot();
  const res = await promoteAgentToCloser(ADMIN, promoteAgent.code);
  promoteAgent.closerCode = res.closer_code;
  const after = await codesSnapshot();

  // every OTHER row unchanged
  for (const [id, code] of before.agents) expect(after.agents.get(id)).toBe(code);
  for (const [id, code] of before.closers) expect(after.closers.get(id)).toBe(code);

  // current identity = the new canonical Closer code; historical agent row kept
  expect(res.closer_code).toMatch(CANON_CLOSER);
  const u = await getUserById(promoteAgent.userId);
  expect(u!.role).toBe("closer");
  expect((await currentPublicUser(u!)).employeeCode).toBe(res.closer_code);
  const stillAgentRow = await scalar("SELECT COUNT(*) v FROM agents WHERE user_id = ?", [
    promoteAgent.userId,
  ]);
  expect(stillAgentRow).toBe(1); // historical attribution preserved
  expect((await listStaffRows("agent", {})).some((x) => x.userId === promoteAgent.userId)).toBe(
    false,
  );
});

test("no duplicate active/current employee codes; lead→agent FK still resolves", async () => {
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM (SELECT agent_code FROM agents GROUP BY agent_code HAVING COUNT(*)>1) x",
    ),
  ).toBe(0);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM (SELECT closer_code FROM closers GROUP BY closer_code HAVING COUNT(*)>1) x",
    ),
  ).toBe(0);
  const joined = await scalar(
    `SELECT COUNT(*) v FROM leads l JOIN agents a ON a.id = l.agent_id WHERE l.id = ?`,
    [leadId],
  );
  expect(joined).toBe(1);
});
