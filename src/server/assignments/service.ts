/**
 * Officeverse — Assignment Control service (Phase 22).
 *
 * Admin-only bulk reassignment for the employee-exit / workload-redistribution
 * use case. THREE independent operations that never bleed into each other:
 *
 *   AGENT_FOLLOWUPS   agent  → agent   (follow_ups.owner_user_id only)
 *   CLOSER_LEADS      closer → closer  (leads.assigned_closer_id only)
 *   CLOSER_FOLLOWUPS  closer → closer  (follow_ups.owner_user_id only)
 *
 * INVARIANT (enforced by the scoped UPDATEs in repos/assignments.ts):
 *   - reassigning a follow-up writes ONLY follow_ups — never leads
 *   - reassigning a lead writes ONLY leads (+ lead_assignments history) — never
 *     any follow_ups row
 *
 * No payroll / gamification / Office-TV / HR imports. Uses existing tables only
 * (follow_ups, leads, lead_assignments, audit_logs) — no migration.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { auditLogs, followUps, leads, users, type User } from "@/lib/db/schema";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { addDaysYMD, calendarTodayIST, istWallClockToEpochMs, nowIST, wallToIstIso } from "../time";
import {
  ASSIGNABLE_CLOSER_LEAD_STATUSES,
  ASSIGNABLE_FOLLOWUP_STATUSES,
  assertCanReassignAssignments,
  isAssignmentWorkType,
  isTransferScope,
  LONG_DATED_MAX_DAYS,
  LONG_DATED_MIN_DAYS,
  WORKTYPE_ROLE,
  WORKTYPE_SOURCE_ROLE,
  WORKTYPE_SUBJECT,
  type AssignmentWorkType,
  type TransferScope,
} from "../authz/assignments";
import { planBulkReassign, summarizeResult, SELECT_ALL, type Selection } from "./plan";
import * as repo from "../db/repos/assignments";
import { EMPTY_BREAKDOWN, type FollowupBreakdown } from "../db/repos/assignments";

type Meta = { ip?: string | null; userAgent?: string | null };

/** Start-of-tomorrow (IST wall clock) — the "due today" / "upcoming" boundary. */
function startOfTomorrowWall(): string {
  return `${addDaysYMD(calendarTodayIST(), 1)} 00:00:00`;
}

/* ============================== roster ============================= */

export interface RosterPerson {
  userId: number;
  staffId: number;
  name: string;
  code: string;
  status: string;
  photoAvailable: boolean;
  /** active (SCHEDULED) follow-ups owned by this person, in this role */
  followUps: number;
  /** leads: closers → active in-flight leads; agents → total originated leads */
  leads: number;
  /** the six-way follow-up workload the Admin sees on the destination card */
  pendingFollowUps: number;
  overdue: number;
  dueToday: number;
  upcoming: number;
  completedFollowUps: number;
}

export interface AssignmentRoster {
  dbUnavailable?: boolean;
  agents: RosterPerson[];
  closers: RosterPerson[];
}

export async function assignmentRoster(
  actor: Pick<User, "role">,
  input: { process?: string | undefined } = {},
): Promise<AssignmentRoster> {
  assertCanReassignAssignments(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, agents: [], closers: [] };
  const db = getDb();
  const now = nowIST();
  const todayEnd = startOfTomorrowWall();
  // Admin UAT §4 — when a process is selected, the roster is scoped to that
  // process SERVER-SIDE; US and India employees are never mixed.
  const p = input.process;
  const [agentRoster, closerRoster, agentBreak, closerBreak, closerLeadCounts, agentLeadCounts] =
    await Promise.all([
      repo.listAgentRoster(p, db),
      repo.listCloserRoster(p, db),
      repo.followupBreakdownByOwner("agent", now, todayEnd, db),
      repo.followupBreakdownByOwner("closer", now, todayEnd, db),
      repo.leadCountsByCloser(db),
      repo.leadCountsByAgent(db),
    ]);

  const withBreakdown = (
    r: repo.RosterEntry,
    b: FollowupBreakdown,
    leadCount: number,
  ): RosterPerson => ({
    ...r,
    followUps: b.pending,
    leads: leadCount,
    pendingFollowUps: b.pending,
    overdue: b.overdue,
    dueToday: b.dueToday,
    upcoming: b.upcoming,
    completedFollowUps: b.completed,
  });

  return {
    agents: agentRoster.map((r) =>
      withBreakdown(
        r,
        agentBreak.get(r.userId) ?? EMPTY_BREAKDOWN,
        agentLeadCounts.get(r.staffId) ?? 0,
      ),
    ),
    closers: closerRoster.map((r) =>
      withBreakdown(
        r,
        closerBreak.get(r.userId) ?? EMPTY_BREAKDOWN,
        closerLeadCounts.get(r.staffId) ?? 0,
      ),
    ),
  };
}

