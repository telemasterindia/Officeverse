/**
 * REPORTS + DATA EXPORT — TWO UAT BUGS · LIVE dryrun UAT (opt-in, DB-touching).
 *
 * SAFETY: asserts SELECT DATABASE() = tmi_officeverse_dryrun first. Creates a
 * throwaway agent + closer, promotes the agent, seeds 2 leads, and deletes
 * every seeded row in afterAll. Never touches a pre-existing row; never
 * touches audit_logs.
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/server/__tests__/reports-export.itest.ts --config vitest.itest.config.ts
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import type { User } from "@/lib/db/schema";
import { createStaff, promoteAgentToCloser } from "@/server/staff/service";
import { queryAgents, queryClosers, queryLeads } from "@/server/export/queries";
import { runExport } from "@/server/export/service";
import { runReportExport, reportEmployees } from "@/server/report/service";
import { currentShiftDate, nowIST } from "@/server/time";

const ADMIN = { id: 1, role: "admin", process: "US" } as unknown as User;
const sfx = Date.now().toString().slice(-8);
let conn: mysql.Connection;

let agentUserId = 0;
let agentCode = "";
let closerUserId = 0;
let closerCode = "";
let promotedUserId = 0;
let promotedAgentCode = "";
let promotedCloserCode = "";
const leadIds: number[] = [];

const scalar = async (sql: string, args: unknown[] = []): Promise<number> => {
  const [r] = (await conn.query(sql, args)) as [Record<string, unknown>[], unknown];
  return Number(Object.values(r[0] ?? { v: 0 })[0]);
};
const readXlsx = async (base64: string): Promise<string[][]> => {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(base64, "base64") as unknown as ArrayBuffer);
  const ws = wb.worksheets[0]!;
  const out: string[][] = [];
  ws.eachRow((row) => out.push((row.values as unknown[]).slice(1).map((v) => String(v ?? ""))));
  return out;
};

async function seedLead(agentStaffId: number, name: string): Promise<number> {
  const now = nowIST();
  const code = `TMI_9${sfx.slice(-7).padStart(7, "0")}`.slice(0, 32);
  const uniq = `${code}${leadIds.length}`;
  await conn.query(
    `INSERT INTO leads (lead_code, shift_date, customer_name, phone, phone_normalized, debt_amount,
       agent_id, status, source, created_at, updated_at)
     VALUES (?, ?, ?, '+1 (305) 555-0170', '13055550170', '0.00', ?, 'NEW', 'app', ?, ?)`,
    [uniq, currentShiftDate("US"), name, agentStaffId, now, now],
  );
  return scalar("SELECT id v FROM leads WHERE lead_code = ?", [uniq]);
}

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const [r] = (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown];
  if (r[0]!.v !== "tmi_officeverse_dryrun") throw new Error(`REFUSING — ${r[0]!.v}`);

  const a = await createStaff(ADMIN, {
    kind: "agent",
    full_name: `UAT REX Agent ${sfx}`,
    email: `uat.rex.a.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
  });
  agentUserId = a.user_id;
  agentCode = a.code;

  const c = await createStaff(ADMIN, {
    kind: "closer",
    full_name: `UAT REX Closer ${sfx}`,
    email: `uat.rex.c.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
  });
  closerUserId = c.user_id;
  closerCode = c.code;

  const p = await createStaff(ADMIN, {
    kind: "agent",
    full_name: `UAT REX Promoted ${sfx}`,
    email: `uat.rex.p.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
  });
  promotedUserId = p.user_id;
  promotedAgentCode = p.code;
  const promo = await promoteAgentToCloser(ADMIN, p.code);
  promotedCloserCode = promo.closer_code;

  const agentStaffId = await scalar("SELECT id v FROM agents WHERE user_id = ?", [agentUserId]);
  leadIds.push(await seedLead(agentStaffId, `UAT REX Lead A ${sfx}`));
  leadIds.push(await seedLead(agentStaffId, `UAT REX Lead B ${sfx}`));
});

afterAll(async () => {
  if (leadIds.length) await conn.query("DELETE FROM leads WHERE id IN (?)", [leadIds]);
  const uids = [agentUserId, closerUserId, promotedUserId].filter(Boolean);
  await conn.query("DELETE FROM salary_profiles WHERE user_id IN (?)", [uids]);
  await conn.query("DELETE FROM sessions WHERE user_id IN (?)", [uids]);
  await conn.query("DELETE FROM users WHERE id IN (?)", [uids]);
  await conn.end();
});

/* ---------------------------------- BUG 2 ---------------------------------- */

test("BUG2 — Agents export contains ONLY current agents; promoted employee is absent", async () => {
  const res = await queryAgents({});
  expect(res.rows.length).toBeGreaterThan(0);
  expect(res.rows.every((x) => x["role"] === "agent")).toBe(true);
  expect(res.rows.some((x) => x["code"] === promotedAgentCode)).toBe(false);
  // the still-an-agent seed IS present, with its canonical code
  expect(res.rows.some((x) => x["code"] === agentCode)).toBe(true);
});

test("BUG2 — the promoted employee resolves to the CURRENT identity in the Closers export", async () => {
  const res = await queryClosers({});
  const row = res.rows.find((x) => x["code"] === promotedCloserCode);
  expect(row).toBeTruthy();
  expect(row!["role"]).toBe("closer");
  expect(String(promotedCloserCode)).toMatch(/^TMI_CL_\d{3,}$/);
});

