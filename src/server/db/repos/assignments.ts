/**
 * Officeverse — Assignment Control repositories (Phase 22). DATA ACCESS ONLY.
 *
 * Roster + workload queries for the three reassignment operations, and the
 * scoped bulk-update primitives. Every workload query filters to the
 * authoritative ACTIVE status set (see authz/assignments.ts) so archived /
 * terminal records never leak into a reassignment list. Nothing here is read by
 * payroll / gamification / Office-TV code.
 */
import { and, asc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  agents,
  closers,
  followUps,
  leadAssignments,
  leads,
  users,
  type NewLeadAssignment,
} from "@/lib/db/schema";
import {
  ASSIGNABLE_CLOSER_LEAD_STATUSES,
  ASSIGNABLE_FOLLOWUP_STATUSES,
} from "../../authz/assignments";

/* -------------------------- owner validation ----------------------- */

/** The role of a user id, or null if unknown. Used to guarantee a follow-up
 *  destination actually IS an agent (for AGENT_FOLLOWUPS) / a closer (for
 *  CLOSER_FOLLOWUPS) — a client can never move work to a mismatched role. */
export async function roleOfUser(userId: number, ex: DBX = getDb()): Promise<string | null> {
  const rows = await ex
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.role ?? null;
}

/** True when `closerId` is a real closers.id. */
export async function closerExists(closerId: number, ex: DBX = getDb()): Promise<boolean> {
  const rows = await ex
    .select({ id: closers.id })
    .from(closers)
    .where(eq(closers.id, closerId))
    .limit(1);
  return rows.length > 0;
}

/* ------------------------------ roster ----------------------------- */

export interface RosterEntry {
  userId: number;
  staffId: number; // agents.id / closers.id
  name: string;
  code: string;
  status: string;
  photoAvailable: boolean;
}

export async function listAgentRoster(ex: DBX = getDb()): Promise<RosterEntry[]> {
  const rows = await ex
    .select({
      userId: users.id,
      staffId: agents.id,
      name: users.fullName,
      code: agents.agentCode,
      status: users.status,
      photoAssetId: users.photoAssetId,
    })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .orderBy(asc(users.fullName));
  return rows.map((r) => ({
    userId: r.userId,
    staffId: r.staffId,
    name: r.name,
    code: r.code,
    status: r.status,
    photoAvailable: r.photoAssetId != null,
  }));
}

export async function listCloserRoster(ex: DBX = getDb()): Promise<RosterEntry[]> {
  const rows = await ex
    .select({
      userId: users.id,
      staffId: closers.id,
      name: users.fullName,
      code: closers.closerCode,
      status: users.status,
      photoAssetId: users.photoAssetId,
    })
    .from(closers)
    .innerJoin(users, eq(users.id, closers.userId))
    .orderBy(asc(users.fullName));
  return rows.map((r) => ({
    userId: r.userId,
    staffId: r.staffId,
    name: r.name,
    code: r.code,
    status: r.status,
    photoAvailable: r.photoAssetId != null,
  }));
}

/** owner_user_id → count of active (SCHEDULED) follow-ups, for one owner role. */
export async function followupCountsByOwner(
  ownerRole: "agent" | "closer",
  ex: DBX = getDb(),
): Promise<Map<number, number>> {
  const rows = await ex
    .select({ ownerUserId: followUps.ownerUserId, n: sql<number>`count(*)` })
    .from(followUps)
    .where(
      and(
        eq(followUps.ownerRole, ownerRole),
        inArray(followUps.status, [...ASSIGNABLE_FOLLOWUP_STATUSES]),
      ),
    )
    .groupBy(followUps.ownerUserId);
  return new Map(rows.map((r) => [r.ownerUserId, Number(r.n)]));
}

/** closers.id → count of active (in-flight) leads. */
export async function leadCountsByCloser(ex: DBX = getDb()): Promise<Map<number, number>> {
  const rows = await ex
    .select({ closerId: leads.assignedCloserId, n: sql<number>`count(*)` })
    .from(leads)
    .where(inArray(leads.status, [...ASSIGNABLE_CLOSER_LEAD_STATUSES]))
    .groupBy(leads.assignedCloserId);
  const m = new Map<number, number>();
  for (const r of rows) if (r.closerId != null) m.set(r.closerId, Number(r.n));
  return m;
}

/* ----------------------------- workloads --------------------------- */

export interface FollowupWorkRow {
  id: number;
  code: string;
  customerName: string;
  scheduledAt: string;
  status: string;
  ownerUserId: number;
  leadCode: string | null;
  /** the lead's CLOSER — shown read-only so Admin can see it is NOT changing */
  closerName: string | null;
}

function followupSearch(q: string | undefined): SQL | undefined {
  if (!q || !q.trim()) return undefined;
  const term = `%${q.trim()}%`;
  return or(
    like(followUps.customerName, term),
    like(followUps.followUpCode, term),
    like(followUps.email, term),
  );
}