/* ============================= workload =========================== */

/** Time bucket for a follow-up row (leads have no bucket → null). */
export type WorkloadBucket = "OVERDUE" | "DUE_TODAY" | "UPCOMING" | null;

export interface WorkloadRow {
  id: number;
  code: string;
  customerName: string;
  status: string;
  /** secondary line — what stays put (the other ownership dimension) */
  context: string;
  /** OVERDUE vs DUE TODAY vs UPCOMING — for the visual distinction (§2) */
  bucket: WorkloadBucket;
  scheduledAt: string | null;
  /** true when this follow-up is ~2–3 months out (§6) */
  longDated: boolean;
}

export interface WorkloadResult {
  dbUnavailable?: boolean;
  workType: AssignmentWorkType;
  ownerId: number;
  eligibleStatuses: string[];
  count: number;
  rows: WorkloadRow[];
  /** counts by scope so the Admin can pick "transfer all overdue" etc. (§2/§3) */
  buckets: { overdue: number; dueToday: number; upcoming: number };
  longDatedCount: number;
}

function bucketOfScheduled(
  scheduledWall: string,
  nowWall: string,
  todayEndWall: string,
): WorkloadBucket {
  if (scheduledWall < nowWall) return "OVERDUE";
  if (scheduledWall < todayEndWall) return "DUE_TODAY";
  return "UPCOMING";
}

function assertWorkType(x: string): asserts x is AssignmentWorkType {
  if (!isAssignmentWorkType(x)) throw new HttpError(400, "Unknown work type", "bad_work_type");
}

