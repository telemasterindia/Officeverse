/**
 * HR POLICY — VIEW + ADMIN/HR EDIT & DELETE · LIVE dryrun UAT (opt-in,
 * DB-touching).
 *
 * Verifies against tmi_officeverse_dryrun that:
 *   - `getPolicy` returns the COMPLETE content + full metadata for every role
 *     once a policy is PUBLISHED (the View action's data path)
 *   - HR/Admin may edit a policy that is already PUBLISHED, in place (no
 *     duplicate row) — status is never a barrier to edit
 *   - Delete removes a policy from every list (incl. Admin/HR) and blocks
 *     further reads for every role; the audit trail records created →
 *     published → deleted
 *   - Agent/Closer are rejected server-side on save / publish / delete
 *
 * SAFETY: asserts SELECT DATABASE() first. Every row created here is prefixed
 * "UAT VD" and is deleted (+ its audit rows) in afterAll. Never touches a
 * pre-existing policy or unrelated audit history.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import type { User } from "@/lib/db/schema";
import {
  deletePolicy,
  getPolicy,
  listPolicies,
  savePolicy,
  setPolicyStatus,
} from "@/server/hr-policy/service";

const ADMIN = { id: 1, role: "admin" } as unknown as User;
const HR = { id: 2, role: "hr" } as unknown as User;
const AGENT = { id: 3, role: "agent" } as unknown as User;
const CLOSER = { id: 5, role: "closer" } as unknown as User;
const sfx = Date.now().toString().slice(-8);

let conn: mysql.Connection;
const policyIds: number[] = [];

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const [r] = (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown];
  if (r[0]!.v !== "tmi_officeverse_dryrun") throw new Error("REFUSING " + r[0]!.v);
});
afterAll(async () => {
  if (policyIds.length) {
    await conn.query("DELETE FROM audit_logs WHERE entity_type='hr_policy' AND entity_id IN (?)", [
      policyIds,
    ]);
    await conn.query("DELETE FROM hr_policies WHERE id IN (?)", [policyIds]);
  }
  await conn.end();
});

test("View returns complete content + metadata for a published policy", async () => {
  const draft = await savePolicy(HR, {
    title: `UAT VD Policy ${sfx}`,
    content: "Line1\nLine2\nLine3 — complete, not truncated.",
    effective_date: "2026-11-01",
  });
  policyIds.push(draft.id);
  const pub = await setPolicyStatus(ADMIN, draft.id, true);
  expect(pub.status).toBe("PUBLISHED");

  for (const actor of [AGENT, CLOSER, HR, ADMIN]) {
    const viewed = await getPolicy(actor, draft.id);
    expect(viewed.content).toBe("Line1\nLine2\nLine3 — complete, not truncated.");
    expect(viewed.title).toBe(draft.title);
    expect(viewed.effective_date).toBe("2026-11-01");
    expect(viewed.published_by_name).toBeTruthy();
    expect(viewed.published_at).toBeTruthy();
    expect(viewed.updated_at).toBeTruthy();
  }
});

test("HR/Admin can edit a PUBLISHED policy (not restricted by status)", async () => {
  const draft = await savePolicy(HR, { title: `UAT VD Edit ${sfx}`, content: "v1" });
  policyIds.push(draft.id);
  await setPolicyStatus(ADMIN, draft.id, true);
  const edited = await savePolicy(ADMIN, {
    id: draft.id,
    title: `UAT VD Edit ${sfx} v2`,
    content: "v2",
  });
  expect(edited.status).toBe("PUBLISHED"); // still published
  expect(edited.content).toBe("v2");
  const rows = (await listPolicies(HR)).rows;
  expect(rows.filter((p) => p.id === draft.id).length).toBe(1); // no duplicate row created
});

test("Delete removes it from every list and blocks further view; audit kept", async () => {
  const draft = await savePolicy(HR, { title: `UAT VD Delete ${sfx}`, content: "to be deleted" });
  policyIds.push(draft.id);
  await setPolicyStatus(ADMIN, draft.id, true);
  expect((await listPolicies(AGENT)).rows.some((p) => p.id === draft.id)).toBe(true);

  // agent/closer cannot delete
  await expect(deletePolicy(AGENT, draft.id)).rejects.toMatchObject({ status: 403 });
  await expect(deletePolicy(CLOSER, draft.id)).rejects.toMatchObject({ status: 403 });

  const res = await deletePolicy(HR, draft.id);
  expect(res.ok).toBe(true);

  expect((await listPolicies(AGENT)).rows.some((p) => p.id === draft.id)).toBe(false);
  expect((await listPolicies(ADMIN)).rows.some((p) => p.id === draft.id)).toBe(false);
  await expect(getPolicy(AGENT, draft.id)).rejects.toMatchObject({ status: 404 });
  await expect(getPolicy(ADMIN, draft.id)).rejects.toMatchObject({ status: 404 });

  const [audit] = (await conn.query(
    "SELECT action FROM audit_logs WHERE entity_type='hr_policy' AND entity_id=? ORDER BY id",
    [draft.id],
  )) as [Array<{ action: string }>, unknown];
  expect(audit.map((a) => a.action)).toEqual([
    "hr_policy.created",
    "hr_policy.published",
    "hr_policy.deleted",
  ]);
});

test("Agent/Closer cannot edit or delete (server-side rejection)", async () => {
  const draft = await savePolicy(HR, { title: `UAT VD Perm ${sfx}`, content: "x" });
  policyIds.push(draft.id);
  await setPolicyStatus(ADMIN, draft.id, true);

  for (const actor of [AGENT, CLOSER]) {
    await expect(
      savePolicy(actor, { id: draft.id, title: "hacked", content: "hacked" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(setPolicyStatus(actor, draft.id, false)).rejects.toMatchObject({ status: 403 });
    await expect(deletePolicy(actor, draft.id)).rejects.toMatchObject({ status: 403 });
  }
  // still published + unmodified after the rejected attempts
  const still = await getPolicy(ADMIN, draft.id);
  expect(still.status).toBe("PUBLISHED");
  expect(still.title).toBe(`UAT VD Perm ${sfx}`);
});
