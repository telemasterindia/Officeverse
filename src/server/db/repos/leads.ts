/**
 * Officeverse — Lead repository (Phase 3). DATA ACCESS ONLY.
 *
 * No authorization decisions here — those live in ../../authz/leads.ts and are
 * enforced by ../../leads/service.ts. Uses the shared connection in
 * src/lib/db/index.ts; never opens its own connection.
 */
import { and, asc, desc, eq, gte, like, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  agents,
  closers,
  followUpAttempts,
  followUps,
  leadAssignments,
  leadDocuments,
  leads,
  users,
  type Lead,
  type LeadAssignment,
  type LeadDocument,
  type NewLead,
  type NewLeadAssignment,
  type NewLeadDocument,
} from "@/lib/db/schema";
import { leadCode as fmtLeadCode, nextLeadSeq } from "../../ids";

/**
 * Every function accepts an optional executor so the Phase-4 conversion can run
 * lead creation inside a single MySQL transaction. Defaults to the shared pool.
 */

export async function getLeadById(id: number, ex: DBX = getDb()): Promise<Lead | undefined> {
  const rows = await ex.select().from(leads).where(eq(leads.id, id)).limit(1);
  return rows[0];
}

export async function getLeadByCode(code: string, ex: DBX = getDb()): Promise<Lead | undefined> {
  const rows = await ex.select().from(leads).where(eq(leads.leadCode, code)).limit(1);
  return rows[0];
}

/**
 * Next Lead code, preserving the existing convention (start 12000, step +7 —
 * see the old nextLeadId). Uses MAX over the numeric part; the caller retries
 * once on the unique-constraint race.
 */
export async function nextLeadCode(ex: DBX = getDb()): Promise<string> {
  const rows = await ex
    .select({ max: sql<number | null>`max(cast(substring(${leads.leadCode}, 5) as unsigned))` })
    .from(leads);
  const max = Number(rows[0]?.max ?? 0);
  return fmtLeadCode(nextLeadSeq(max));
}

export interface ListLeadsQuery {
  scope?: SQL | undefined;
  status?: Lead["status"] | undefined;
  q?: string | undefined;
  qDigits?: string | undefined;
  shiftDateFrom?: string | undefined;
  shiftDateTo?: string | undefined;
  closerId?: number | undefined;
  agentId?: number | undefined;
  /** Admin UAT §3 — process of the lead (its originating agent, or its closer). */
  process?: "US" | "UK" | "IN" | "AU" | undefined;
  /** UAT #9: exclude rows whose lead_file equals this marker (demo/seed leads) */
  hideLeadFile?: string | undefined;
  sort: "newest" | "oldest";
  limit: number;
  offset: number;
}

export async function listLeads(query: ListLeadsQuery): Promise<{ rows: Lead[]; total: number }> {
  const conds: SQL[] = [];
  if (query.scope) conds.push(query.scope);
  if (query.status) conds.push(eq(leads.status, query.status));
  if (query.closerId != null) conds.push(eq(leads.assignedCloserId, query.closerId));
  if (query.agentId != null) conds.push(eq(leads.agentId, query.agentId));
  if (query.process) {
    // A lead belongs to a process via its originating agent, or (conversion
    // leads with no agent) via its assigned closer. Server-enforced.
    conds.push(
      sql`(${leads.agentId} in (select ${agents.id} from ${agents}
             inner join ${users} on ${users.id} = ${agents.userId}
             where ${users.process} = ${query.process})
        or ${leads.assignedCloserId} in (select ${closers.id} from ${closers}
             inner join ${users} on ${users.id} = ${closers.userId}
             where ${users.process} = ${query.process}))`,
    );
  }
  if (query.shiftDateFrom) conds.push(gte(leads.shiftDate, query.shiftDateFrom));
  if (query.shiftDateTo) conds.push(lte(leads.shiftDate, query.shiftDateTo));
  if (query.hideLeadFile) {
    conds.push(sql`(${leads.leadFile} is null or ${leads.leadFile} <> ${query.hideLeadFile})`);
  }
  if (query.q && query.q.trim()) {
    const term = `%${query.q.trim()}%`;
    const parts: SQL[] = [
      like(leads.customerName, term),
      like(leads.leadCode, term),
      like(leads.email, term),
    ];
    if (query.qDigits && query.qDigits.length >= 3) {
      parts.push(like(leads.phoneNormalized, `%${query.qDigits}%`));
    }
    const grouped = or(...parts);
    if (grouped) conds.push(grouped);
  }

  const where = conds.length ? and(...conds) : undefined;
  const orderBy = query.sort === "oldest" ? asc(leads.id) : desc(leads.id);
  const db = getDb();

  const [rows, totals] = await Promise.all([
    db.select().from(leads).where(where).orderBy(orderBy).limit(query.limit).offset(query.offset),
    db
      .select({ n: sql<number>`count(*)` })
      .from(leads)
      .where(where),
  ]);
  return { rows, total: Number(totals[0]?.n ?? 0) };
}

