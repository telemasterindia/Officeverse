/**
 * ADMIN + HR UAT — LIVE dryrun (opt-in, DB-touching).
 *
 * Salary / Attendance process filter (users.process) + canonical Employee ID +
 * photo; HR blocked from Leads / Follow-ups / Data Export; HR Policy create /
 * publish / read-scope / audit; Admin staff edit keeps history intact.
 *
 * SAFETY: asserts SELECT DATABASE() first. Creates a throwaway agent; writes
 * throwaway HR policies; deletes both (+ their audit rows) in afterAll. Never
 * touches a pre-existing non-audit row.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import type { User } from "@/lib/db/schema";
import { createStaff, updateStaffProfile } from "@/server/staff/service";
import { listPolicies, savePolicy, setPolicyStatus, getPolicy } from "@/server/hr-policy/service";
import { listSalaryProfiles } from "@/server/hr/payroll-service";
import { listAllAttendance } from "@/server/attendance/service";
import { listLeads, getLead } from "@/server/leads/service";
import { listFollowUps } from "@/server/followups/service";
import { runExport } from "@/server/export/service";

const ADMIN = { id: 1, role: "admin", process: "US" } as unknown as User;
const HR = { id: 2, role: "hr", process: "IN" } as unknown as User;
const AGENT = { id: 3, role: "agent", process: "US" } as unknown as User;
const CLOSER = { id: 5, role: "closer", process: "US" } as unknown as User;
const CANON = /^TMI_C[CL]_\d{3,}$/;
const sfx = Date.now().toString().slice(-8);

let conn: mysql.Connection;
const policyIds: number[] = [];
let agentUserId = 0;
let agentCode = "";

const scalar = async (sql: string, a: unknown[] = []): Promise<number> => {
  const [r] = (await conn.query(sql, a)) as [Record<string, unknown>[], unknown];
  return Number(Object.values(r[0] ?? { v: 0 })[0]);
};

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const [r] = (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown];
  if (r[0]!.v !== "tmi_officeverse_dryrun") throw new Error(`REFUSING — ${r[0]!.v}`);
  const a = await createStaff(ADMIN, {
    kind: "agent",
    full_name: `UAT HRX Agent ${sfx}`,
    email: `uat.hrx.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
    base_salary: 30000, // → a salary_profiles row so the agent appears in the list
  });
  agentUserId = a.user_id;
  agentCode = a.code;
});

afterAll(async () => {
  if (policyIds.length) {
    await conn.query("DELETE FROM audit_logs WHERE entity_type='hr_policy' AND entity_id IN (?)", [
      policyIds,
    ]);
    await conn.query("DELETE FROM hr_policies WHERE id IN (?)", [policyIds]);
  }
  await conn.query("DELETE FROM salary_profiles WHERE user_id = ?", [agentUserId]);
  await conn.query("DELETE FROM sessions WHERE user_id = ?", [agentUserId]);
  await conn.query("DELETE FROM users WHERE id = ?", [agentUserId]);
  await conn.end();
});

/* ------------------------------ salary ------------------------------ */

test("Salary — process filter uses users.process; rows carry canonical code + photo + userId", async () => {
  const all = await listSalaryProfiles(ADMIN, {});
  const inField = await listSalaryProfiles(ADMIN, { process: "IN" });
  const us = await listSalaryProfiles(ADMIN, { process: "US" });
  expect(us.rows.length + inField.rows.length).toBeLessThanOrEqual(all.rows.length * 2);
  for (const r of us.rows) expect(r.process).toBe("US");
  for (const r of inField.rows) expect(r.process).toBe("IN");
  const mine = all.rows.find((r) => r.userId === agentUserId);
  expect(mine).toBeTruthy();
  expect(mine!.employeeCode).toBe(agentCode);
  expect(mine!.employeeCode).toMatch(CANON);
  expect(typeof mine!.photoAvailable).toBe("boolean");
});

/* ---------------------------- attendance --------------------------- */

test("Attendance — process filter uses users.process; rows carry canonical code + photo", async () => {
  const all = await listAllAttendance(ADMIN, {});
  const us = await listAllAttendance(ADMIN, { process: "US" });
  expect(us.rows.length).toBeLessThanOrEqual(all.rows.length);
  for (const r of us.rows) expect(r.process).toBe("US");
  for (const r of all.rows) {
    if (r.employeeCode) expect(r.employeeCode).toMatch(CANON);
    expect(typeof r.photoAvailable).toBe("boolean");
  }
});

