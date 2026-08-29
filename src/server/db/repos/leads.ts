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
  leadAssignments,
  leads,
  type Lead,
  type LeadAssignment,
  type NewLead,
  type NewLeadAssignment,
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
  if (query.shiftDateFrom) conds.push(gte(leads.shiftDate, query.shiftDateFrom));
  if (query.shiftDateTo) conds.push(lte(leads.shiftDate, query.shiftDateTo));
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

/**
 * Read-only duplicate lookup (normalized phone / email). The BUSINESS RULE for
 * what counts as a duplicate is NOT yet defined (see report O) — callers may
 * surface these but must not auto-block or auto-merge.
 */
export async function findPossibleDuplicates(opts: {
  phoneNormalized?: string | null;
  emailNormalized?: string | null;
  excludeId?: number;
}): Promise<Lead[]> {
  const matches: SQL[] = [];
  if (opts.phoneNormalized) matches.push(eq(leads.phoneNormalized, opts.phoneNormalized));
  if (opts.emailNormalized) matches.push(eq(leads.emailNormalized, opts.emailNormalized));
  if (!matches.length) return [];
  const grouped = or(...matches);
  if (!grouped) return [];
  const where = opts.excludeId ? and(grouped, ne(leads.id, opts.excludeId)) : grouped;
  return getDb().select().from(leads).where(where).limit(25);
}
