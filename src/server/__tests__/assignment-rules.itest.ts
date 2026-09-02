/**
 * LIVE dryrun verification — Admin follow-up & closer assignment business rules.
 * Real services against tmi_officeverse_dryrun. Seeds its own follow-ups + a
 * lead, exercises every operation, verifies, and cleans up by id > baseline.
 *
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/server/__tests__/_assignment-rules-live.itest.ts --config vitest.itest.config.ts
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import { getDb } from "@/lib/db";
import { followUps } from "@/lib/db/schema";
import type { User } from "@/lib/db/schema";
import {
  assignmentRoster,
  assignmentWorkload,
  longDatedFollowUps,
  reassignBulk,
} from "@/server/assignments/service";
import { promoteAgentToCloser } from "@/server/staff/service";
import { getFollowUpHistory } from "@/server/followups/service";
import { addDaysYMD, calendarTodayIST, nowIST } from "@/server/time";

const ADMIN = { id: 1, role: "admin" } as unknown as User;
const HR = { id: 2, role: "hr" } as unknown as User;
const AGENT = { id: 3, role: "agent" } as unknown as User;
const CLOSER = { id: 5, role: "closer" } as unknown as User;

// dryrun fixtures
const AGENT_SRC_USER = 3; // Rahul (agent, US)
const AGENT_DST_USER = 4; // Priya (agent, US)
const CLOSER_SRC_USER = 5; // Gurpreet (closer, US)
const CLOSER_DST_USER = 6; // Neha (closer, US)
const CLOSER_SRC_ID = 1; // closers.id for Gurpreet
const CLOSER_DST_ID = 2; // closers.id for Neha
const PROMOTE_AGENT_CODE = "TMI_CC_003"; // Ayush (agent, IN) — no work moved to/from him (canonical code, was legacy "AG-90003")

let conn: mysql.Connection;
const base = { fu: 0, lead: 0, fur: 0, aud: 0 };
const seededFu: Record<string, { id: number; code: string }> = {};
let seededLeadId = 0;
/** pre-existing follow-up ownership for the users this test reassigns — restored verbatim in afterAll */
let ownershipSnapshot: { id: number; owner_user_id: number; owner_role: string }[] = [];

const scalar = async (sql: string, args: unknown[] = []): Promise<number> => {
  const [r] = (await conn.query(sql, args)) as [Record<string, unknown>[], unknown];
  return Number(Object.values(r[0] ?? { v: 0 })[0]);
};
const str = async (sql: string, args: unknown[] = []): Promise<string | null> => {
  const [r] = (await conn.query(sql, args)) as [Record<string, unknown>[], unknown];
  const v = r[0] ? Object.values(r[0])[0] : null;
  return v == null ? null : String(v);
};