export async function assignmentWorkload(
  actor: Pick<User, "role">,
  input: { workType: string; ownerId: number; search?: string },
): Promise<WorkloadResult> {
  assertCanReassignAssignments(actor.role);
  assertWorkType(input.workType);
  const workType = input.workType;
  if (!Number.isInteger(input.ownerId) || input.ownerId <= 0) {
    throw new HttpError(400, "A current owner is required", "owner_required");
  }
  const noBuckets = { overdue: 0, dueToday: 0, upcoming: 0 };
  if (!isDbConfigured()) {
    return {
      dbUnavailable: true,
      workType,
      ownerId: input.ownerId,
      eligibleStatuses:
        WORKTYPE_SUBJECT[workType] === "lead"
          ? [...ASSIGNABLE_CLOSER_LEAD_STATUSES]
          : [...ASSIGNABLE_FOLLOWUP_STATUSES],
      count: 0,
      rows: [],
      buckets: noBuckets,
      longDatedCount: 0,
    };
  }
  const db = getDb();

  if (workType === "CLOSER_LEADS") {
    const rows = await repo.closerLeadWorkload(input.ownerId, input.search, db);
    return {
      workType,
      ownerId: input.ownerId,
      eligibleStatuses: [...ASSIGNABLE_CLOSER_LEAD_STATUSES],
      count: rows.length,
      rows: rows.map((r) => ({
        id: r.id,
        code: r.leadCode,
        customerName: r.customerName,
        status: r.status,
        context: r.agentName ? `Agent: ${r.agentName} (unchanged)` : "No originating agent",
        bucket: null,
        scheduledAt: null,
        longDated: false,
      })),
      buckets: noBuckets,
      longDatedCount: 0,
    };
  }

  // follow-up worktypes — the SOURCE owner's role drives the workload query
  const sourceRole = WORKTYPE_SOURCE_ROLE[workType]; // "agent" | "closer"
  const now = nowIST();
  const todayEnd = startOfTomorrowWall();
  const longDatedFromWall = `${addDaysYMD(calendarTodayIST(), LONG_DATED_MIN_DAYS)} 00:00:00`;
  const rows = await repo.followupWorkload(input.ownerId, sourceRole, input.search, db);
  const buckets = { overdue: 0, dueToday: 0, upcoming: 0 };
  let longDatedCount = 0;
  const mapped = rows.map((r) => {
    const bucket = bucketOfScheduled(r.scheduledAt, now, todayEnd);
    if (bucket === "OVERDUE") buckets.overdue += 1;
    else if (bucket === "DUE_TODAY") buckets.dueToday += 1;
    else buckets.upcoming += 1;
    const longDated = r.scheduledAt >= longDatedFromWall;
    if (longDated) longDatedCount += 1;
    return {
      id: r.id,
      code: r.code,
      customerName: r.customerName,
      status: r.status,
      context:
        r.leadCode != null
          ? `Lead ${r.leadCode}${r.closerName ? ` · Closer: ${r.closerName} (unchanged)` : ""}`
          : "Standalone follow-up",
      bucket,
      scheduledAt: wallToIstIso(r.scheduledAt),
      longDated,
    };
  });
  return {
    workType,
    ownerId: input.ownerId,
    eligibleStatuses: [...ASSIGNABLE_FOLLOWUP_STATUSES],
    count: mapped.length,
    rows: mapped,
    buckets,
    longDatedCount,
  };
}

/* ========================== long-dated view ====================== */

export interface LongDatedFollowUp {
  id: number;
  code: string;
  customerName: string;
  scheduledAt: string;
  ownerName: string;
  ownerCode: string;
  ownerRole: "agent" | "closer";
  process: string;
  monthsAhead: number;
}

export interface LongDatedResult {
  dbUnavailable?: boolean;
  windowDays: { from: number; to: number };
  count: number;
  rows: LongDatedFollowUp[];
}

/**
 * §6 — Admin-only read of SCHEDULED follow-ups ~2–3 months out so the Admin can
 * decide keep-or-transfer. NOTHING is reassigned here.
 */
export async function longDatedFollowUps(
  actor: Pick<User, "role">,
  input: { process?: string | undefined } = {},
): Promise<LongDatedResult> {
  assertCanReassignAssignments(actor.role);
  const windowDays = { from: LONG_DATED_MIN_DAYS, to: LONG_DATED_MAX_DAYS };
  if (!isDbConfigured()) return { dbUnavailable: true, windowDays, count: 0, rows: [] };
  const today = calendarTodayIST();
  const minWall = `${addDaysYMD(today, LONG_DATED_MIN_DAYS)} 00:00:00`;
  const maxWall = `${addDaysYMD(today, LONG_DATED_MAX_DAYS)} 00:00:00`;
  const nowMs = istWallClockToEpochMs(nowIST());
  const rows = await repo.longDatedFollowups(minWall, maxWall, input.process, getDb());
  return {
    windowDays,
    count: rows.length,
    rows: rows.map((r) => ({
      id: r.id,
      code: r.code,
      customerName: r.customerName,
      scheduledAt: wallToIstIso(r.scheduledAt),
      ownerName: r.ownerName,
      ownerCode: r.ownerCode,
      ownerRole: r.ownerRole,
      process: r.process,
      monthsAhead:
        Math.round(((istWallClockToEpochMs(r.scheduledAt) - nowMs) / (30 * 86_400_000)) * 10) / 10,
    })),
  };
}

/* ============================ reassign ========================== */

