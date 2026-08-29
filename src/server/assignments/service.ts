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
import { auditLogs, leads, users, type User } from "@/lib/db/schema";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { nowIST } from "../time";
import {
  ASSIGNABLE_CLOSER_LEAD_STATUSES,
  ASSIGNABLE_FOLLOWUP_STATUSES,
  assertCanReassignAssignments,
  isAssignmentWorkType,
  WORKTYPE_ROLE,
  WORKTYPE_SUBJECT,
  type AssignmentWorkType,
} from "../authz/assignments";
import { planBulkReassign, summarizeResult, SELECT_ALL, type Selection } from "./plan";
import * as repo from "../db/repos/assignments";

type Meta = { ip?: string | null; userAgent?: string | null };

/* ============================== roster ============================= */

export interface RosterPerson {
  userId: number;
  staffId: number;
  name: string;
  code: string;
  status: string;
  photoAvailable: boolean;
  /** active follow-ups owned (this role) */
  followUps: number;
  /** active leads owned (closers only) */
  leads: number;
}

export interface AssignmentRoster {
  dbUnavailable?: boolean;
  agents: RosterPerson[];
  closers: RosterPerson[];
}

export async function assignmentRoster(actor: Pick<User, "role">): Promise<AssignmentRoster> {
  assertCanReassignAssignments(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, agents: [], closers: [] };
  const db = getDb();
  const [agentRoster, closerRoster, agentFuCounts, closerFuCounts, leadCounts] = await Promise.all([
    repo.listAgentRoster(db),
    repo.listCloserRoster(db),
    repo.followupCountsByOwner("agent", db),
    repo.followupCountsByOwner("closer", db),
    repo.leadCountsByCloser(db),
  ]);
  return {
    agents: agentRoster.map((r) => ({
      ...r,
      followUps: agentFuCounts.get(r.userId) ?? 0,
      leads: 0,
    })),
    closers: closerRoster.map((r) => ({
      ...r,
      followUps: closerFuCounts.get(r.userId) ?? 0,
      leads: leadCounts.get(r.staffId) ?? 0,
    })),
  };
}

/* ============================= workload =========================== */

export interface WorkloadRow {
  id: number;
  code: string;
  customerName: string;
  status: string;
  /** secondary line — what stays put (the other ownership dimension) */
  context: string;
}

export interface WorkloadResult {
  dbUnavailable?: boolean;
  workType: AssignmentWorkType;
  ownerId: number;
  eligibleStatuses: string[];
  count: number;
  rows: WorkloadRow[];
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
      })),
    };
  }

  const ownerRole = WORKTYPE_ROLE[workType]; // "agent" | "closer"
  const rows = await repo.followupWorkload(input.ownerId, ownerRole, input.search, db);
  return {
    workType,
    ownerId: input.ownerId,
    eligibleStatuses: [...ASSIGNABLE_FOLLOWUP_STATUSES],
    count: rows.length,
    rows: rows.map((r) => ({
      id: r.id,
      code: r.code,
      customerName: r.customerName,
      status: r.status,
      context:
        r.leadCode != null
          ? `Lead ${r.leadCode}${r.closerName ? ` · Closer: ${r.closerName} (unchanged)` : ""}`
          : "Standalone follow-up",
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
  const selection: Selection = input.selection === "ALL" ? SELECT_ALL : input.selection;
  if (selection !== SELECT_ALL && (!Array.isArray(selection) || selection.length === 0)) {
    throw new HttpError(400, "Select at least one record", "empty_selection");
  }
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const now = nowIST();
  const reason = (input.reason ?? "").trim().slice(0, 500) || null;

  // The destination MUST match the operation's role — a client can never move
  // an agent's follow-ups to a closer (or vice-versa), or to a non-staff user.
  if (workType === "CLOSER_LEADS") {
    if (!(await repo.closerExists(input.toOwnerId, db))) {
      throw new HttpError(400, "Destination is not a closer", "bad_destination");
    }
  } else {
    const wantRole = WORKTYPE_ROLE[workType]; // "agent" | "closer"
    if ((await repo.roleOfUser(input.toOwnerId, db)) !== wantRole) {
      throw new HttpError(
        400,
        `Destination is not ${wantRole === "agent" ? "an agent" : "a closer"}`,
        "bad_destination",
      );
    }
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

  /* ---- AGENT_FOLLOWUPS / CLOSER_FOLLOWUPS ---- */
  const ownerRole = WORKTYPE_ROLE[workType];
  const eligibleRows = await repo.followupWorkload(input.fromOwnerId, ownerRole, undefined, db);
  const plan = planBulkReassign({
    eligible: eligibleRows.map((r) => ({ id: r.id, currentOwnerId: r.ownerUserId })),
    requested: selection,
    fromOwnerId: input.fromOwnerId,
    toOwnerId: input.toOwnerId,
  });
  if (plan.toApply.length === 0) {
    return { ok: true, ...base, ...summarizeResult(plan, 0) };
  }
  let applied = 0;
  let txFailed = false;
  try {
    await db.transaction(async (tx) => {
      applied = await repo.reassignFollowupOwner(
        plan.toApply,
        input.fromOwnerId,
        input.toOwnerId,
        ownerRole,
        now,
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
    action:
      workType === "AGENT_FOLLOWUPS"
        ? "assignment.agent_followup_reassign"
        : "assignment.closer_followup_reassign",
    entityType: "follow_up",
    metadata: {
      owner_role: ownerRole,
      from_user_id: input.fromOwnerId,
      to_user_id: input.toOwnerId,
      ...summary,
      follow_up_ids: plan.toApply.slice(0, 500),
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
