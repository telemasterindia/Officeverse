/**
 * Officeverse — HR Leave / Off / Sandwich service (Phase 11).
 *
 * Turns the Phase-10 raw attendance facts + employee leave requests into the
 * company's Leave / Off rules. Leave is CALENDAR-date based; attendance stays
 * operational-shift-date based — the two are never mixed here.
 *
 * All derived output (leave_days, off_records) is idempotent: recomputing from
 * the same inputs yields the same rows, so nothing is ever double-counted.
 *
 * Regularity bonus, salary slip, closer incentive and holiday-calendar
 * POPULATION are DEFERRED. Off is a SEPARATE concept from leave — an approved
 * leave is never replaced by an Off.
 */
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import {
  assertCanDecideLeave,
  assertCanManageLeave,
  canCancelLeave,
  canManageLeave,
  canRecalculateHr,
  type HrRole,
} from "../authz/hr";
import { holidayAwareProvider } from "./non-working";
import { planLeaveDays } from "./sandwich";
import { planOffRecords } from "./off-conversion";
import * as repo from "../db/repos/hr";
import { addDaysYMD, nowIST } from "../time";
import type { LeaveRequest, NewLeaveDay, NewLeaveRequest, OffRecord, User } from "@/lib/db/schema";

type Meta = { ip?: string | null; userAgent?: string | null };

/* --------------------------- month helpers -------------------------- */

function monthBounds(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  // last day = day before the 1st of next month
  const [y, m] = month.split("-").map(Number);
  const nextFirst = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
  return { from, to: addDaysYMD(nextFirst, -1) };
}

/* --------------------------- recompute core ------------------------ */

/** Rebuild leave_days for a user from ALL their APPROVED leave requests. */
export async function recomputeLeaveDays(userId: number, process: string): Promise<void> {
  const db = getDb();
  const approved = await repo.listApprovedLeaveForUser(userId, db);
  const now = nowIST();

  if (approved.length === 0) {
    await repo.deleteLeaveDaysForOtherRequests(userId, [], db);
    return;
  }

  const dates = approved.flatMap((a) => [a.startDate, a.endDate]).sort();
  const holMap = await repo.holidayMapInRange(
    addDaysYMD(dates[0]!, -21),
    addDaysYMD(dates[dates.length - 1]!, 21),
    process,
    db,
  );
  const provider = holidayAwareProvider(holMap);

  const plan = planLeaveDays(
    approved.map((a) => ({ id: a.id, startDate: a.startDate, endDate: a.endDate })),
    provider,
  );

  await repo.deleteLeaveDaysForOtherRequests(userId, [...plan.byRequest.keys()], db);
  for (const [reqId, days] of plan.byRequest) {
    const rows: NewLeaveDay[] = days.map((d) => ({
      leaveRequestId: reqId,
      userId,
      leaveDate: d.leaveDate,
      dayType: d.dayType,
      nonWorkingReason: d.nonWorkingReason,
      calculatedAt: now,
      ruleVersion: "v1",
      createdAt: now,
    }));
    await repo.replaceLeaveDaysForRequest(reqId, rows, db);
  }
}

/** Recompute Late→Off / Short→Off records for a user + month. Idempotent. */
export async function recomputeOff(userId: number, month: string): Promise<void> {
  const db = getDb();
  const { from, to } = monthBounds(month);
  const [lateCount, shortCount] = await Promise.all([
    repo.countAttendanceStatus(userId, from, to, "LATE", db),
    repo.countAttendanceStatus(userId, from, to, "SHORT_ATTENDANCE", db),
  ]);
  const plan = planOffRecords({ periodMonth: month, lateCount, shortCount });
  await repo.upsertOffRecords(
    userId,
    month,
    plan.records.map((r) => ({
      offType: r.offType,
      offIndex: r.offIndex,
      sourceCount: r.sourceCount,
      sourceDescription: r.sourceDescription,
    })),
    nowIST(),
    db,
  );
}

/* ------------------------------ requests -------------------------- */

export interface RequestLeaveInput {
  leaveType?: string | undefined;
  startDate: string;
  endDate: string;
  reason?: string | undefined;
}