async function seedFu(
  key: string,
  ownerUserId: number,
  ownerRole: "agent" | "closer",
  scheduledAt: string,
  status: "SCHEDULED" | "COMPLETED" = "SCHEDULED",
): Promise<void> {
  const now = nowIST();
  const id = base.fu + Object.keys(seededFu).length + 1;
  const code = `FU_${String(90_000_000 + id).slice(-8)}`;
  await getDb()
    .insert(followUps)
    .values({
      followUpCode: code,
      ownerUserId,
      ownerRole,
      customerName: `UAT AssignRules ${key}`,
      phone: "+1 (305) 555-0100",
      captureDate: calendarTodayIST(),
      scheduledAt,
      status,
      source: "app",
      createdByUserId: ADMIN.id,
      createdAt: now,
      updatedAt: now,
    } as typeof followUps.$inferInsert);
  const realId = await scalar(
    "SELECT COALESCE(MAX(id),0) v FROM follow_ups WHERE follow_up_code = ?",
    [code],
  );
  seededFu[key] = { id: realId, code };
}

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const db = (
    (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown]
  )[0][0]!.v;
  if (db !== "tmi_officeverse_dryrun") throw new Error(`REFUSING — DATABASE() is "${db}"`);

  base.fu = await scalar("SELECT COALESCE(MAX(id),0) v FROM follow_ups");
  base.lead = await scalar("SELECT COALESCE(MAX(id),0) v FROM leads");
  base.fur = await scalar("SELECT COALESCE(MAX(id),0) v FROM follow_up_reassignments");
  base.aud = await scalar("SELECT COUNT(*) v FROM audit_logs");

  const [snap] = (await conn.query(
    "SELECT id, owner_user_id, owner_role FROM follow_ups WHERE owner_user_id IN (3,4,5,6)",
  )) as unknown as [{ id: number; owner_user_id: number; owner_role: string }[], unknown];
  ownershipSnapshot = snap;

  const today = calendarTodayIST();
  const overdue = `${addDaysYMD(today, -2)} 09:00:00`;
  const dueLater = `${addDaysYMD(today, 10)} 09:00:00`;
  const longDated = `${addDaysYMD(today, 70)} 09:00:00`;

  await seedFu("A_OVERDUE_1", AGENT_SRC_USER, "agent", overdue);
  await seedFu("A_OVERDUE_2", AGENT_SRC_USER, "agent", overdue);
  await seedFu("A_UPCOMING", AGENT_SRC_USER, "agent", dueLater);
  await seedFu("A_LONGDATED", AGENT_SRC_USER, "agent", longDated);
  await seedFu("A_SELECTED", AGENT_SRC_USER, "agent", dueLater);
  await seedFu("A_DONE", AGENT_SRC_USER, "agent", overdue, "COMPLETED");
  await seedFu("C_FU_1", CLOSER_SRC_USER, "closer", dueLater);
  await seedFu("C_FU_2", CLOSER_SRC_USER, "closer", overdue);

  // a lead owned by agents.id 1 + closers.id 1 — used to prove lead ownership
  // never moves when only a follow-up owner changes, and for CLOSER_LEADS.
  const now = nowIST();
  await conn.query(
    `INSERT INTO leads (lead_code, shift_date, customer_name, phone, phone_normalized, debt_amount,
       agent_id, assigned_closer_id, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '0.00', 1, ?, 'ASSIGNED', 'app', ?, ?)`,
    [
      `TMI_9${String(base.lead).slice(-7).padStart(7, "0")}`,
      today,
      "UAT AssignRules Lead",
      "+1 (305) 555-0101",
      "13055550101",
      CLOSER_SRC_ID,
      now,
      now,
    ],
  );
  seededLeadId = await scalar("SELECT COALESCE(MAX(id),0) v FROM leads");
});

afterAll(async () => {
  await conn.query("DELETE FROM follow_up_reassignments WHERE id > ?", [base.fur]);
  await conn.query("DELETE FROM follow_ups WHERE id > ?", [base.fu]);
  await conn.query("DELETE FROM leads WHERE id > ?", [base.lead]);
  // restore every pre-existing follow-up's ownership exactly as it was
  for (const s of ownershipSnapshot) {
    await conn.query("UPDATE follow_ups SET owner_user_id = ?, owner_role = ? WHERE id = ?", [
      s.owner_user_id,
      s.owner_role,
      s.id,
    ]);
  }
  // undo the promotion: drop the created closers row + restore the agent role,
  // resolving the user via the (preserved) agents row.
  const [u] = (await conn.query("SELECT user_id FROM agents WHERE agent_code = ?", [
    PROMOTE_AGENT_CODE,
  ])) as unknown as [{ user_id: number }[], unknown];
  const uid = u[0]?.user_id;
  if (uid) {
    await conn.query("DELETE FROM closers WHERE user_id = ?", [uid]);
    await conn.query("UPDATE users SET role = 'agent' WHERE id = ?", [uid]);
  }
  // audit_logs is append-only — leave the new events.
  await conn.end();
});