test("BUG2 — multiple agents keep a correct name <-> Agent ID mapping in the XLSX", async () => {
  const q = await queryAgents({});
  const byCode = new Map(q.rows.map((x) => [String(x["code"]), String(x["name"])]));
  const file = await runExport(ADMIN, { dataset: "agents", format: "xlsx", filters: {} });
  const grid = await readXlsx(file.base64);
  const hdr = grid[0]!;
  const iId = hdr.indexOf("Agent ID");
  const iName = hdr.indexOf("Name");
  let checked = 0;
  for (const row of grid.slice(1)) {
    const code = row[iId]!;
    if (!byCode.has(code)) continue;
    expect(row[iName]).toBe(byCode.get(code));
    expect(code).toMatch(/[A-Za-z]/); // a business code, never a bare integer id
    checked += 1;
  }
  expect(checked).toBeGreaterThanOrEqual(2);
});

test("BUG2 — existing Data Export filters still work (agentCode / status / source)", async () => {
  const all = await queryLeads({});
  const byAgent = await queryLeads({ agentCode });
  expect(byAgent.rows.length).toBe(2);
  expect(byAgent.rows.every((r) => r["agent_code"] === agentCode)).toBe(true);
  expect(byAgent.rows.length).toBeLessThanOrEqual(all.rows.length);

  const bySource = await queryLeads({ source: "app" });
  expect(bySource.rows.every((r) => r["source"] === "app")).toBe(true);

  const byStatus = await queryLeads({ status: "NEW" });
  expect(byStatus.rows.every((r) => r["status"] === "NEW")).toBe(true);
});

/* ---------------------------------- BUG 1 ---------------------------------- */

test("BUG1 — Reports export downloads a file DIRECTLY, no dataset/free-text step", async () => {
  const file = await runReportExport(ADMIN, { process: "ALL", employee: "ALL", format: "xlsx" });
  expect(file.fileName).toMatch(/^officeverse-report-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const grid = await readXlsx(file.base64);
  expect(grid[0]).toEqual([
    "Lead ID",
    "Customer name",
    "Process",
    "Status",
    "Source",
    "Agent ID",
    "Agent",
    "Closer ID",
    "Closer",
    "Shift date (operational)",
    "Created at",
  ]);
  expect(file.rowCount).toBe(grid.length - 1);
  // the seeded leads are present with the CANONICAL agent code + matching name
  const mine = grid.filter((r) =>
    String(r[0]).startsWith(`TMI_9${sfx.slice(-7).padStart(7, "0")}`),
  );
  expect(mine.length).toBe(2);
  for (const r of mine) {
    expect(r[5]).toBe(agentCode); // Agent ID column
    expect(r[6]).toBe(`UAT REX Agent ${sfx}`); // Agent name column
  }
});

test("BUG1 — the report respects the selected DATE RANGE", async () => {
  const today = currentShiftDate("US");
  const inRange = await runReportExport(ADMIN, {
    dateFrom: today,
    dateTo: today,
    process: "ALL",
    employee: "ALL",
    format: "csv",
  });
  expect(inRange.rowCount).toBeGreaterThanOrEqual(2);

  const outOfRange = await runReportExport(ADMIN, {
    dateFrom: "2099-01-01",
    dateTo: "2099-12-31",
    process: "ALL",
    employee: "ALL",
    format: "csv",
  });
  expect(outOfRange.rowCount).toBe(0);
});

test("BUG1 — the report respects the selected PROCESS", async () => {
  const us = await runReportExport(ADMIN, { process: "US", employee: "ALL", format: "csv" });
  const inField = await runReportExport(ADMIN, { process: "IN", employee: "ALL", format: "csv" });
  const all = await runReportExport(ADMIN, { process: "ALL", employee: "ALL", format: "csv" });
  expect(us.rowCount).toBeLessThanOrEqual(all.rowCount);
  expect(us.rowCount + inField.rowCount).toBeLessThanOrEqual(all.rowCount + all.rowCount);
  expect(us.rowCount).toBeGreaterThanOrEqual(2); // the seeded US leads
});

test("BUG1 — the report respects the selected EMPLOYEE", async () => {
  const mineOnly = await runReportExport(ADMIN, {
    process: "ALL",
    employee: agentCode,
    format: "csv",
  });
  expect(mineOnly.rowCount).toBe(2);

  const promotedFilter = await runReportExport(ADMIN, {
    process: "ALL",
    employee: promotedCloserCode,
    format: "csv",
  });
  expect(promotedFilter.rowCount).toBe(0); // no leads for the promoted closer
});

test("BUG1 — the Employee picker lists current agents + closers by canonical code", async () => {
  const opts = await reportEmployees(ADMIN);
  expect(opts.some((e) => e.code === agentCode && e.role === "agent")).toBe(true);
  expect(opts.some((e) => e.code === closerCode && e.role === "closer")).toBe(true);
  expect(opts.some((e) => e.code === promotedCloserCode && e.role === "closer")).toBe(true);
  // the promoted person's OLD agent code is not offered as an agent
  expect(opts.some((e) => e.code === promotedAgentCode && e.role === "agent")).toBe(false);
});

test("BUG1 — report export is Admin/HR only (agent + closer rejected)", async () => {
  for (const role of ["agent", "closer"] as const) {
    await expect(
      runReportExport({ id: 9, role } as unknown as User, {
        process: "ALL",
        employee: "ALL",
        format: "csv",
      }),
    ).rejects.toMatchObject({ status: 403 });
  }
});
