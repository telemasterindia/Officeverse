/**
 * CANONICAL EMPLOYEE ID FORMAT — LIVE dryrun UAT (opt-in, DB-touching).
 *
 * Verifies against tmi_officeverse_dryrun that:
 *   - every CURRENT employee code is canonical (TMI_CC_### / TMI_CL_###)
 *   - Create Agent / Create Closer mint canonical codes
 *   - the code is STABLE across profile edits and re-fetches
 *   - promotion Agent→Closer yields a canonical CURRENT Closer identity, the
 *     person leaves the agent roster, and history stays attributable
 *   - Data Export + Reports export emit the canonical code
 *
 * SAFETY: asserts SELECT DATABASE() first. Creates throwaway staff + one lead;
 * deletes every seeded row in afterAll. Never touches a pre-existing row or
 * audit_logs.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import type { User } from "@/lib/db/schema";
import { createStaff, promoteAgentToCloser, updateStaffProfile } from "@/server/staff/service";
import { listStaffRows } from "@/server/db/repos/staff";
import { queryAgents, queryClosers } from "@/server/export/queries";
import { runReportExport } from "@/server/report/service";
import { currentShiftDate, nowIST } from "@/server/time";

const ADMIN = { id: 1, role: "admin", process: "US" } as unknown as User;
const CANON_AGENT = /^TMI_CC_\d{3,}$/;
const CANON_CLOSER = /^TMI_CL_\d{3,}$/;
const sfx = Date.now().toString().slice(-8);
let conn: mysql.Connection;

let a1 = { code: "", userId: 0 };
let c1 = { code: "", userId: 0 };
let promo = { agentCode: "", closerCode: "", userId: 0 };
let leadId = 0;

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
  const [r] = (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown];
  if (r[0]!.v !== "tmi_officeverse_dryrun") throw new Error(`REFUSING — ${r[0]!.v}`);

  const a = await createStaff(ADMIN, {
    kind: "agent",
    full_name: `UAT CID Agent ${sfx}`,
    email: `uat.cid.a.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
  });
  a1 = { code: a.code, userId: a.user_id };

  const c = await createStaff(ADMIN, {
    kind: "closer",
    full_name: `UAT CID Closer ${sfx}`,
    email: `uat.cid.c.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
  });
  c1 = { code: c.code, userId: c.user_id };

  const p = await createStaff(ADMIN, {
    kind: "agent",
    full_name: `UAT CID Promote ${sfx}`,
    email: `uat.cid.p.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
  });
  const res = await promoteAgentToCloser(ADMIN, p.code);
  promo = { agentCode: p.code, closerCode: res.closer_code, userId: p.user_id };

  const agentStaffId = await scalar("SELECT id v FROM agents WHERE user_id = ?", [a1.userId]);
  const now = nowIST();
  await conn.query(
    `INSERT INTO leads (lead_code, shift_date, customer_name, phone, phone_normalized, debt_amount,
       agent_id, status, source, created_at, updated_at)
     VALUES (?, ?, ?, '+1 (305) 555-0180', '13055550180', '0.00', ?, 'NEW', 'app', ?, ?)`,
    [
      `TMI_9${sfx.slice(-7).padStart(7, "0")}`,
      currentShiftDate("US"),
      `UAT CID Lead ${sfx}`,
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
  const uids = [a1.userId, c1.userId, promo.userId].filter(Boolean);
  await conn.query("DELETE FROM salary_profiles WHERE user_id IN (?)", [uids]);
  await conn.query("DELETE FROM sessions WHERE user_id IN (?)", [uids]);
  await conn.query("DELETE FROM users WHERE id IN (?)", [uids]);
  await conn.end();
});

test("every CURRENT employee code in the DB is canonical — zero AG-##### / CL-#####", async () => {
  const staleAgents = await scalar(
    "SELECT COUNT(*) v FROM agents a JOIN users u ON u.id=a.user_id WHERE u.role='agent' AND a.agent_code NOT REGEXP '^TMI_CC_[0-9]{3,}$'",
  );
  const staleClosers = await scalar(
    "SELECT COUNT(*) v FROM closers c JOIN users u ON u.id=c.user_id WHERE u.role='closer' AND c.closer_code NOT REGEXP '^TMI_CL_[0-9]{3,}$'",
  );
  expect(staleAgents).toBe(0);
  expect(staleClosers).toBe(0);

  const dupA = await scalar(
    "SELECT COUNT(*) v FROM (SELECT agent_code FROM agents GROUP BY agent_code HAVING COUNT(*)>1) x",
  );
  const dupC = await scalar(
    "SELECT COUNT(*) v FROM (SELECT closer_code FROM closers GROUP BY closer_code HAVING COUNT(*)>1) x",
  );
  expect(dupA + dupC).toBe(0);
});

test("Create Agent → TMI_CC_### ; Create Closer → TMI_CL_###", () => {
  expect(a1.code).toMatch(CANON_AGENT);
  expect(c1.code).toMatch(CANON_CLOSER);
});

test("the code is STABLE across a profile edit and a re-fetch", async () => {
  const before = a1.code;
  const edited = await updateStaffProfile(ADMIN, {
    code: before,
    kind: "agent",
    full_name: `UAT CID Agent ${sfx} RENAMED`,
    phone: "+1 (305) 555-0181",
  });
  expect(edited.code).toBe(before);
  const fromDb = await str("SELECT agent_code v FROM agents WHERE user_id = ?", [a1.userId]);
  expect(fromDb).toBe(before);
  const rows = await listStaffRows("agent", {});
  expect(rows.find((r) => r.userId === a1.userId)?.code).toBe(before);
});

test("promotion → canonical CURRENT Closer identity; leaves agent roster; history kept", async () => {
  expect(promo.closerCode).toMatch(CANON_CLOSER);
  expect(await str("SELECT role v FROM users WHERE id = ?", [promo.userId])).toBe("closer");

  const agentRows = await listStaffRows("agent", {});
  const closerRows = await listStaffRows("closer", {});
  expect(agentRows.some((r) => r.userId === promo.userId)).toBe(false); // no longer a current Agent
  const asCloser = closerRows.find((r) => r.userId === promo.userId);
  expect(asCloser?.code).toBe(promo.closerCode); // current identity = the canonical closer code
  expect(asCloser?.code).not.toBe(promo.agentCode); // NOT the old agent code

  // the historical agents row still exists (lead attribution) and is itself canonical,
  // but it is never surfaced as a current identity
  const histAgentCode = await str("SELECT agent_code v FROM agents WHERE user_id = ?", [
    promo.userId,
  ]);
  expect(histAgentCode).toMatch(CANON_AGENT);
  expect(histAgentCode).toBe(promo.agentCode);

  // no duplicate active identity
  expect(await scalar("SELECT COUNT(*) v FROM closers WHERE user_id = ?", [promo.userId])).toBe(1);
  expect(await scalar("SELECT COUNT(*) v FROM users WHERE id = ?", [promo.userId])).toBe(1);
});

test("Data Export emits canonical codes; promoted person absent from Agents export", async () => {
  const ag = await queryAgents({});
  const cl = await queryClosers({});
  expect(ag.rows.every((x) => CANON_AGENT.test(String(x["code"])))).toBe(true);
  expect(cl.rows.every((x) => CANON_CLOSER.test(String(x["code"])))).toBe(true);
  expect(ag.rows.some((x) => x["code"] === promo.agentCode)).toBe(false);
  const promoted = cl.rows.find((x) => x["code"] === promo.closerCode);
  expect(promoted?.["name"]).toBe(`UAT CID Promote ${sfx}`);
});

test("Reports export emits the canonical Agent ID for the seeded lead", async () => {
  const file = await runReportExport(ADMIN, { process: "ALL", employee: "ALL", format: "csv" });
  const csv = Buffer.from(file.base64, "base64").toString("utf8");
  const line = csv
    .split(/\r?\n/)
    .find((l) => l.startsWith(`TMI_9${sfx.slice(-7).padStart(7, "0")}`));
  expect(line).toBeTruthy();
  const cells = line!.split(",");
  // Lead ID, Customer, Process, Status, Source, Agent ID, Agent, …
  expect(cells[5]).toBe(a1.code);
  expect(cells[5]).toMatch(CANON_AGENT);
  expect(cells[6]).toContain("UAT CID Agent");
});

test("employee filter accepts the canonical code", async () => {
  const one = await runReportExport(ADMIN, { process: "ALL", employee: a1.code, format: "csv" });
  expect(one.rowCount).toBe(1);
});
