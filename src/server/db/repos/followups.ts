/**
 * Officeverse — Follow-up repository (Phase 4). DATA ACCESS ONLY.
 *
 * No authorization here (see ../../authz/followups.ts). Every function takes an
 * optional executor so the service layer can run reschedule / complete / cancel
 * / convert inside a single MySQL transaction. `*ForUpdate` reads take a row
 * lock (SELECT … FOR UPDATE) to serialise concurrent transitions.
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  followUpAttempts,
  followUps,
  type FollowUp,
  type FollowUpAttempt,
  type NewFollowUp,
  type NewFollowUpAttempt,
} from "@/lib/db/schema";
import { followUpCode as fmtFollowUpCode, nextFollowUpSeq } from "../../ids";

/** affectedRows from a mysql2 UPDATE/DELETE result (best-effort). */
export function rowsAffected(res: unknown): number {
  const head = Array.isArray(res) ? res[0] : res;
  return Number((head as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

/* -------------------------------- reads ------------------------------- */

export async function getFollowUpById(
  id: number,
  ex: DBX = getDb(),
): Promise<FollowUp | undefined> {
  const rows = await ex.select().from(followUps).where(eq(followUps.id, id)).limit(1);
  return rows[0];
}

export async function getFollowUpByCode(
  code: string,
  ex: DBX = getDb(),
): Promise<FollowUp | undefined> {
  const rows = await ex.select().from(followUps).where(eq(followUps.followUpCode, code)).limit(1);
  return rows[0];
}

/** Row-locked read for use inside a transaction. */
export async function getFollowUpByCodeForUpdate(
  code: string,
  ex: DBX,
): Promise<FollowUp | undefined> {
  const rows = await ex
    .select()
    .from(followUps)
    .where(eq(followUps.followUpCode, code))
    .limit(1)
    .for("update");
  return rows[0];
}

export async function nextFollowUpCode(ex: DBX = getDb()): Promise<string> {
  const rows = await ex
    .select({
      max: sql<number | null>`max(cast(substring(${followUps.followUpCode}, 4) as unsigned))`,
    })
    .from(followUps);
  return fmtFollowUpCode(nextFollowUpSeq(Number(rows[0]?.max ?? 0)));
}

/* ------------------------------- listing ----------------------------- */

export interface ListFollowUpsQuery {
  ownerUserId?: number | undefined;
  /** Admin UAT §3/§4 — restrict to a role and/or a set of owner user ids */
  ownerRole?: "agent" | "closer" | undefined;
  ownerUserIdIn?: number[] | undefined;
  status?: FollowUp["status"] | undefined;
  /** derived bucket filter — mutually exclusive with a plain `status` */
  bucket?: "today" | "upcoming" | "overdue" | "completed" | undefined;
  /** IST wall-clock strings for the bucket math */
  nowWall: string;
  todayEndWall: string; // exclusive upper bound for "today"
  scheduledFrom?: string | undefined;
  scheduledTo?: string | undefined;
  q?: string | undefined;
  qDigits?: string | undefined;
  sort: "soonest" | "latest" | "newest";
  limit: number;
  offset: number;
}

export async function listFollowUps(
  query: ListFollowUpsQuery,
  ex: DBX = getDb(),
): Promise<{ rows: FollowUp[]; total: number }> {
  const conds: SQL[] = [];
  if (query.ownerUserId != null) conds.push(eq(followUps.ownerUserId, query.ownerUserId));
  if (query.ownerRole) conds.push(eq(followUps.ownerRole, query.ownerRole));
  if (query.ownerUserIdIn) {
    conds.push(
      query.ownerUserIdIn.length ? inArray(followUps.ownerUserId, query.ownerUserIdIn) : sql`1 = 0`,
    );
  }

  if (query.bucket === "today") {
    conds.push(eq(followUps.status, "SCHEDULED"));
    conds.push(gte(followUps.scheduledAt, query.nowWall));
    conds.push(lt(followUps.scheduledAt, query.todayEndWall));
  } else if (query.bucket === "upcoming") {
    conds.push(eq(followUps.status, "SCHEDULED"));
    conds.push(gte(followUps.scheduledAt, query.todayEndWall));
  } else if (query.bucket === "overdue") {
    conds.push(eq(followUps.status, "SCHEDULED"));
    conds.push(lt(followUps.scheduledAt, query.nowWall));
  } else if (query.bucket === "completed") {
    const grp = or(eq(followUps.status, "COMPLETED"), eq(followUps.status, "CONVERTED"));
    if (grp) conds.push(grp);
  } else if (query.status) {
    conds.push(eq(followUps.status, query.status));
  }

  if (query.scheduledFrom) conds.push(gte(followUps.scheduledAt, query.scheduledFrom));
  if (query.scheduledTo) conds.push(lte(followUps.scheduledAt, query.scheduledTo));

  if (query.q && query.q.trim()) {
    const term = `%${query.q.trim()}%`;
    const parts: SQL[] = [
      like(followUps.customerName, term),
      like(followUps.followUpCode, term),
      like(followUps.email, term),
    ];
    if (query.qDigits && query.qDigits.length >= 3) {
      parts.push(like(followUps.phoneNormalized, `%${query.qDigits}%`));
    }
    const grp = or(...parts);
    if (grp) conds.push(grp);
  }

  const where = conds.length ? and(...conds) : undefined;
  const orderBy =
    query.sort === "soonest"
      ? asc(followUps.scheduledAt)
      : query.sort === "latest"
        ? desc(followUps.scheduledAt)
        : desc(followUps.id);

  const [rows, totals] = await Promise.all([
    ex
      .select()
      .from(followUps)
      .where(where)
      .orderBy(orderBy)
      .limit(query.limit)
      .offset(query.offset),
    ex
      .select({ n: sql<number>`count(*)` })
      .from(followUps)
      .where(where),
  ]);
  return { rows, total: Number(totals[0]?.n ?? 0) };
}

/**
 * Active scheduled follow-ups whose `scheduledAt` falls in a window. The future
 * automation (Phase 15) will consume exactly this shape. Uses the
 * (status, scheduled_at) index.
 */
export async function listActiveScheduled(
  fromWall: string,
  toWall: string,
  ex: DBX = getDb(),
): Promise<FollowUp[]> {
  return ex
    .select()
    .from(followUps)
    .where(
      and(
        eq(followUps.status, "SCHEDULED"),
        gte(followUps.scheduledAt, fromWall),
        lte(followUps.scheduledAt, toWall),
      ),
    )
    .orderBy(asc(followUps.scheduledAt));
}

/* ------------------------------- writes ----------------------------- */

export async function insertFollowUp(values: NewFollowUp, ex: DBX = getDb()): Promise<FollowUp> {
  const res = await ex.insert(followUps).values(values);
  const insertId = Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
  const row = insertId
    ? await getFollowUpById(insertId, ex)
    : await getFollowUpByCode(values.followUpCode, ex);
  if (!row) throw new Error("Follow-up insert did not return a row");
  return row;
}

/** Customer snapshot fields only. Never touches owner / schedule / status. */
export async function updateFollowUpCustomer(
  id: number,
  patch: Partial<NewFollowUp>,
  ex: DBX = getDb(),
): Promise<FollowUp | undefined> {
  await ex.update(followUps).set(patch).where(eq(followUps.id, id));
  return getFollowUpById(id, ex);
}

/**
 * Move the current schedule. Conditional on the record still being SCHEDULED
 * (and, optionally, still pointing at `expectedScheduledAt`). Returns rows
 * affected — 0 means someone else already transitioned/rescheduled it.
 */
export async function updateFollowUpSchedule(
  id: number,
  scheduledAt: string,
  updatedAt: string,
  ex: DBX,
  expectedScheduledAt?: string,
): Promise<number> {
  const cond = expectedScheduledAt
    ? and(
        eq(followUps.id, id),
        eq(followUps.status, "SCHEDULED"),
        eq(followUps.scheduledAt, expectedScheduledAt),
      )
    : and(eq(followUps.id, id), eq(followUps.status, "SCHEDULED"));
  const res = await ex.update(followUps).set({ scheduledAt, updatedAt }).where(cond);
  return rowsAffected(res);
}

/**
 * Terminate the record. Conditional on it still being SCHEDULED — returns 0 if
 * it was already terminal (double-complete / double-cancel / double-convert).
 */
export async function setFollowUpTerminal(
  id: number,
  status: "COMPLETED" | "CANCELLED" | "CONVERTED",
  ts: string,
  ex: DBX,
  extra: { leadId?: number; convertedLeadCode?: string } = {},
): Promise<number> {
  const set: Partial<NewFollowUp> = { status, updatedAt: ts };
  if (status === "COMPLETED") set.completedAt = ts;
  if (status === "CANCELLED") set.cancelledAt = ts;
  if (status === "CONVERTED") {
    set.convertedAt = ts;
    if (extra.leadId != null) set.leadId = extra.leadId;
    if (extra.convertedLeadCode) set.convertedLeadCode = extra.convertedLeadCode;
  }
  const res = await ex
    .update(followUps)
    .set(set)
    .where(and(eq(followUps.id, id), eq(followUps.status, "SCHEDULED")));
  return rowsAffected(res);
}

/* --------------------------- attempts / history --------------------- */

export async function maxAttemptNo(followUpId: number, ex: DBX = getDb()): Promise<number> {
  const rows = await ex
    .select({ max: sql<number | null>`max(${followUpAttempts.attemptNo})` })
    .from(followUpAttempts)
    .where(eq(followUpAttempts.followUpId, followUpId));
  return Number(rows[0]?.max ?? 0);
}

export async function insertAttempt(row: NewFollowUpAttempt, ex: DBX = getDb()): Promise<void> {
  await ex.insert(followUpAttempts).values(row);
}

/**
 * Flip the current active attempt (highest attemptNo, outcome SCHEDULED) to a
 * new outcome. Conditional — returns 0 if it was not SCHEDULED any more.
 */
export async function transitionCurrentAttempt(
  followUpId: number,
  attemptNo: number,
  toOutcome: "RESCHEDULED" | "COMPLETED" | "CANCELLED" | "CONVERTED",
  note: string | null,
  ex: DBX,
  related: { relatedLeadId?: number; relatedLeadCode?: string } = {},
): Promise<number> {
  const set: Partial<NewFollowUpAttempt> = { outcome: toOutcome };
  if (note != null) set.note = note;
  if (related.relatedLeadId != null) set.relatedLeadId = related.relatedLeadId;
  if (related.relatedLeadCode) set.relatedLeadCode = related.relatedLeadCode;
  const res = await ex
    .update(followUpAttempts)
    .set(set)
    .where(
      and(
        eq(followUpAttempts.followUpId, followUpId),
        eq(followUpAttempts.attemptNo, attemptNo),
        eq(followUpAttempts.outcome, "SCHEDULED"),
      ),
    );
  return rowsAffected(res);
}

export async function listAttempts(
  followUpId: number,
  ex: DBX = getDb(),
): Promise<FollowUpAttempt[]> {
  return ex
    .select()
    .from(followUpAttempts)
    .where(eq(followUpAttempts.followUpId, followUpId))
    .orderBy(asc(followUpAttempts.attemptNo));
}

/* ---------------------- duplicate lookup (read only) ---------------- */

export async function findOwnerOpenByPhone(
  ownerUserId: number,
  phoneNormalized: string,
  ex: DBX = getDb(),
): Promise<FollowUp[]> {
  if (!phoneNormalized) return [];
  return ex
    .select()
    .from(followUps)
    .where(
      and(
        eq(followUps.ownerUserId, ownerUserId),
        eq(followUps.status, "SCHEDULED"),
        eq(followUps.phoneNormalized, phoneNormalized),
        isNull(followUps.leadId),
      ),
    )
    .limit(10);
}