export async function insertLead(values: NewLead, ex: DBX = getDb()): Promise<Lead> {
  const res = await ex.insert(leads).values(values);
  const insertId = Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
  const row = insertId ? await getLeadById(insertId, ex) : await getLeadByCode(values.leadCode, ex);
  if (!row) throw new Error("Lead insert did not return a row");
  return row;
}

export async function updateLead(id: number, patch: Partial<NewLead>): Promise<Lead | undefined> {
  await getDb().update(leads).set(patch).where(eq(leads.id, id));
  return getLeadById(id);
}

export async function setAssignedCloser(
  id: number,
  closerId: number | null,
  status: Lead["status"],
  updatedAt: string,
): Promise<void> {
  await getDb()
    .update(leads)
    .set({ assignedCloserId: closerId, status, updatedAt })
    .where(eq(leads.id, id));
}

export async function insertAssignment(row: NewLeadAssignment, ex: DBX = getDb()): Promise<void> {
  await ex.insert(leadAssignments).values(row);
}

export async function listAssignments(leadId: number): Promise<LeadAssignment[]> {
  return getDb()
    .select()
    .from(leadAssignments)
    .where(eq(leadAssignments.leadId, leadId))
    .orderBy(asc(leadAssignments.id));
}

/* --------------------------- hard delete ----------------------------- *
 *
 * ADMIN-only TRUE hard delete (Admin/Lead UAT §2). Permanently removes the lead
 * row — and with it `leads.phone_normalized`, the duplicate-detection identity —
 * from the database. NOT a soft delete, NOT an archive.
 *
 * Dependency map (verified against information_schema on the dryrun DB):
 *   - lead_assignments.lead_id            FK ON DELETE CASCADE  → also removed
 *   - lead_documents.lead_id              FK ON DELETE CASCADE  → also removed
 *   - follow_ups.lead_id                  FK ON DELETE SET NULL → detached
 *   - follow_up_attempts.related_lead_id  FK ON DELETE SET NULL → detached
 *   - audit_logs                          no FK (generic entityId) → untouched
 *
 * We clear every reference EXPLICITLY inside one transaction (not merely relying
 * on the FK actions) so the delete is deterministic and complete even where FK
 * enforcement is disabled, and so the string *code* columns the FK actions do
 * not touch (`converted_lead_code`, `related_lead_code`) are cleared too.
 */

/** Storage keys for a lead's documents — read BEFORE the delete so the caller
 *  can unlink the blobs. */
export async function listLeadDocumentKeys(leadId: number, ex: DBX = getDb()): Promise<string[]> {
  const rows = await ex
    .select({ storageKey: leadDocuments.storageKey })
    .from(leadDocuments)
    .where(eq(leadDocuments.leadId, leadId));
  return rows.map((r) => r.storageKey);
}

export interface HardDeleteResult {
  followUpsDetached: number;
  followUpAttemptsDetached: number;
  assignmentsRemoved: number;
  documentsRemoved: number;
}