export async function requestLeave(
  user: Pick<User, "id">,
  input: RequestLeaveInput,
  meta: Meta = {},
): Promise<{ id: number }> {
  if (input.endDate < input.startDate) {
    throw new HttpError(400, "End date is before the start date", "bad_range");
  }
  const now = nowIST();
  const v: NewLeaveRequest = {
    userId: user.id, // self only — never a client-supplied owner
    leaveType: (input.leaveType?.trim() || "general").slice(0, 40),
    startDate: input.startDate,
    endDate: input.endDate,
    status: "PENDING",
    reason: input.reason?.trim().slice(0, 500) ?? null,
    createdByUserId: user.id,
    createdAt: now,
    updatedAt: now,
  };
  const id = await repo.insertLeave(v);
  await recordAudit({
    actorUserId: user.id,
    actorRole: "agent",
    action: "leave.request",
    entityType: "leave_request",
    entityId: id,
    metadata: { start: input.startDate, end: input.endDate, type: v.leaveType },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { id };
}

export type LeaveDecision = "APPROVED" | "REJECTED" | "CANCELLED";

export async function decideLeave(
  actor: Pick<User, "id" | "role" | "process">,
  id: number,
  decision: LeaveDecision,
  note: string | undefined,
  meta: Meta = {},
): Promise<{ ok: true }> {
  const leave = await repo.getLeaveById(id);
  if (!leave) throw new HttpError(404, "Leave request not found", "not_found");

  if (decision === "CANCELLED") {
    if (!canCancelLeave(actor.role as HrRole, actor.id, leave.userId)) {
      throw new HttpError(403, "Not allowed to cancel this leave", "forbidden");
    }
  } else {
    assertCanDecideLeave(actor.role as HrRole, actor.id, leave.userId);
  }

  const now = nowIST();
  await repo.updateLeave(id, {
    status: decision,
    decisionNote: note?.trim().slice(0, 500) ?? null,
    ...(decision === "APPROVED"
      ? { approvedByUserId: actor.id, approvedAt: now }
      : { approvedByUserId: null, approvedAt: null }),
    updatedAt: now,
  });

  // rebuild the derived leave_days for that employee (approval added/removed)
  const ownerProcess = await ownerProcessOf(leave.userId, actor);
  await recomputeLeaveDays(leave.userId, ownerProcess);

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "leave.decision",
    entityType: "leave_request",
    entityId: id,
    metadata: { decision, owner: leave.userId, ...(note ? { note: note.slice(0, 200) } : {}) },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

export async function recalcHr(
  actor: Pick<User, "id" | "role">,
  targetUserId: number,
  targetProcess: string,
  month: string,
  meta: Meta = {},
): Promise<{ ok: true }> {
  if (!canRecalculateHr(actor.role as HrRole)) {
    throw new HttpError(403, "Only Admin / HR may recalculate HR", "forbidden");
  }
  await recomputeLeaveDays(targetUserId, targetProcess);
  await recomputeOff(targetUserId, month);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "hr.recalculate",
    entityType: "user",
    entityId: targetUserId,
    metadata: { month },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

/* -------------------------------- reads --------------------------- */

export interface LeaveDTO {
  id: number;
  employeeName?: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  status: string;
  reason: string | null;
  decisionNote: string | null;
  approvedAt: string | null;
  createdAt: string;
}
function leaveDTO(l: LeaveRequest, employeeName?: string): LeaveDTO {
  return {
    id: l.id,
    ...(employeeName ? { employeeName } : {}),
    leaveType: l.leaveType,
    startDate: l.startDate,
    endDate: l.endDate,
    status: l.status,
    reason: l.reason ?? null,
    decisionNote: l.decisionNote ?? null,
    approvedAt: l.approvedAt ?? null,
    createdAt: l.createdAt,
  };
}

export interface LeaveDayDTO {
  leaveRequestId: number;
  leaveDate: string;
  dayType: string;
  nonWorkingReason: string | null;
}
export interface OffDTO {
  id: number;
  employeeName?: string;
  offType: string;
  periodMonth: string;
  offIndex: number;
  sourceCount: number;
  sourceDescription: string;
  status: string;
}
function offDTO(o: OffRecord, employeeName?: string): OffDTO {
  return {
    id: o.id,
    ...(employeeName ? { employeeName } : {}),
    offType: o.offType,
    periodMonth: o.periodMonth,
    offIndex: o.offIndex,
    sourceCount: o.sourceCount,
    sourceDescription: o.sourceDescription,
    status: o.status,
  };
}

export interface MonthlyCounters {
  month: string;
  lateCount: number;
  shortCount: number;
  lateOffCount: number;
  shortOffCount: number;
  approvedLeaveDays: number;
  sandwichLeaveDays: number;
  totalLeaveDays: number;
}

export interface MyHrResult {
  dbUnavailable?: boolean;
  leave: LeaveDTO[];
  leaveDays: LeaveDayDTO[];
  off: OffDTO[];
  counters: MonthlyCounters;
}

export async function myHr(user: Pick<User, "id" | "process">, month: string): Promise<MyHrResult> {
  const emptyCounters: MonthlyCounters = {
    month,
    lateCount: 0,
    shortCount: 0,
    lateOffCount: 0,
    shortOffCount: 0,
    approvedLeaveDays: 0,
    sandwichLeaveDays: 0,
    totalLeaveDays: 0,
  };
  if (!isDbConfigured()) {
    return { dbUnavailable: true, leave: [], leaveDays: [], off: [], counters: emptyCounters };
  }
  // fresh, idempotent recompute so the numbers are current
  await recomputeLeaveDays(user.id, user.process);
  await recomputeOff(user.id, month);

  const { from, to } = monthBounds(month);
  const [leave, days, off, lateCount, shortCount] = await Promise.all([
    repo.listLeaveForUser(user.id),
    repo.listLeaveDaysForUser(user.id, from, to),
    repo.listOffForUser(user.id, month, month),
    repo.countAttendanceStatus(user.id, from, to, "LATE"),
    repo.countAttendanceStatus(user.id, from, to, "SHORT_ATTENDANCE"),
  ]);

  const offPlan = planOffRecords({ periodMonth: month, lateCount, shortCount });
  const inMonth = days.filter((d) => d.leaveDate >= from && d.leaveDate <= to);

  return {
    leave: leave.map((l) => leaveDTO(l)),
    leaveDays: inMonth.map((d) => ({
      leaveRequestId: d.leaveRequestId,
      leaveDate: d.leaveDate,
      dayType: d.dayType,
      nonWorkingReason: d.nonWorkingReason ?? null,
    })),
    off: off.filter((o) => o.status === "ACTIVE").map((o) => offDTO(o)),
    counters: {
      month,
      lateCount,
      shortCount,
      lateOffCount: offPlan.lateOffCount,
      shortOffCount: offPlan.shortOffCount,
      approvedLeaveDays: inMonth.filter((d) => d.dayType === "ORIGINAL").length,
      sandwichLeaveDays: inMonth.filter((d) => d.dayType !== "ORIGINAL").length,
      totalLeaveDays: new Set(inMonth.map((d) => d.leaveDate)).size,
    },
  };
}

/* ---------------------------- admin reads ----------------------- */

export async function listAllLeave(
  actor: Pick<User, "role">,
  f: repo.LeaveFilter,
): Promise<{ dbUnavailable?: boolean; rows: LeaveDTO[] }> {
  assertCanManageLeave(actor.role as HrRole);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listLeaveByFilters(f);
  return { rows: rows.map((r) => leaveDTO(r, r.employeeName)) };
}

export async function listAllOff(
  actor: Pick<User, "role">,
  f: repo.OffFilter,
): Promise<{ dbUnavailable?: boolean; rows: OffDTO[] }> {
  assertCanManageLeave(actor.role as HrRole);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listOffByFilters(f);
  return { rows: rows.map((r) => offDTO(r, r.employeeName)) };
}

async function ownerProcessOf(
  userId: number,
  actor: Pick<User, "id" | "process">,
): Promise<string> {
  if (userId === actor.id) return actor.process;
  const rows = await getDb()
    .select({ process: users.process })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.process ?? "US";
}