/* -------------------------- HR role split -------------------------- */

test("HR is blocked server-side from Leads / Follow-ups / Data Export (403)", async () => {
  await expect(listLeads(HR, { page: 1, pageSize: 10 } as never)).rejects.toMatchObject({
    status: 403,
  });
  await expect(getLead(HR, "TMI_00012007")).rejects.toMatchObject({ status: 403 });
  await expect(
    listFollowUps(HR, { page: 1, pageSize: 10, sort: "soonest" } as never),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    runExport(HR, { dataset: "leads", format: "csv", filters: {} }),
  ).rejects.toMatchObject({ status: 403 });
  // admin still works (sanity — module not broken for its owner)
  const ok = await listLeads(ADMIN, { page: 1, pageSize: 5 } as never);
  expect(ok).toHaveProperty("leads");
});

/* ---------------------------- HR Policy --------------------------- */

test("HR Policy — HR authors + publishes; Agents/Closers read published only; audit trail", async () => {
  const draft = await savePolicy(HR, {
    title: `UAT HRX Policy ${sfx}`,
    content: "Leave, conduct and reimbursement rules.",
    effective_date: "2026-10-01",
  });
  policyIds.push(draft.id);
  expect(draft.status).toBe("DRAFT");
  expect(draft.created_by_name).toBeTruthy();

  // Agents/Closers cannot see a draft, and cannot write
  for (const actor of [AGENT, CLOSER]) {
    const list = await listPolicies(actor);
    expect(list.canManage).toBe(false);
    expect(list.rows.some((p) => p.id === draft.id)).toBe(false);
    await expect(getPolicy(actor, draft.id)).rejects.toMatchObject({ status: 403 });
    await expect(
      savePolicy(actor as unknown as User, { title: "x", content: "y" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(setPolicyStatus(actor as unknown as User, draft.id, true)).rejects.toMatchObject({
      status: 403,
    });
  }

  const edited = await savePolicy(HR, {
    id: draft.id,
    title: `UAT HRX Policy ${sfx} v2`,
    content: "Updated body.",
  });
  expect(edited.title).toMatch(/v2$/);

  const pub = await setPolicyStatus(ADMIN, draft.id, true);
  expect(pub.status).toBe("PUBLISHED");
  expect(pub.published_by_name).toBeTruthy();
  expect(pub.published_at).toBeTruthy();

  // now visible to Agents + Closers
  for (const actor of [AGENT, CLOSER]) {
    const list = await listPolicies(actor);
    expect(list.rows.some((p) => p.id === draft.id && p.status === "PUBLISHED")).toBe(true);
    const one = await getPolicy(actor, draft.id);
    expect(one.id).toBe(draft.id);
  }

  // unpublish → hidden again
  const un = await setPolicyStatus(HR, draft.id, false);
  expect(un.status).toBe("DRAFT");
  expect((await listPolicies(AGENT)).rows.some((p) => p.id === draft.id)).toBe(false);

  const [audit] = (await conn.query(
    "SELECT action FROM audit_logs WHERE entity_type='hr_policy' AND entity_id=? ORDER BY id",
    [draft.id],
  )) as [Array<{ action: string }>, unknown];
  expect(audit.map((x) => x.action)).toEqual([
    "hr_policy.created",
    "hr_policy.updated",
    "hr_policy.published",
    "hr_policy.unpublished",
  ]);
});

/* --------------------- staff edit keeps history -------------------- */

test("Admin edits an Agent profile — canonical code unchanged, no history destroyed", async () => {
  const leadsBefore = await scalar(
    "SELECT COUNT(*) v FROM leads WHERE agent_id = (SELECT id FROM agents WHERE agent_code = ?)",
    [agentCode],
  );
  const edited = await updateStaffProfile(ADMIN, {
    code: agentCode,
    kind: "agent",
    full_name: `UAT HRX Agent ${sfx} RENAMED`,
    dob: "1990-04-05",
    anniversary_date: "2020-06-07",
  });
  expect(edited.code).toBe(agentCode); // permanent identity
  expect(await scalar("SELECT COUNT(*) v FROM agents WHERE agent_code = ?", [agentCode])).toBe(1);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM leads WHERE agent_id = (SELECT id FROM agents WHERE agent_code = ?)",
      [agentCode],
    ),
  ).toBe(leadsBefore);
});