export async function followupWorkload(
  ownerUserId: number,
  ownerRole: "agent" | "closer",
  q: string | undefined,
  ex: DBX = getDb(),
): Promise<FollowupWorkRow[]> {
  const closerUser = users;
  const conds: SQL[] = [
    eq(followUps.ownerUserId, ownerUserId),
    eq(followUps.ownerRole, ownerRole),
    inArray(followUps.status, [...ASSIGNABLE_FOLLOWUP_STATUSES]),
  ];
  const s = followupSearch(q);
  if (s) conds.push(s);

  const rows = await ex
    .select({
      id: followUps.id,
      code: followUps.followUpCode,
      customerName: followUps.customerName,
      scheduledAt: followUps.scheduledAt,
      status: followUps.status,
      ownerUserId: followUps.ownerUserId,
      leadCode: leads.leadCode,
      closerName: closerUser.fullName,
    })
    .from(followUps)
    .leftJoin(leads, eq(leads.id, followUps.leadId))
    .leftJoin(closers, eq(closers.id, leads.assignedCloserId))
    .leftJoin(closerUser, eq(closerUser.id, closers.userId))
    .where(and(...conds))
    .orderBy(asc(followUps.scheduledAt))
    .limit(2000);

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    customerName: r.customerName,
    scheduledAt: r.scheduledAt,
    status: r.status,
    ownerUserId: r.ownerUserId,
    leadCode: r.leadCode ?? null,
    closerName: r.closerName ?? null,
  }));
}

export interface LeadWorkRow {
  id: number;
  leadCode: string;
  customerName: string;
  status: string;
  assignedCloserId: number;
  /** the ORIGINATING agent — shown read-only so Admin can see it is NOT changing */
  agentName: string | null;
}

export async function closerLeadWorkload(
  closerId: number,
  q: string | undefined,
  ex: DBX = getDb(),
): Promise<LeadWorkRow[]> {
  const agentUser = users;
  const conds: SQL[] = [
    eq(leads.assignedCloserId, closerId),
    inArray(leads.status, [...ASSIGNABLE_CLOSER_LEAD_STATUSES]),
  ];
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    const grp = or(
      like(leads.customerName, term),
      like(leads.leadCode, term),
      like(leads.email, term),
    );
    if (grp) conds.push(grp);
  }

  const rows = await ex
    .select({
      id: leads.id,
      leadCode: leads.leadCode,
      customerName: leads.customerName,
      status: leads.status,
      assignedCloserId: leads.assignedCloserId,
      agentName: agentUser.fullName,
    })
    .from(leads)
    .leftJoin(agents, eq(agents.id, leads.agentId))
    .leftJoin(agentUser, eq(agentUser.id, agents.userId))
    .where(and(...conds))
    .orderBy(asc(leads.id))
    .limit(2000);

  return rows.map((r) => ({
    id: r.id,
    leadCode: r.leadCode,
    customerName: r.customerName,
    status: r.status,
    assignedCloserId: r.assignedCloserId ?? 0,
    agentName: r.agentName ?? null,
  }));
}

/* --------------------------- scoped writes ------------------------- *
 * Each UPDATE re-checks the current owner + the eligible status set in its
 * WHERE clause, so a record that moved between the plan and the write is not
 * touched. Returns the number of rows actually changed.                         */

export async function reassignFollowupOwner(
  ids: number[],
  fromUserId: number,
  toUserId: number,
  ownerRole: "agent" | "closer",
  nowWall: string,
  ex: DBX = getDb(),
): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await ex
    .update(followUps)
    .set({ ownerUserId: toUserId, updatedAt: nowWall })
    .where(
      and(
        inArray(followUps.id, ids),
        eq(followUps.ownerUserId, fromUserId),
        eq(followUps.ownerRole, ownerRole),
        inArray(followUps.status, [...ASSIGNABLE_FOLLOWUP_STATUSES]),
      ),
    );
  return rowsAffected(res);
}

export async function reassignLeadCloser(
  ids: number[],
  fromCloserId: number,
  toCloserId: number,
  nowWall: string,
  ex: DBX = getDb(),
): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await ex
    .update(leads)
    .set({ assignedCloserId: toCloserId, updatedAt: nowWall })
    .where(
      and(
        inArray(leads.id, ids),
        eq(leads.assignedCloserId, fromCloserId),
        inArray(leads.status, [...ASSIGNABLE_CLOSER_LEAD_STATUSES]),
      ),
    );
  return rowsAffected(res);
}

export async function insertLeadAssignmentHistory(
  rows: NewLeadAssignment[],
  ex: DBX = getDb(),
): Promise<void> {
  if (rows.length === 0) return;
  await ex.insert(leadAssignments).values(rows);
}

function rowsAffected(res: unknown): number {
  const r = res as unknown as [{ affectedRows?: number }] | { affectedRows?: number };
  if (Array.isArray(r)) return Number(r[0]?.affectedRows ?? 0);
  return Number((r as { affectedRows?: number }).affectedRows ?? 0);
}