export async function hardDeleteLead(id: number, leadCode: string): Promise<HardDeleteResult> {
  return getDb().transaction(async (tx) => {
    // 1) detach follow-ups by id AND by the string code — FK is SET NULL, the
    //    `converted_lead_code` column is not covered by the FK action.
    const fuById = await tx.update(followUps).set({ leadId: null }).where(eq(followUps.leadId, id));
    const fuByCode = await tx
      .update(followUps)
      .set({ convertedLeadCode: null })
      .where(eq(followUps.convertedLeadCode, leadCode));
    // 2) detach follow-up attempts by id AND by the string code
    const faById = await tx
      .update(followUpAttempts)
      .set({ relatedLeadId: null })
      .where(eq(followUpAttempts.relatedLeadId, id));
    const faByCode = await tx
      .update(followUpAttempts)
      .set({ relatedLeadCode: null })
      .where(eq(followUpAttempts.relatedLeadCode, leadCode));
    // 3) remove assignment history rows
    const asg = await tx.delete(leadAssignments).where(eq(leadAssignments.leadId, id));
    // 4) remove document rows (blobs are unlinked by the service before this)
    const doc = await tx.delete(leadDocuments).where(eq(leadDocuments.leadId, id));
    // 5) finally remove the lead itself — takes phone_normalized with it
    await tx.delete(leads).where(eq(leads.id, id));

    const n = (r: unknown): number =>
      Number(
        (r as { rowsAffected?: number })?.rowsAffected ??
          (r as { affectedRows?: number })?.affectedRows ??
          (Array.isArray(r) ? (r[0] as { affectedRows?: number })?.affectedRows : 0) ??
          0,
      );
    return {
      followUpsDetached: n(fuById) + n(fuByCode),
      followUpAttemptsDetached: n(faById) + n(faByCode),
      assignmentsRemoved: n(asg),
      documentsRemoved: n(doc),
    };
  });
}

/* ------------------------- lead documents --------------------------- */

export async function insertLeadDocument(
  values: NewLeadDocument,
  ex: DBX = getDb(),
): Promise<LeadDocument> {
  const returned = await ex.insert(leadDocuments).values(values).$returningId();
  const insertId = Number(returned[0]?.id ?? 0);
  const rows = await ex.select().from(leadDocuments).where(eq(leadDocuments.id, insertId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error("Lead document insert did not return a row");
  return row;
}

export async function listLeadDocuments(leadId: number): Promise<LeadDocument[]> {
  return getDb()
    .select()
    .from(leadDocuments)
    .where(eq(leadDocuments.leadId, leadId))
    .orderBy(desc(leadDocuments.id));
}

export async function getLeadDocumentById(id: number): Promise<LeadDocument | undefined> {
  const rows = await getDb().select().from(leadDocuments).where(eq(leadDocuments.id, id)).limit(1);
  return rows[0];
}

export async function deleteLeadDocumentRow(id: number): Promise<void> {
  await getDb().delete(leadDocuments).where(eq(leadDocuments.id, id));
}

/**
 * Read-only duplicate lookup (normalized phone / email). The BUSINESS RULE for
 * what counts as a duplicate is NOT yet defined (see report O) — callers may
 * surface these but must not auto-block or auto-merge.
 */
export async function findPossibleDuplicates(opts: {
  phoneNormalized?: string | null;
  /** canonical last-10-digits key — matches regardless of a stored `1` prefix */
  phoneLast10?: string | null;
  emailNormalized?: string | null;
  excludeId?: number;
}): Promise<Lead[]> {
  const matches: SQL[] = [];
  if (opts.phoneLast10) {
    matches.push(sql`right(${leads.phoneNormalized}, 10) = ${opts.phoneLast10}`);
  } else if (opts.phoneNormalized) {
    matches.push(eq(leads.phoneNormalized, opts.phoneNormalized));
  }
  if (opts.emailNormalized) matches.push(eq(leads.emailNormalized, opts.emailNormalized));
  if (!matches.length) return [];
  const grouped = or(...matches);
  if (!grouped) return [];
  const where = opts.excludeId ? and(grouped, ne(leads.id, opts.excludeId)) : grouped;
  return getDb().select().from(leads).where(where).limit(25);
}