test("§13 — unauthorized roles are REJECTED server-side (Agent / Closer / HR)", async () => {
  for (const actor of [AGENT, CLOSER, HR]) {
    await expect(
      reassignBulk(actor, {
        workType: "AGENT_FOLLOWUPS",
        fromOwnerId: AGENT_SRC_USER,
        toOwnerId: AGENT_DST_USER,
        selection: "ALL",
        scope: "OVERDUE",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(promoteAgentToCloser(actor, PROMOTE_AGENT_CODE)).rejects.toMatchObject({
      status: 403,
    });
    await expect(assignmentRoster(actor)).rejects.toMatchObject({ status: 403 });
    await expect(longDatedFollowUps(actor)).rejects.toMatchObject({ status: 403 });
  }
});

test("§1/§3/§11 — Agent→Agent OVERDUE transfer moves only overdue follow-ups; lead owner unchanged", async () => {
  const res = await reassignBulk(ADMIN, {
    workType: "AGENT_FOLLOWUPS",
    fromOwnerId: AGENT_SRC_USER,
    toOwnerId: AGENT_DST_USER,
    selection: "ALL",
    scope: "OVERDUE",
    reason: "UAT overdue",
  });
  expect(res.ok).toBe(true);
  expect(res.reassigned).toBeGreaterThanOrEqual(2); // ≥ the two seeded overdue ones

  const ownerOf = (k: string) =>
    scalar("SELECT owner_user_id v FROM follow_ups WHERE id = ?", [seededFu[k]!.id]);
  expect(await ownerOf("A_OVERDUE_1")).toBe(AGENT_DST_USER);
  expect(await ownerOf("A_OVERDUE_2")).toBe(AGENT_DST_USER);
  expect(await ownerOf("A_UPCOMING")).toBe(AGENT_SRC_USER); // not overdue → untouched
  expect(await ownerOf("A_LONGDATED")).toBe(AGENT_SRC_USER); // not overdue → untouched
  // and NO overdue follow-up is left with the source
  expect(
    await scalar(
      `SELECT COUNT(*) v FROM follow_ups WHERE owner_user_id = ? AND status='SCHEDULED'
         AND scheduled_at < ?`,
      [AGENT_SRC_USER, nowIST()],
    ),
  ).toBe(0);
  // still SCHEDULED, ownerRole stays "agent"
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM follow_ups WHERE id = ? AND status='SCHEDULED' AND owner_role='agent'",
      [seededFu["A_OVERDUE_1"]!.id],
    ),
  ).toBe(1);
  // lead ownership completely untouched
  expect(await scalar("SELECT agent_id v FROM leads WHERE id = ?", [seededLeadId])).toBe(1);
  expect(await scalar("SELECT assigned_closer_id v FROM leads WHERE id = ?", [seededLeadId])).toBe(
    CLOSER_SRC_ID,
  );
});

test("§5 — the follow-up history trail records previous owner / reassigned by / new owner", async () => {
  const h = await getFollowUpHistory(ADMIN, seededFu["A_OVERDUE_1"]!.code);
  expect(Array.isArray(h.reassignments)).toBe(true);
  expect(h.reassignments.length).toBeGreaterThanOrEqual(1);
  const last = h.reassignments[h.reassignments.length - 1]!;
  expect(last.from_owner_name).toBeTruthy();
  expect(last.to_owner_name).toBeTruthy();
  expect(last.reassigned_by_name).toBeTruthy();
  expect(last.to_owner_role).toBe("agent");
  expect(last.reason).toBe("UAT overdue");
  // rows physically exist and were not destroyed
  expect(
    await scalar("SELECT COUNT(*) v FROM follow_up_reassignments WHERE follow_up_id = ?", [
      seededFu["A_OVERDUE_1"]!.id,
    ]),
  ).toBeGreaterThanOrEqual(1);
});

test("§2 — Agent→Agent UPCOMING scope + SELECTED transfer", async () => {
  const up = await reassignBulk(ADMIN, {
    workType: "AGENT_FOLLOWUPS",
    fromOwnerId: AGENT_SRC_USER,
    toOwnerId: AGENT_DST_USER,
    selection: "ALL",
    scope: "UPCOMING",
  });
  // A_UPCOMING, A_LONGDATED and A_SELECTED are all future SCHEDULED
  expect(up.reassigned).toBeGreaterThanOrEqual(3);
  const ownerOf = (k: string) =>
    scalar("SELECT owner_user_id v FROM follow_ups WHERE id = ?", [seededFu[k]!.id]);
  expect(await ownerOf("A_UPCOMING")).toBe(AGENT_DST_USER);
  expect(await ownerOf("A_LONGDATED")).toBe(AGENT_DST_USER);
  expect(await ownerOf("A_SELECTED")).toBe(AGENT_DST_USER);
  // no upcoming SCHEDULED follow-up remains with the source
  expect(
    await scalar(
      `SELECT COUNT(*) v FROM follow_ups WHERE owner_user_id = ? AND status='SCHEDULED'
         AND scheduled_at >= ?`,
      [AGENT_SRC_USER, `${addDaysYMD(calendarTodayIST(), 1)} 00:00:00`],
    ),
  ).toBe(0);

  // move one specific follow-up back with an explicit selection
  const sel = await reassignBulk(ADMIN, {
    workType: "AGENT_FOLLOWUPS",
    fromOwnerId: AGENT_DST_USER,
    toOwnerId: AGENT_SRC_USER,
    selection: [seededFu["A_SELECTED"]!.id],
    scope: "SELECTED",
  });
  expect(sel.reassigned).toBe(1);
  expect(
    await scalar("SELECT owner_user_id v FROM follow_ups WHERE id = ?", [
      seededFu["A_SELECTED"]!.id,
    ]),
  ).toBe(AGENT_SRC_USER);
});

test("§4 — a COMPLETED follow-up never appears in the workload and never moves", async () => {
  const wl = await assignmentWorkload(ADMIN, {
    workType: "AGENT_FOLLOWUPS",
    ownerId: AGENT_SRC_USER,
  });
  expect(wl.rows.some((r) => r.code === seededFu["A_DONE"]!.code)).toBe(false);
  const doneOwner = await scalar("SELECT owner_user_id v FROM follow_ups WHERE id = ?", [
    seededFu["A_DONE"]!.id,
  ]);
  const doneStatus = await str("SELECT status v FROM follow_ups WHERE id = ?", [
    seededFu["A_DONE"]!.id,
  ]);
  expect(doneOwner).toBe(AGENT_SRC_USER); // untouched by every transfer above
  expect(doneStatus).toBe("COMPLETED"); // history preserved
});

test("§6 — long-dated (2–3 month) follow-ups are visible to Admin (not moved)", async () => {
  const ld = await longDatedFollowUps(ADMIN, { process: "US" });
  expect(ld.windowDays.from).toBeGreaterThanOrEqual(50);
  const codes = ld.rows.map((r) => r.code);
  expect(codes).toContain(seededFu["A_LONGDATED"]!.code);
  const row = ld.rows.find((r) => r.code === seededFu["A_LONGDATED"]!.code)!;
  expect(row.monthsAhead).toBeGreaterThanOrEqual(1.8);
});

test("§7 — Closer→Closer lead reassignment (only Admin; follow-ups untouched)", async () => {
  const before = await scalar("SELECT COUNT(*) v FROM follow_ups WHERE owner_user_id = ?", [
    CLOSER_SRC_USER,
  ]);
  const res = await reassignBulk(ADMIN, {
    workType: "CLOSER_LEADS",
    fromOwnerId: CLOSER_SRC_ID,
    toOwnerId: CLOSER_DST_ID,
    selection: [seededLeadId],
  });
  expect(res.reassigned).toBe(1);
  expect(await scalar("SELECT assigned_closer_id v FROM leads WHERE id = ?", [seededLeadId])).toBe(
    CLOSER_DST_ID,
  );
  // no follow-up ownership changed
  expect(
    await scalar("SELECT COUNT(*) v FROM follow_ups WHERE owner_user_id = ?", [CLOSER_SRC_USER]),
  ).toBe(before);
});

test("§8 — Closer→Closer AND Closer→Agent follow-up transfer (Admin-only; lead unchanged)", async () => {
  // closer → closer
  const cc = await reassignBulk(ADMIN, {
    workType: "CLOSER_FOLLOWUPS",
    fromOwnerId: CLOSER_SRC_USER,
    toOwnerId: CLOSER_DST_USER,
    selection: [seededFu["C_FU_1"]!.id],
    scope: "SELECTED",
  });
  expect(cc.reassigned).toBe(1);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM follow_ups WHERE id = ? AND owner_user_id = ? AND owner_role='closer'",
      [seededFu["C_FU_1"]!.id, CLOSER_DST_USER],
    ),
  ).toBe(1);

  // closer → agent — ownerRole flips to "agent"
  const ca = await reassignBulk(ADMIN, {
    workType: "CLOSER_FOLLOWUPS_TO_AGENT",
    fromOwnerId: CLOSER_SRC_USER,
    toOwnerId: AGENT_SRC_USER,
    selection: [seededFu["C_FU_2"]!.id],
    scope: "SELECTED",
  });
  expect(ca.reassigned).toBe(1);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM follow_ups WHERE id = ? AND owner_user_id = ? AND owner_role='agent'",
      [seededFu["C_FU_2"]!.id, AGENT_SRC_USER],
    ),
  ).toBe(1);
});

