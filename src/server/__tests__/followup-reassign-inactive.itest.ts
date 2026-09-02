/**
 * FOLLOW-UP REASSIGNMENT — FINAL BUSINESS RULE CORRECTION · LIVE dryrun UAT
 * (opt-in, DB-touching). Runs §10 against tmi_officeverse_dryrun.
 *
 * SAFETY: asserts SELECT DATABASE() first. Creates 5 throwaway agents + 2
 * throwaway closers + 3 seeded follow-ups + 1 seeded lead; deletes every one in
 * afterAll (trail → follow_ups → leads → users, which cascades agents/closers).
 * NEVER deletes a pre-existing row; never touches audit_logs.
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/server/__tests__/followup-reassign-inactive.itest.ts --config vitest.itest.config.ts
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import { getDb } from "@/lib/db";
import { followUps } from "@/lib/db/schema";
import type { User } from "@/lib/db/schema";
import { createStaff, removeStaff } from "@/server/staff/service";
import { reassignBulk } from "@/server/assignments/service";
import { getFollowUpHistory } from "@/server/followups/service";
import { currentShiftDate, nowIST } from "@/server/time";

const ADMIN = { id: 1, role: "admin", process: "US" } as unknown as User;
const HR = { id: 2, role: "hr", process: "IN" } as unknown as User;
const AGENT = { id: 3, role: "agent", process: "US" } as unknown as User;
const CLOSER = { id: 5, role: "closer", process: "US" } as unknown as User;

const sfx = Date.now().toString().slice(-8);
let conn: mysql.Connection;

// temp staff — name → { code, userId }
const A: Record<string, { code: string; userId: number }> = {};
let closer1UserId = 0;
let closer2UserId = 0;
let closer1Code = "";
let closer2Code = "";
let leadId = 0;
let leadAgentStaffId = 0;
let fu = { id: 0, code: "" }; // agent chain follow-up
let fuCloserAgent = { id: 0, code: "" }; // closer → agent
let fuCloserCloser = { id: 0, code: "" }; // closer → closer

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
  ownerUserId: number,
  ownerRole: "agent" | "closer",
  tag: string,
): Promise<{ id: number; code: string }> {
  const now = nowIST();
  const code =
    `FU_${String(90_000_000 + ownerUserId + tag.length).slice(-8)}${tag.slice(-1)}`.slice(0, 32);
  await getDb()
    .insert(followUps)
    .values({
      followUpCode: code,
      ownerUserId,
      ownerRole,
      customerName: `UAT RIA ${tag}`,
      phone: "+1 (305) 555-0166",
      captureDate: currentShiftDate("US"),
      scheduledAt: now,
      status: "SCHEDULED",
      source: "app",
      createdByUserId: ADMIN.id,
      createdAt: now,
      updatedAt: now,
    } as typeof followUps.$inferInsert);
  const id = await scalar("SELECT id v FROM follow_ups WHERE follow_up_code = ?", [code]);
  return { id, code };
}

const move = (
  workType: string,
  fromOwnerId: number,
  toOwnerId: number,
  fuId: number,
  reason?: string,
) =>
  reassignBulk(ADMIN, {
    workType,
    fromOwnerId,
    toOwnerId,
    selection: [fuId],
    scope: "SELECTED",
    ...(reason ? { reason } : {}),
  });

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const db = (
    (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown]
  )[0][0]!.v;
  if (db !== "tmi_officeverse_dryrun") throw new Error(`REFUSING — DATABASE() is "${db}"`);

  for (const name of ["A", "B", "C", "D", "E"]) {
    const r = await createStaff(ADMIN, {
      kind: "agent",
      full_name: `UAT RIA Agent ${name}`,
      email: `uat.ria.${name.toLowerCase()}.${sfx}@officeverse.local`,
      password: "uat-password-1234",
      process: "US",
    });
    A[name] = { code: r.code, userId: r.user_id };
  }
  const c1 = await createStaff(ADMIN, {
    kind: "closer",
    full_name: "UAT RIA Closer 1",
    email: `uat.ria.c1.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
  });
  const c2 = await createStaff(ADMIN, {
    kind: "closer",
    full_name: "UAT RIA Closer 2",
    email: `uat.ria.c2.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
  });
  closer1UserId = c1.user_id;
  closer1Code = c1.code;
  closer2UserId = c2.user_id;
  closer2Code = c2.code;

  leadAgentStaffId = await scalar("SELECT id v FROM agents WHERE user_id = ?", [A["A"]!.userId]);
  const now = nowIST();
  await conn.query(
    `INSERT INTO leads (lead_code, shift_date, customer_name, phone, phone_normalized, debt_amount,
       agent_id, status, source, created_at, updated_at)
     VALUES (?, ?, 'UAT RIA Lead', '+1 (305) 555-0167', '13055550167', '0.00', ?, 'NEW', 'app', ?, ?)`,
    [`TMI_9${sfx.slice(-7).padStart(7, "0")}`, currentShiftDate("US"), leadAgentStaffId, now, now],
  );
  leadId = await scalar("SELECT COALESCE(MAX(id),0) v FROM leads");

  fu = await seedFu(A["A"]!.userId, "agent", "chain");
  fuCloserAgent = await seedFu(closer1UserId, "closer", "c2a");
  fuCloserCloser = await seedFu(closer1UserId, "closer", "c2c");
});

afterAll(async () => {
  const ids = [fu.id, fuCloserAgent.id, fuCloserCloser.id];
  await conn.query("DELETE FROM follow_up_reassignments WHERE follow_up_id IN (?)", [ids]);
  await conn.query("DELETE FROM follow_ups WHERE id IN (?)", [ids]);
  await conn.query("DELETE FROM leads WHERE id = ?", [leadId]);
  const userIds = [...Object.values(A).map((v) => v.userId), closer1UserId, closer2UserId];
  await conn.query("DELETE FROM salary_profiles WHERE user_id IN (?)", [userIds]);
  await conn.query("DELETE FROM sessions WHERE user_id IN (?)", [userIds]);
  await conn.query("DELETE FROM users WHERE id IN (?)", [userIds]);
  await conn.end();
});

test("§5 — only Admin can reassign (HR / Agent / Closer → 403)", async () => {
  for (const actor of [HR, AGENT, CLOSER]) {
    await expect(
      reassignBulk(actor, {
        workType: "AGENT_FOLLOWUPS",
        fromOwnerId: A["A"]!.userId,
        toOwnerId: A["B"]!.userId,
        selection: [fu.id],
        scope: "SELECTED",
      }),
    ).rejects.toMatchObject({ status: 403 });
  }
});

test("§2/§3/§4 — A → B → C → D → A → B: every hop succeeds, trail grows, history never blocks", async () => {
  const chain: Array<[string, string]> = [
    ["A", "B"],
    ["B", "C"],
    ["C", "D"],
    ["D", "A"],
    ["A", "B"],
  ];
  let n = 0;
  for (const [from, to] of chain) {
    const res = await move(
      "AGENT_FOLLOWUPS",
      A[from]!.userId,
      A[to]!.userId,
      fu.id,
      `hop ${from}->${to}`,
    );
    expect(res.ok, `${from}->${to}`).toBe(true);
    expect(res.reassigned, `${from}->${to}`).toBe(1);
    n += 1;
    expect(
      await scalar("SELECT COUNT(*) v FROM follow_up_reassignments WHERE follow_up_id = ?", [
        fu.id,
      ]),
    ).toBe(n); // append-only, one row per hop
    expect(await scalar("SELECT owner_user_id v FROM follow_ups WHERE id = ?", [fu.id])).toBe(
      A[to]!.userId,
    );
    // §7 — lead owner never moves
    expect(await scalar("SELECT agent_id v FROM leads WHERE id = ?", [leadId])).toBe(
      leadAgentStaffId,
    );
  }
  // the follow-up has been reassigned 5 times and is STILL reassignable — no cap
  expect(n).toBe(5);
});

test("§4 — the full trail is intact + ordered, earliest entry unchanged", async () => {
  const h = await getFollowUpHistory(ADMIN, fu.code);
  expect(h.reassignments.length).toBe(5);
  // the repo returns the trail oldest → newest (by id); each row is a distinct
  // immutable hop and the sequence matches the chain exactly.
  const hops = h.reassignments.map((r) => `${r.from_owner_name}->${r.to_owner_name}`);
  expect(hops).toEqual([
    "UAT RIA Agent A->UAT RIA Agent B",
    "UAT RIA Agent B->UAT RIA Agent C",
    "UAT RIA Agent C->UAT RIA Agent D",
    "UAT RIA Agent D->UAT RIA Agent A",
    "UAT RIA Agent A->UAT RIA Agent B",
  ]);
  for (const r of h.reassignments) {
    expect(r.from_owner_role).toBe("agent");
    expect(r.to_owner_role).toBe("agent");
    expect(r.reassigned_by_name).toBeTruthy();
    expect(typeof r.at).toBe("string");
  }
  // distinct reasons proven — nothing was overwritten
  expect(h.reassignments[0]!.reason).toBe("hop A->B");
  expect(h.reassignments[2]!.reason).toBe("hop C->D");
});

test("§1/§6/§9 — a deactivated Agent cannot receive a follow-up (direct id is still rejected)", async () => {
  // FU currently at B; deactivate D and try B → D
  await removeStaff(ADMIN, { kind: "agent", code: A["D"]!.code });
  await expect(
    move("AGENT_FOLLOWUPS", A["B"]!.userId, A["D"]!.userId, fu.id),
  ).rejects.toMatchObject({ status: 422, code: "inactive_destination" });
  // no trail row was added, owner unchanged
  expect(
    await scalar("SELECT COUNT(*) v FROM follow_up_reassignments WHERE follow_up_id = ?", [fu.id]),
  ).toBe(5);
  expect(await scalar("SELECT owner_user_id v FROM follow_ups WHERE id = ?", [fu.id])).toBe(
    A["B"]!.userId,
  );
});

test("§3 — a NEW active Agent (E) can receive the already-many-times-reassigned follow-up", async () => {
  const res = await move(
    "AGENT_FOLLOWUPS",
    A["B"]!.userId,
    A["E"]!.userId,
    fu.id,
    "to new agent E",
  );
  expect(res.ok).toBe(true);
  expect(await scalar("SELECT owner_user_id v FROM follow_ups WHERE id = ?", [fu.id])).toBe(
    A["E"]!.userId,
  );
  expect(
    await scalar("SELECT COUNT(*) v FROM follow_up_reassignments WHERE follow_up_id = ?", [fu.id]),
  ).toBe(6);
});

test("§1 — Closer → Agent: active target succeeds; inactive target rejected", async () => {
  const ok = await move(
    "CLOSER_FOLLOWUPS_TO_AGENT",
    closer1UserId,
    A["A"]!.userId,
    fuCloserAgent.id,
  );
  expect(ok.ok).toBe(true);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM follow_ups WHERE id = ? AND owner_user_id = ? AND owner_role = 'agent'",
      [fuCloserAgent.id, A["A"]!.userId],
    ),
  ).toBe(1);
  // now at agent A; D is inactive → reject
  await expect(
    move("AGENT_FOLLOWUPS", A["A"]!.userId, A["D"]!.userId, fuCloserAgent.id),
  ).rejects.toMatchObject({ status: 422, code: "inactive_destination" });
});

test("§1 — Closer → Closer: active target succeeds; deactivated closer rejected", async () => {
  const ok = await move("CLOSER_FOLLOWUPS", closer1UserId, closer2UserId, fuCloserCloser.id);
  expect(ok.ok).toBe(true);
  // move it back to closer1 so we can then target the (soon-inactive) closer2
  const back = await move("CLOSER_FOLLOWUPS", closer2UserId, closer1UserId, fuCloserCloser.id);
  expect(back.ok).toBe(true);

  await removeStaff(ADMIN, { kind: "closer", code: closer2Code });
  await expect(
    move("CLOSER_FOLLOWUPS", closer1UserId, closer2UserId, fuCloserCloser.id),
  ).rejects.toMatchObject({ status: 422, code: "inactive_destination" });
  // still owned by the active closer1, history preserved
  expect(
    await scalar("SELECT owner_user_id v FROM follow_ups WHERE id = ?", [fuCloserCloser.id]),
  ).toBe(closer1UserId);
});

test("§7 — after the entire exercise the seeded lead's owner is unchanged", async () => {
  expect(await str("SELECT agent_id v FROM leads WHERE id = ?", [leadId])).toBe(
    String(leadAgentStaffId),
  );
});
