/**
 * Admin/Lead UAT §2 + §3–§7 — LIVE dryrun verification (opt-in, DB-touching).
 *
 * Covers:
 *   §2  TRUE hard delete — the lead row AND its duplicate-detection identity
 *       (`phone_normalized`) are gone; follow-up / attempt references detach;
 *       assignment + document rows go; the deletion event is audited with a
 *       MASKED phone only (last 4).
 *   §2  the deleted phone is no longer a duplicate, and the same phone can be
 *       submitted as a brand-new lead.
 *   §3–§6  optional agent + closer document upload, server-side type + size
 *          rejection, unauthorized-access denial, download round-trips bytes.
 *
 * SAFETY: asserts SELECT DATABASE() == tmi_officeverse_dryrun first. Every row
 * it creates is deleted in afterAll (by id > baseline). NEVER touches
 * audit_logs beyond asserting the one hard-delete row it caused (left in place
 * — the audit log is append-only by design).
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/vitest run \
 *     src/server/__tests__/lead-hard-delete-documents.itest.ts --config vitest.itest.config.ts
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import { getDb } from "@/lib/db";
import { followUpAttempts, followUps, leadAssignments, leads } from "@/lib/db/schema";
import type { User } from "@/lib/db/schema";
import * as repo from "../db/repos/leads";
import * as svc from "../leads/service";
import * as docSvc from "../leads/document-service";
import { currentShiftDate, nowIST } from "../time";

const ADMIN = { id: 1, role: "admin", process: "US" } as unknown as User;
const AGENT = { id: 3, role: "agent", process: "US" } as unknown as User; // agents.id 1
const AGENT_ID = 1;
const OTHER_AGENT = { id: 4, role: "agent", process: "US" } as unknown as User; // agents.id 2
const CLOSER = { id: 5, role: "closer", process: "US" } as unknown as User; // closers.id 1
const CLOSER_ID = 1;

const PHONE = "+1 (305) 555-0187";
const PHONE_NORM = "13055550187";
const PHONE_LAST10 = "3055550187";

const PDF = (() => {
  const b = new Uint8Array(512);
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]); // "%PDF-1.4"
  return b;
})();
const ELF = (() => {
  const b = new Uint8Array(256);
  b.set([0x7f, 0x45, 0x4c, 0x46]);
  return b;
})();

let conn: mysql.Connection;
const base = { lead: 0, fu: 0, fa: 0, asg: 0, doc: 0, aud: 0 };
const createdLeadIds: number[] = [];
const createdFuIds: number[] = [];
const createdFaIds: number[] = [];

const scalar = async (sql: string, args: unknown[] = []): Promise<number> => {
  const [rows] = (await conn.query(sql, args)) as [Record<string, unknown>[], unknown];
  return Number(Object.values(rows[0] ?? { v: 0 })[0]);
};

async function insertLeadRow(over: Partial<typeof leads.$inferInsert> = {}): Promise<{
  id: number;
  code: string;
}> {
  const code = await repo.nextLeadCode();
  const row = await repo.insertLead({
    leadCode: code,
    shiftDate: currentShiftDate("US"),
    customerName: "UAT HardDelete Subject",
    phone: PHONE,
    phoneNormalized: PHONE_NORM,
    debtAmount: "0.00",
    agentId: AGENT_ID,
    assignedCloserId: CLOSER_ID,
    status: "ASSIGNED",
    source: "app",
    createdAt: nowIST(),
    updatedAt: nowIST(),
    ...over,
  });
  createdLeadIds.push(row.id);
  return { id: row.id, code: row.leadCode };
}

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const db = (
    (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown]
  )[0][0]!.v;
  if (db !== "tmi_officeverse_dryrun") {
    throw new Error(`REFUSING TO RUN — DATABASE() is "${db}", expected tmi_officeverse_dryrun`);
  }
  base.lead = await scalar("SELECT COALESCE(MAX(id),0) v FROM leads");
  base.fu = await scalar("SELECT COALESCE(MAX(id),0) v FROM follow_ups");
  base.fa = await scalar("SELECT COALESCE(MAX(id),0) v FROM follow_up_attempts");
  base.asg = await scalar("SELECT COALESCE(MAX(id),0) v FROM lead_assignments");
  base.doc = await scalar("SELECT COALESCE(MAX(id),0) v FROM lead_documents");
  base.aud = await scalar("SELECT COALESCE(MAX(id),0) v FROM audit_logs");

  // no stale copy of the test phone from a previous aborted run
  await conn.query("DELETE FROM leads WHERE phone_normalized = ?", [PHONE_NORM]);
});

afterAll(async () => {
  // children first, then leads — by id > baseline only
  await conn.query("DELETE FROM lead_documents WHERE id > ?", [base.doc]);
  await conn.query("DELETE FROM lead_assignments WHERE id > ?", [base.asg]);
  if (createdFaIds.length) {
    await conn.query("DELETE FROM follow_up_attempts WHERE id IN (?)", [createdFaIds]);
  }
  if (createdFuIds.length) {
    await conn.query("DELETE FROM follow_ups WHERE id IN (?)", [createdFuIds]);
  }
  await conn.query("DELETE FROM leads WHERE phone_normalized = ?", [PHONE_NORM]);
  await conn.query("DELETE FROM leads WHERE id > ?", [base.lead]);
  // audit_logs: append-only — leave the hard_delete rows we caused in place.
  await conn.end();
});

test("§2 — hard delete removes the lead, its dup identity, and detaches every reference", async () => {
  const { id, code } = await insertLeadRow();

  // a follow-up + attempt + assignment + document all pointing at this lead
  const db = getDb();
  await db.insert(followUps).values({
    followUpCode: `FU_${String(90000000 + id).slice(-8)}`,
    ownerUserId: AGENT.id,
    ownerRole: "agent",
    customerName: "UAT HardDelete Subject",
    phone: PHONE,
    phoneNormalized: PHONE_NORM,
    captureDate: currentShiftDate("US"),
    scheduledAt: nowIST(),
    leadId: id,
    convertedLeadCode: code,
    status: "SCHEDULED",
    source: "app",
    createdByUserId: AGENT.id,
    createdAt: nowIST(),
    updatedAt: nowIST(),
  } as typeof followUps.$inferInsert);
  const fuId = await scalar("SELECT COALESCE(MAX(id),0) v FROM follow_ups");
  createdFuIds.push(fuId);

  await db.insert(followUpAttempts).values({
    followUpId: fuId,
    attemptNo: 1,
    scheduledAt: nowIST(),
    outcome: "SCHEDULED",
    relatedLeadId: id,
    relatedLeadCode: code,
    recordedAt: nowIST(),
    recordedByUserId: AGENT.id,
  } as typeof followUpAttempts.$inferInsert);
  const faId = await scalar("SELECT COALESCE(MAX(id),0) v FROM follow_up_attempts");
  createdFaIds.push(faId);

  await db.insert(leadAssignments).values({
    leadId: id,
    fromCloserId: null,
    toCloserId: CLOSER_ID,
    action: "assign",
    byUserId: ADMIN.id,
    note: "uat",
    createdAt: nowIST(),
  } as typeof leadAssignments.$inferInsert);

  // a real stored document (blob lands in the same in-process store)
  await docSvc.uploadLeadDocument(ADMIN, code, { bytes: PDF, filename: "before-delete.pdf" });
  expect(await scalar("SELECT COUNT(*) v FROM lead_documents WHERE lead_id = ?", [id])).toBe(1);

  // dup check sees it BEFORE the delete
  const dupBefore = await repo.findPossibleDuplicates({ phoneLast10: PHONE_LAST10 });
  expect(dupBefore.some((r) => r.id === id)).toBe(true);

  // ACT
  const res = await svc.deleteLead(ADMIN, code, { ip: "127.0.0.1", userAgent: "itest" });
  expect(res.deleted).toBe(true);
  expect(res.phone_last4).toBe("0187");
  expect(res.documents_removed).toBe(1);
  expect(res.document_blobs_removed).toBe(1);
  expect(res.assignments_removed).toBe(1);
  expect(res.follow_ups_detached).toBeGreaterThanOrEqual(2); // id ref + code ref
  expect(res.follow_up_attempts_detached).toBeGreaterThanOrEqual(2);

  // lead row is GONE
  expect(await repo.getLeadByCode(code)).toBeUndefined();
  expect(await scalar("SELECT COUNT(*) v FROM leads WHERE id = ?", [id])).toBe(0);

  // duplicate-detection identity is GONE
  expect(
    await scalar("SELECT COUNT(*) v FROM leads WHERE phone_normalized = ?", [PHONE_NORM]),
  ).toBe(0);
  const dupAfter = await repo.findPossibleDuplicates({ phoneLast10: PHONE_LAST10 });
  expect(dupAfter).toHaveLength(0);

  // references detached, not deleted
  expect(await scalar("SELECT COUNT(*) v FROM follow_ups WHERE id = ?", [fuId])).toBe(1);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM follow_ups WHERE id = ? AND lead_id IS NULL AND converted_lead_code IS NULL",
      [fuId],
    ),
  ).toBe(1);
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM follow_up_attempts WHERE id = ? AND related_lead_id IS NULL AND related_lead_code IS NULL",
      [faId],
    ),
  ).toBe(1);
  expect(await scalar("SELECT COUNT(*) v FROM lead_assignments WHERE lead_id = ?", [id])).toBe(0);
  expect(await scalar("SELECT COUNT(*) v FROM lead_documents WHERE lead_id = ?", [id])).toBe(0);

  // the deletion event is audited — MASKED phone only, never the full number
  const [audRows] = (await conn.query(
    "SELECT action, metadata FROM audit_logs WHERE entity_type='lead' AND action='lead.hard_delete' AND id > ? ORDER BY id DESC LIMIT 1",
    [base.aud],
  )) as [Array<{ action: string; metadata: unknown }>, unknown];
  expect(audRows[0]?.action).toBe("lead.hard_delete");
  const meta = (
    typeof audRows[0]?.metadata === "string"
      ? JSON.parse(audRows[0]!.metadata as string)
      : audRows[0]?.metadata
  ) as Record<string, unknown>;
  expect(meta["phone_last4"]).toBe("0187");
  const metaStr = JSON.stringify(meta);
  expect(metaStr).not.toContain(PHONE_NORM);
  expect(metaStr).not.toContain(PHONE_LAST10);
});

test("§2 — the deleted phone is reusable for a brand-new lead", async () => {
  // no duplicate reported for the freed phone
  const dup = await svc.checkLeadDuplicate(ADMIN, { phone: PHONE });
  expect(dup.phone.duplicate?.visible ?? false).toBe(false);

  // and a fresh lead with that exact phone inserts cleanly
  const again = await insertLeadRow({ customerName: "Reused Phone OK" });
  expect(again.id).toBeGreaterThan(0);
  const fresh = await repo.getLeadByCode(again.code);
  expect(fresh?.phoneNormalized).toBe(PHONE_NORM);

  // clean it back out via the same hard delete
  const res = await svc.deleteLead(ADMIN, again.code, {});
  expect(res.deleted).toBe(true);
  expect(
    await scalar("SELECT COUNT(*) v FROM leads WHERE phone_normalized = ?", [PHONE_NORM]),
  ).toBe(0);
});

test("§3–§6 — optional document upload: agent + closer allowed, strangers denied", async () => {
  const { id, code } = await insertLeadRow({ customerName: "Doc Access Subject" });

  // agent that OWNS the lead
  const asAgent = await docSvc.uploadLeadDocument(AGENT, code, {
    bytes: PDF,
    filename: "agent-scan.pdf",
  });
  expect(asAgent.file_name).toBe("agent-scan.pdf");
  expect(asAgent.mime).toBe("application/pdf");

  // closer ASSIGNED to the lead
  const asCloser = await docSvc.uploadLeadDocument(CLOSER, code, {
    bytes: PDF,
    filename: "closer-doc.pdf",
  });
  expect(asCloser.uploaded_by_role).toBe("closer");

  // a DIFFERENT agent cannot touch it
  await expect(
    docSvc.uploadLeadDocument(OTHER_AGENT, code, { bytes: PDF, filename: "nope.pdf" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(docSvc.listLeadDocuments(OTHER_AGENT, code)).rejects.toMatchObject({ status: 403 });

  // list is visible to the owner; download round-trips the exact bytes
  const list = await docSvc.listLeadDocuments(AGENT, code);
  expect(list).toHaveLength(2);
  const dl = await docSvc.downloadLeadDocument(AGENT, asAgent.id);
  expect(Buffer.from(dl.base64, "base64").equals(Buffer.from(PDF))).toBe(true);

  // stranger cannot download either
  await expect(docSvc.downloadLeadDocument(OTHER_AGENT, asAgent.id)).rejects.toMatchObject({
    status: 403,
  });

  // hard delete cleans documents + blobs
  const res = await svc.deleteLead(ADMIN, code, {});
  expect(res.documents_removed).toBe(2);
  expect(res.document_blobs_removed).toBe(2);
  expect(await scalar("SELECT COUNT(*) v FROM lead_documents WHERE lead_id = ?", [id])).toBe(0);
});

test("§5 — server rejects a disguised executable and an oversized file", async () => {
  const { code } = await insertLeadRow({ customerName: "File Security Subject" });

  await expect(
    docSvc.uploadLeadDocument(AGENT, code, {
      bytes: ELF,
      filename: "totally-a.pdf",
      declaredMime: "application/pdf",
    }),
  ).rejects.toMatchObject({ status: 422, code: "unsupported_file_type" });

  const huge = new Uint8Array(docSvc.MAX_LEAD_DOC_BASE64); // decoded length well over 10 MB
  huge.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  await expect(
    docSvc.uploadLeadDocument(AGENT, code, { bytes: huge, filename: "huge.pdf" }),
  ).rejects.toMatchObject({ status: 422, code: "file_too_large" });

  // lead still has zero documents — nothing partial slipped through
  const list = await docSvc.listLeadDocuments(AGENT, code);
  expect(list).toHaveLength(0);

  await svc.deleteLead(ADMIN, code, {});
});

test("§7 — a lead with NO document still deletes cleanly (upload is optional)", async () => {
  const { id, code } = await insertLeadRow({ customerName: "No Doc Subject" });
  const res = await svc.deleteLead(ADMIN, code, {});
  expect(res.deleted).toBe(true);
  expect(res.documents_removed).toBe(0);
  expect(res.document_blobs_removed).toBe(0);
  expect(await scalar("SELECT COUNT(*) v FROM leads WHERE id = ?", [id])).toBe(0);
});