test("§9 — Agent → Closer promotion: role changes, record + history preserved, no work moved", async () => {
  const uid = await scalar("SELECT user_id v FROM agents WHERE agent_code = ?", [
    PROMOTE_AGENT_CODE,
  ]);
  const leadsBefore = await scalar(
    "SELECT COUNT(*) v FROM leads WHERE agent_id = (SELECT id FROM agents WHERE agent_code = ?)",
    [PROMOTE_AGENT_CODE],
  );
  const fuBefore = await scalar("SELECT COUNT(*) v FROM follow_ups WHERE owner_user_id = ?", [uid]);
  const agentRowBefore = await scalar("SELECT COUNT(*) v FROM agents WHERE agent_code = ?", [
    PROMOTE_AGENT_CODE,
  ]);

  const res = await promoteAgentToCloser(ADMIN, PROMOTE_AGENT_CODE, {});
  expect(res.new_role).toBe("closer");
  expect(res.leads_moved).toBe(0);
  expect(res.followups_moved).toBe(0);

  expect(await str("SELECT role v FROM users WHERE id = ?", [uid])).toBe("closer");
  expect(await scalar("SELECT COUNT(*) v FROM closers WHERE user_id = ?", [uid])).toBe(1);
  // same employee record — the agents row is preserved (no duplicate account)
  expect(
    await scalar("SELECT COUNT(*) v FROM agents WHERE agent_code = ?", [PROMOTE_AGENT_CODE]),
  ).toBe(agentRowBefore);
  expect(await scalar("SELECT COUNT(*) v FROM users WHERE id = ?", [uid])).toBe(1);
  // history untouched
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM leads WHERE agent_id = (SELECT id FROM agents WHERE agent_code = ?)",
      [PROMOTE_AGENT_CODE],
    ),
  ).toBe(leadsBefore);
  expect(await scalar("SELECT COUNT(*) v FROM follow_ups WHERE owner_user_id = ?", [uid])).toBe(
    fuBefore,
  );

  // promoting again is refused
  await expect(promoteAgentToCloser(ADMIN, PROMOTE_AGENT_CODE)).rejects.toMatchObject({
    status: 409,
  });
});

test("§13 — audit trail intact: new events appended, nothing deleted", async () => {
  const now = await scalar("SELECT COUNT(*) v FROM audit_logs");
  expect(now).toBeGreaterThan(base.aud); // grew
  const acts = (await conn.query(
    "SELECT DISTINCT action FROM audit_logs WHERE id > (SELECT MIN(id) FROM (SELECT id FROM audit_logs ORDER BY id DESC LIMIT 40) t)",
  )) as unknown as [{ action: string }[], unknown];
  const seen = acts[0].map((a) => a.action);
  expect(seen).toEqual(
    expect.arrayContaining([
      "assignment.agent_followup_reassign",
      "assignment.closer_lead_reassign",
      "staff.promoted_agent_to_closer",
    ]),
  );
});
