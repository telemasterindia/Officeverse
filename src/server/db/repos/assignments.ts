/**
 * Officeverse — Assignment Control repositories (Phase 22). DATA ACCESS ONLY.
 *
 * Roster + workload queries for the three reassignment operations, and the
 * scoped bulk-update primitives. Every workload query filters to the
 * authoritative ACTIVE status set (see authz/assignments.ts) so archived /
 * terminal records never leak into a reassignment list. Nothing here is read by
 * payroll / gamification / Office-TV code.
 */
import { and, asc, eq, gte, inArray, like, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  agents,
  closers,
  followUpReassignments,
  followUps,
  leadAssignments,
  leads,
  users,
  type NewFollowUpReassignment,
  type NewLeadAssignment,
} from "@/lib/db/schema";
import {
  ASSIGNABLE_CLOSER_LEAD_STATUSES,
  ASSIGNABLE_FOLLOWUP_STATUSES,
  type TransferScope,
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

/** `users.status` for a users.id, or null if unknown. A follow-up reassignment
 *  destination must be `"active"` — an inactive / deactivated / terminated
 *  employee can never receive work, even from a stale client list. */
export async function statusOfUser(userId: number, ex: DBX = getDb()): Promise<string | null> {
  const rows = await ex
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.status ?? null;
}

/** `users.status` for a closers.id (via its user), or null. */
export async function statusOfCloser(closerId: number, ex: DBX = getDb()): Promise<string | null> {
  const rows = await ex
    .select({ status: users.status })
    .from(closers)
    .innerJoin(users, eq(users.id, closers.userId))
    .where(eq(closers.id, closerId))
    .limit(1);
  return rows[0]?.status ?? null;
}

/** The process ("US" / "IN") for a users.id, or null. Used to keep bulk
 *  reassignment inside one process — work never crosses the US ⇄ India line. */
export async function processOfUser(userId: number, ex: DBX = getDb()): Promise<string | null> {
  const rows = await ex
    .select({ p: users.process })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.p ?? null;
}

/** The process for a closers.id (via its user), or null. */
export async function processOfCloser(closerId: number, ex: DBX = getDb()): Promise<string | null> {
  const rows = await ex
    .select({ p: users.process })
    .from(closers)
    .innerJoin(users, eq(users.id, closers.userId))
    .where(eq(closers.id, closerId))
    .limit(1);
  return rows[0]?.p ?? null;
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

export async function listAgentRoster(process?: string, ex: DBX = getDb()): Promise<RosterEntry[]> {
  // OPERATIONAL roster: authoritative role + active status only. A promoted
  // Agent (now users.role = 'closer') and a removed/deactivated employee are
  // excluded even though their historical `agents` row still exists.
  const conds = [eq(users.role, "agent"), eq(users.status, "active")];
  if (process) conds.push(eq(users.process, process as never));
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
    .where(and(...conds))
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

export async function listCloserRoster(
  process?: string,
  ex: DBX = getDb(),
): Promise<RosterEntry[]> {
  const conds = [eq(users.role, "closer"), eq(users.status, "active")];
  if (process) conds.push(eq(users.process, process as never));
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
    .where(and(...conds))
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

/** agents.id → count of leads where this agent is the ORIGINATING agent (all
 *  statuses — an agent's "total leads" for the workload view). */
export async function leadCountsByAgent(ex: DBX = getDb()): Promise<Map<number, number>> {
  const rows = await ex
    .select({ agentId: leads.agentId, n: sql<number>`count(*)` })
    .from(leads)
    .groupBy(leads.agentId);
  const m = new Map<number, number>();
  for (const r of rows) if (r.agentId != null) m.set(r.agentId, Number(r.n));
  return m;
}

export interface FollowupBreakdown {
  pending: number; // all SCHEDULED
  overdue: number; // SCHEDULED, scheduledAt < now
  dueToday: number; // SCHEDULED, now ≤ scheduledAt < start-of-tomorrow
  upcoming: number; // SCHEDULED, scheduledAt ≥ start-of-tomorrow
  completed: number; // COMPLETED or CONVERTED
}

const EMPTY_BREAKDOWN: FollowupBreakdown = {
  pending: 0,
  overdue: 0,
  dueToday: 0,
  upcoming: 0,
  completed: 0,
};

/**
 * owner_user_id → the six-way follow-up workload breakdown for one owner role.
 * Same bucket definitions as the follow-up list repo; time comparisons use the
 * server `now` / start-of-tomorrow wall-clock strings passed in.
 */
export async function followupBreakdownByOwner(
  ownerRole: "agent" | "closer",
  nowWall: string,
  todayEndWall: string,
  ex: DBX = getDb(),
): Promise<Map<number, FollowupBreakdown>> {
  const rows = await ex
    .select({
      ownerUserId: followUps.ownerUserId,
      pending: sql<number>`sum(case when ${followUps.status} = 'SCHEDULED' then 1 else 0 end)`,
      overdue: sql<number>`sum(case when ${followUps.status} = 'SCHEDULED' and ${followUps.scheduledAt} < ${nowWall} then 1 else 0 end)`,
      dueToday: sql<number>`sum(case when ${followUps.status} = 'SCHEDULED' and ${followUps.scheduledAt} >= ${nowWall} and ${followUps.scheduledAt} < ${todayEndWall} then 1 else 0 end)`,
      upcoming: sql<number>`sum(case when ${followUps.status} = 'SCHEDULED' and ${followUps.scheduledAt} >= ${todayEndWall} then 1 else 0 end)`,
      completed: sql<number>`sum(case when ${followUps.status} in ('COMPLETED','CONVERTED') then 1 else 0 end)`,
    })
    .from(followUps)
    .where(eq(followUps.ownerRole, ownerRole))
    .groupBy(followUps.ownerUserId);
  const m = new Map<number, FollowupBreakdown>();
  for (const r of rows) {
    m.set(r.ownerUserId, {
      pending: Number(r.pending ?? 0),
      overdue: Number(r.overdue ?? 0),
      dueToday: Number(r.dueToday ?? 0),
      upcoming: Number(r.upcoming ?? 0),
      completed: Number(r.completed ?? 0),
    });
  }
  return m;
}

export { EMPTY_BREAKDOWN };

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
  fromOwnerRole: "agent" | "closer",
  toOwnerRole: "agent" | "closer",
  nowWall: string,
  ex: DBX = getDb(),
): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await ex
    .update(followUps)
    // ownership CHANGES; ownerRole follows the destination so a closer→agent
    // transfer leaves a coherent row. `leads.*` is never touched here.
    .set({ ownerUserId: toUserId, ownerRole: toOwnerRole, updatedAt: nowWall })
    .where(
      and(
        inArray(followUps.id, ids),
        eq(followUps.ownerUserId, fromUserId),
        eq(followUps.ownerRole, fromOwnerRole),
        inArray(followUps.status, [...ASSIGNABLE_FOLLOWUP_STATUSES]),
      ),
    );
  return rowsAffected(res);
}

/** Concrete follow-up ids for a scope (SELECTED is resolved by the caller). */
export async function followupIdsInScope(
  ownerUserId: number,
  ownerRole: "agent" | "closer",
  scope: Exclude<TransferScope, "SELECTED">,
  nowWall: string,
  todayEndWall: string,
  ex: DBX = getDb(),
): Promise<number[]> {
  const conds: SQL[] = [
    eq(followUps.ownerUserId, ownerUserId),
    eq(followUps.ownerRole, ownerRole),
    eq(followUps.status, "SCHEDULED"),
  ];
  if (scope === "OVERDUE") conds.push(lt(followUps.scheduledAt, nowWall));
  else if (scope === "DUE_TODAY") {
    conds.push(gte(followUps.scheduledAt, nowWall));
    conds.push(lt(followUps.scheduledAt, todayEndWall));
  } else if (scope === "UPCOMING") conds.push(gte(followUps.scheduledAt, todayEndWall));
  // ALL_PENDING → no extra time condition
  const rows = await ex
    .select({ id: followUps.id })
    .from(followUps)
    .where(and(...conds))
    .orderBy(asc(followUps.scheduledAt))
    .limit(5000);
  return rows.map((r) => r.id);
}

export async function insertFollowupReassignments(
  rows: NewFollowUpReassignment[],
  ex: DBX = getDb(),
): Promise<void> {
  if (rows.length === 0) return;
  await ex.insert(followUpReassignments).values(rows);
}

export interface FollowupReassignmentRow {
  id: number;
  fromOwnerName: string | null;
  fromOwnerRole: string | null;
  toOwnerName: string | null;
  toOwnerRole: string | null;
  reassignedByName: string | null;
  reason: string | null;
  createdAt: string;
}

/** The reassignment trail for one follow-up (oldest → newest), with names. */
export async function listFollowupReassignments(
  followUpId: number,
  ex: DBX = getDb(),
): Promise<FollowupReassignmentRow[]> {
  const rows = await ex
    .select({
      id: followUpReassignments.id,
      fromOwnerRole: followUpReassignments.fromOwnerRole,
      toOwnerRole: followUpReassignments.toOwnerRole,
      reason: followUpReassignments.reason,
      createdAt: followUpReassignments.createdAt,
      fromOwnerName: sql<
        string | null
      >`(select full_name from users where id = ${followUpReassignments.fromOwnerUserId})`,
      toOwnerName: sql<
        string | null
      >`(select full_name from users where id = ${followUpReassignments.toOwnerUserId})`,
      reassignedByName: sql<
        string | null
      >`(select full_name from users where id = ${followUpReassignments.reassignedByUserId})`,
    })
    .from(followUpReassignments)
    .where(eq(followUpReassignments.followUpId, followUpId))
    .orderBy(asc(followUpReassignments.id));
  return rows.map((r) => ({
    id: r.id,
    fromOwnerName: r.fromOwnerName ?? null,
    fromOwnerRole: r.fromOwnerRole ?? null,
    toOwnerName: r.toOwnerName ?? null,
    toOwnerRole: r.toOwnerRole ?? null,
    reassignedByName: r.reassignedByName ?? null,
    reason: r.reason ?? null,
    createdAt: r.createdAt,
  }));
}

export interface LongDatedRow {
  id: number;
  code: string;
  customerName: string;
  scheduledAt: string;
  ownerUserId: number;
  ownerRole: "agent" | "closer";
  ownerName: string;
  ownerCode: string;
  process: string;
}

/**
 * SCHEDULED follow-ups whose `scheduledAt` sits in the long-dated window
 * (≈ 2–3 months ahead). Read-only Admin visibility — nothing is moved.
 */
export async function longDatedFollowups(
  minWall: string,
  maxWall: string,
  process: string | undefined,
  ex: DBX = getDb(),
): Promise<LongDatedRow[]> {
  const conds: SQL[] = [
    eq(followUps.status, "SCHEDULED"),
    gte(followUps.scheduledAt, minWall),
    lt(followUps.scheduledAt, maxWall),
  ];
  if (process) conds.push(eq(users.process, process as never));
  const rows = await ex
    .select({
      id: followUps.id,
      code: followUps.followUpCode,
      customerName: followUps.customerName,
      scheduledAt: followUps.scheduledAt,
      ownerUserId: followUps.ownerUserId,
      ownerRole: followUps.ownerRole,
      ownerName: users.fullName,
      process: users.process,
      agentCode: agents.agentCode,
      closerCode: closers.closerCode,
    })
    .from(followUps)
    .innerJoin(users, eq(users.id, followUps.ownerUserId))
    .leftJoin(agents, eq(agents.userId, users.id))
    .leftJoin(closers, eq(closers.userId, users.id))
    .where(and(...conds))
    .orderBy(asc(followUps.scheduledAt))
    .limit(2000);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    customerName: r.customerName,
    scheduledAt: r.scheduledAt,
    ownerUserId: r.ownerUserId,
    ownerRole: r.ownerRole,
    ownerName: r.ownerName,
    ownerCode: (r.ownerRole === "agent" ? r.agentCode : r.closerCode) ?? "",
    process: r.process,
  }));
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