export interface ReassignInput {
  workType: string;
  /** current owner id — user id for *_FOLLOWUPS, closers.id for CLOSER_LEADS */
  fromOwnerId: number;
  toOwnerId: number;
  /** explicit record ids, or "ALL" (server recomputes the eligible set) */
  selection: number[] | "ALL";
  /**
   * §2/§3 — for follow-up worktypes the Admin may pick a scope instead of
   * individual rows. When set (and not "SELECTED") the SERVER resolves the
   * concrete follow-up ids from the time bucket; `selection` is ignored.
   * Ignored for CLOSER_LEADS.
   */
  scope?: string;
  reason?: string;
}

export interface ReassignOutcome {
  ok: boolean;
  workType: AssignmentWorkType;
  fromOwnerId: number;
  toOwnerId: number;
  requested: number;
  reassigned: number;
  skipped: number;
  failed: number;
}

export async function reassignBulk(
  actor: Pick<User, "id" | "role">,
  input: ReassignInput,
  meta: Meta = {},
): Promise<ReassignOutcome> {
  assertCanReassignAssignments(actor.role);
  assertWorkType(input.workType);
  const workType = input.workType;

  if (
    !Number.isInteger(input.fromOwnerId) ||
    !Number.isInteger(input.toOwnerId) ||
    input.fromOwnerId <= 0 ||
    input.toOwnerId <= 0
  ) {
    throw new HttpError(400, "A valid source and destination owner are required", "owner_required");
  }
  if (input.fromOwnerId === input.toOwnerId) {
    throw new HttpError(400, "Source and destination owner must differ", "same_owner");
  }
  // §2/§3 — a scope is only meaningful for follow-up worktypes.
  const scope: TransferScope =
    input.scope && isTransferScope(input.scope) ? input.scope : "SELECTED";
  const usingScope = scope !== "SELECTED" && workType !== "CLOSER_LEADS";

  const selection: Selection = input.selection === "ALL" ? SELECT_ALL : input.selection;
  if (
    !usingScope &&
    selection !== SELECT_ALL &&
    (!Array.isArray(selection) || selection.length === 0)
  ) {
    throw new HttpError(400, "Select at least one record", "empty_selection");
  }
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const now = nowIST();
  const todayEnd = startOfTomorrowWall();
  const reason = (input.reason ?? "").trim().slice(0, 500) || null;

  // The destination MUST match the operation's role — a client can never move
  // an agent's follow-ups to a closer (or vice-versa), or to a non-staff user.
  if (workType === "CLOSER_LEADS") {
    if (!(await repo.closerExists(input.toOwnerId, db))) {
      throw new HttpError(400, "Destination is not a closer", "bad_destination");
    }
  } else {
    const wantRole = WORKTYPE_ROLE[workType]; // destination role: "agent" | "closer"
    if ((await repo.roleOfUser(input.toOwnerId, db)) !== wantRole) {
      throw new HttpError(
        400,
        `Destination is not ${wantRole === "agent" ? "an agent" : "a closer"}`,
        "bad_destination",
      );
    }
    // and the SOURCE must actually be the expected source role
    const srcRole = WORKTYPE_SOURCE_ROLE[workType];
    if ((await repo.roleOfUser(input.fromOwnerId, db)) !== srcRole) {
      throw new HttpError(
        400,
        `Source is not ${srcRole === "agent" ? "an agent" : "a closer"}`,
        "bad_source",
      );
    }
  }

  // §1/§6/§9 — the DESTINATION employee must be currently ACTIVE. Inactive /
  // deactivated / terminated employees are never valid reassignment targets;
  // this rejects a direct API call (or a stale reassignment page) that sends an
  // inactive user id even though the roster picker already hides them. This is
  // a status check ONLY — it never limits how many times a follow-up may be
  // reassigned and never inspects prior reassignment history.
  const destStatus =
    workType === "CLOSER_LEADS"
      ? await repo.statusOfCloser(input.toOwnerId, db)
      : await repo.statusOfUser(input.toOwnerId, db);
  if (destStatus !== "active") {
    throw new HttpError(
      422,
      "Destination employee is not active — pick a currently active employee",
      "inactive_destination",
    );
  }

  // PROCESS ISOLATION — bulk reassignment never crosses the US ⇄ India line,
  // even for an admin. Cross-process *visibility* is intentional; transferring
  // *ownership* of work across processes is not, and no business rule allows it.
  const [fromProcess, toProcess] =
    workType === "CLOSER_LEADS"
      ? await Promise.all([
          repo.processOfCloser(input.fromOwnerId, db),
          repo.processOfCloser(input.toOwnerId, db),
        ])
      : await Promise.all([
          repo.processOfUser(input.fromOwnerId, db),
          repo.processOfUser(input.toOwnerId, db),
        ]);
  if (!fromProcess || !toProcess || fromProcess !== toProcess) {
    throw new HttpError(
      400,
      "Source and destination must be in the same process (US / India)",
      "cross_process",
    );
  }

  const base: Pick<ReassignOutcome, "workType" | "fromOwnerId" | "toOwnerId"> = {
    workType,
    fromOwnerId: input.fromOwnerId,
    toOwnerId: input.toOwnerId,
  };

  /* ---- CLOSER_LEADS ---- */
  if (workType === "CLOSER_LEADS") {
    const eligibleRows = await repo.closerLeadWorkload(input.fromOwnerId, undefined, db);
    const plan = planBulkReassign({
      eligible: eligibleRows.map((r) => ({ id: r.id, currentOwnerId: r.assignedCloserId })),
      requested: selection,
      fromOwnerId: input.fromOwnerId,
      toOwnerId: input.toOwnerId,
    });
    if (plan.toApply.length === 0) {
      return { ok: true, ...base, ...summarizeResult(plan, 0) };
    }
    let applied = 0;
    let movedIds: number[] = [];
    let txFailed = false;
    try {
      await db.transaction(async (tx) => {
        applied = await repo.reassignLeadCloser(
          plan.toApply,
          input.fromOwnerId,
          input.toOwnerId,
          now,
          tx,
        );
        const check = await tx
          .select({ id: leads.id })
          .from(leads)
          .where(and(inArray(leads.id, plan.toApply), eq(leads.assignedCloserId, input.toOwnerId)));
        movedIds = check.map((c) => c.id);
        await repo.insertLeadAssignmentHistory(
          movedIds.map((leadId) => ({
            leadId,
            fromCloserId: input.fromOwnerId,
            toCloserId: input.toOwnerId,
            action: "reassign" as const,
            byUserId: actor.id,
            note: reason,
            createdAt: now,
          })),
          tx,
        );
      });
    } catch {
      txFailed = true;
    }
    const summary = summarizeResult(plan, txFailed ? 0 : applied, { transactionFailed: txFailed });
    await recordAudit({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: "assignment.closer_lead_reassign",
      entityType: "lead",
      metadata: {
        from_closer_id: input.fromOwnerId,
        to_closer_id: input.toOwnerId,
        ...summary,
        moved_lead_ids: movedIds.slice(0, 500),
        reason,
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return { ok: !txFailed && summary.failed === 0, ...base, ...summary };
  }

  /* ---- AGENT_FOLLOWUPS / CLOSER_FOLLOWUPS / CLOSER_FOLLOWUPS_TO_AGENT ---- *
   * Writes follow_ups ONLY. Never touches leads.assignedCloserId — the lead's
   * primary owner is unchanged (§11).                                          */
  const sourceRole = WORKTYPE_SOURCE_ROLE[workType]; // whose follow-ups
  const destRole = WORKTYPE_ROLE[workType]; // new owner's role
  const eligibleRows = await repo.followupWorkload(input.fromOwnerId, sourceRole, undefined, db);

  // Resolve the request: a server-computed scope, or the explicit selection.
  const requested: Selection = usingScope
    ? await repo.followupIdsInScope(
        input.fromOwnerId,
        sourceRole,
        scope as Exclude<TransferScope, "SELECTED">,
        now,
        todayEnd,
        db,
      )
    : selection;

  const plan = planBulkReassign({
    eligible: eligibleRows.map((r) => ({ id: r.id, currentOwnerId: r.ownerUserId })),
    requested,
    fromOwnerId: input.fromOwnerId,
    toOwnerId: input.toOwnerId,
  });
  if (plan.toApply.length === 0) {
    return { ok: true, ...base, ...summarizeResult(plan, 0) };
  }
  let applied = 0;
  let movedIds: number[] = [];
  let txFailed = false;
  try {
    await db.transaction(async (tx) => {
      applied = await repo.reassignFollowupOwner(
        plan.toApply,
        input.fromOwnerId,
        input.toOwnerId,
        sourceRole,
        destRole,
        now,
        tx,
      );
      // which ones actually moved (owner now = destination)
      const moved = await tx
        .select({ id: followUps.id, code: followUps.followUpCode })
        .from(followUps)
        .where(
          and(inArray(followUps.id, plan.toApply), eq(followUps.ownerUserId, input.toOwnerId)),
        );
      movedIds = moved.map((m) => m.id);
      // §5/§11 — record the trail on each moved follow-up. Immutable; never
      // deletes prior history.
      await repo.insertFollowupReassignments(
        moved.map((m) => ({
          followUpId: m.id,
          followUpCode: m.code,
          fromOwnerUserId: input.fromOwnerId,
          fromOwnerRole: sourceRole,
          toOwnerUserId: input.toOwnerId,
          toOwnerRole: destRole,
          reassignedByUserId: actor.id,
          reason,
          createdAt: now,
        })),
        tx,
      );
    });
  } catch {
    txFailed = true;
  }
  const summary = summarizeResult(plan, txFailed ? 0 : applied, { transactionFailed: txFailed });
  const auditAction =
    workType === "AGENT_FOLLOWUPS"
      ? "assignment.agent_followup_reassign"
      : workType === "CLOSER_FOLLOWUPS_TO_AGENT"
        ? "assignment.closer_followup_to_agent_reassign"
        : "assignment.closer_followup_reassign";
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: auditAction,
    entityType: "follow_up",
    metadata: {
      source_role: sourceRole,
      dest_role: destRole,
      from_user_id: input.fromOwnerId,
      to_user_id: input.toOwnerId,
      scope,
      ...summary,
      follow_up_ids: (txFailed ? plan.toApply : movedIds).slice(0, 500),
      reason,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: !txFailed && summary.failed === 0, ...base, ...summary };
}

/* ============================= history =========================== */

export interface AssignmentHistoryRow {
  id: number;
  action: string;
  subject: string;
  actorName: string | null;
  createdAt: string;
  requested: number | null;
  reassigned: number | null;
  reason: string | null;
}

const ASSIGNMENT_ACTIONS = [
  "assignment.agent_followup_reassign",
  "assignment.closer_lead_reassign",
  "assignment.closer_followup_reassign",
  "assignment.closer_followup_to_agent_reassign",
];

export async function assignmentHistory(
  actor: Pick<User, "role">,
  input: { limit?: number } = {},
): Promise<{ dbUnavailable?: boolean; rows: AssignmentHistoryRow[] }> {
  assertCanReassignAssignments(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const db = getDb();
  const limit = Math.min(100, Math.max(1, input.limit ?? 30));
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorName: users.fullName,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(inArray(auditLogs.action, ASSIGNMENT_ACTIONS))
    .orderBy(desc(auditLogs.id))
    .limit(limit);

  return {
    rows: rows.map((r) => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      return {
        id: Number(r.id),
        action: r.action,
        subject: r.entityType ?? "",
        actorName: r.actorName ?? null,
        createdAt: r.createdAt,
        requested: typeof m["requested"] === "number" ? (m["requested"] as number) : null,
        reassigned: typeof m["reassigned"] === "number" ? (m["reassigned"] as number) : null,
        reason: typeof m["reason"] === "string" ? (m["reason"] as string) : null,
      };
    }),
  };
}
