/**
 * Officeverse — HR leave / leave_days / off_records / holidays repository
 * (Phase 11). DATA ACCESS ONLY. Authorization lives in ../../authz/hr.ts.
 *
 * leave_days and off_records are DERIVED, idempotent views:
 *   - leave_days are rebuilt per request (delete-then-insert inside the
 *     recompute); the UNIQUE (leave_request_id, leave_date) is a safety net.
 *   - off_records upsert on (user, off_type, month, off_index); records beyond
 *     the current plan are marked VOID, never deleted.
 */
import { and, asc, desc, eq, gte, inArray, lte, not, sql, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  attendance,
  holidays,
  leaveDays,
  leaveRequests,
  offRecords,
  users,
  type LeaveRequest,
  type NewLeaveDay,
  type NewLeaveRequest,
  type NewOffRecord,
  type OffRecord,
} from "@/lib/db/schema";

/* ------------------------------- leave_requests ---------------------- */

export async function insertLeave(v: NewLeaveRequest, ex: DBX = getDb()): Promise<number> {
  const res = await ex.insert(leaveRequests).values(v);
  return Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
}

export async function getLeaveById(
  id: number,
  ex: DBX = getDb(),
): Promise<LeaveRequest | undefined> {
  const rows = await ex.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
  return rows[0];
}

export async function listLeaveForUser(userId: number, ex: DBX = getDb()): Promise<LeaveRequest[]> {
  return ex
    .select()
    .from(leaveRequests)
    .where(eq(leaveRequests.userId, userId))
    .orderBy(desc(leaveRequests.startDate))
    .limit(400);
}

export interface LeaveFilter {
  from?: string | undefined;
  to?: string | undefined;
  status?: string | undefined;
  employee?: string | undefined;
}
export interface LeaveListRow extends LeaveRequest {
  employeeName: string;
}

export async function listLeaveByFilters(
  f: LeaveFilter,
  ex: DBX = getDb(),
): Promise<LeaveListRow[]> {
  const conds: SQL[] = [];
  if (f.from) conds.push(gte(leaveRequests.startDate, f.from));
  if (f.to) conds.push(lte(leaveRequests.startDate, f.to));
  if (f.status) conds.push(eq(leaveRequests.status, f.status as never));
  const rows = await ex
    .select({ row: leaveRequests, employeeName: users.fullName, employeeEmail: users.email })
    .from(leaveRequests)
    .innerJoin(users, eq(users.id, leaveRequests.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(leaveRequests.startDate))
    .limit(1000);
  const q = f.employee?.trim().toLowerCase();
  return rows
    .filter(
      (r) =>
        !q || r.employeeName.toLowerCase().includes(q) || r.employeeEmail.toLowerCase().includes(q),
    )
    .map((r) => ({ ...r.row, employeeName: r.employeeName }));
}

export async function listApprovedLeaveForUser(
  userId: number,
  ex: DBX = getDb(),
): Promise<LeaveRequest[]> {
  return ex
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.userId, userId), eq(leaveRequests.status, "APPROVED")));
}

export async function updateLeave(
  id: number,
  patch: Partial<NewLeaveRequest>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(leaveRequests).set(patch).where(eq(leaveRequests.id, id));
}

/* -------------------------------- leave_days ------------------------ */

export async function replaceLeaveDaysForRequest(
  leaveRequestId: number,
  rows: NewLeaveDay[],
  ex: DBX = getDb(),
): Promise<void> {
  await ex.delete(leaveDays).where(eq(leaveDays.leaveRequestId, leaveRequestId));
  if (rows.length) await ex.insert(leaveDays).values(rows);
}

export async function deleteLeaveDaysForOtherRequests(
  userId: number,
  keepRequestIds: number[],
  ex: DBX = getDb(),
): Promise<void> {
  if (keepRequestIds.length === 0) {
    await ex.delete(leaveDays).where(eq(leaveDays.userId, userId));
    return;
  }
  await ex
    .delete(leaveDays)
    .where(
      and(eq(leaveDays.userId, userId), not(inArray(leaveDays.leaveRequestId, keepRequestIds))),
    );
}

export async function listLeaveDaysForUser(
  userId: number,
  from?: string,
  to?: string,
  ex: DBX = getDb(),
) {
  const conds: SQL[] = [eq(leaveDays.userId, userId)];
  if (from) conds.push(gte(leaveDays.leaveDate, from));
  if (to) conds.push(lte(leaveDays.leaveDate, to));
  return ex
    .select()
    .from(leaveDays)
    .where(and(...conds))
    .orderBy(asc(leaveDays.leaveDate));
}

/* -------------------------------- off_records --------------------- */

export async function upsertOffRecords(
  userId: number,
  periodMonth: string,
  planned: Array<{
    offType: OffRecord["offType"];
    offIndex: number;
    sourceCount: number;
    sourceDescription: string;
  }>,
  nowWall: string,
  ex: DBX = getDb(),
): Promise<void> {
  const existing = await ex
    .select()
    .from(offRecords)
    .where(and(eq(offRecords.userId, userId), eq(offRecords.periodMonth, periodMonth)));

  const plannedKey = new Set(planned.map((p) => `${p.offType}:${p.offIndex}`));

  for (const p of planned) {
    const cur = existing.find((e) => e.offType === p.offType && e.offIndex === p.offIndex);
    if (cur) {
      await ex
        .update(offRecords)
        .set({
          sourceCount: p.sourceCount,
          sourceDescription: p.sourceDescription,
          status: "ACTIVE",
          calculatedAt: nowWall,
          updatedAt: nowWall,
        })
        .where(eq(offRecords.id, cur.id));
    } else {
      const v: NewOffRecord = {
        userId,
        offType: p.offType,
        periodMonth,
        offIndex: p.offIndex,
        sourceCount: p.sourceCount,
        sourceDescription: p.sourceDescription,
        status: "ACTIVE",
        calculatedAt: nowWall,
        createdAt: nowWall,
        updatedAt: nowWall,
      };
      await ex.insert(offRecords).values(v);
    }
  }

  // records the plan no longer contains → VOID (kept for audit, never deleted)
  for (const e of existing) {
    if (!plannedKey.has(`${e.offType}:${e.offIndex}`) && e.status !== "VOID") {
      await ex
        .update(offRecords)
        .set({ status: "VOID", calculatedAt: nowWall, updatedAt: nowWall })
        .where(eq(offRecords.id, e.id));
    }
  }
}

export async function listOffForUser(
  userId: number,
  from?: string,
  to?: string,
  ex: DBX = getDb(),
): Promise<OffRecord[]> {
  const conds: SQL[] = [eq(offRecords.userId, userId)];
  if (from) conds.push(gte(offRecords.periodMonth, from));
  if (to) conds.push(lte(offRecords.periodMonth, to));
  return ex
    .select()
    .from(offRecords)
    .where(and(...conds))
    .orderBy(desc(offRecords.periodMonth));
}

export interface OffFilter {
  month?: string | undefined;
  offType?: string | undefined;
  employee?: string | undefined;
}
export interface OffListRow extends OffRecord {
  employeeName: string;
}
export async function listOffByFilters(f: OffFilter, ex: DBX = getDb()): Promise<OffListRow[]> {
  const conds: SQL[] = [];
  if (f.month) conds.push(eq(offRecords.periodMonth, f.month));
  if (f.offType) conds.push(eq(offRecords.offType, f.offType as never));
  const rows = await ex
    .select({ row: offRecords, employeeName: users.fullName, employeeEmail: users.email })
    .from(offRecords)
    .innerJoin(users, eq(users.id, offRecords.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(offRecords.periodMonth))
    .limit(2000);
  const q = f.employee?.trim().toLowerCase();
  return rows
    .filter(
      (r) =>
        !q || r.employeeName.toLowerCase().includes(q) || r.employeeEmail.toLowerCase().includes(q),
    )
    .map((r) => ({ ...r.row, employeeName: r.employeeName }));
}

/* ------------------------- attendance month counts ---------------- */

export async function countAttendanceStatus(
  userId: number,
  from: string,
  to: string,
  status: "LATE" | "SHORT_ATTENDANCE",
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`count(*)` })
    .from(attendance)
    .where(
      and(
        eq(attendance.userId, userId),
        eq(attendance.status, status),
        gte(attendance.operationalDate, from),
        lte(attendance.operationalDate, to),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

/* ------------------------------- holidays ------------------------- */

export async function holidayMapInRange(
  from: string,
  to: string,
  process: string,
  ex: DBX = getDb(),
): Promise<Map<string, { reason: string }>> {
  const rows = await ex
    .select()
    .from(holidays)
    .where(and(gte(holidays.holidayDate, from), lte(holidays.holidayDate, to)));
  const map = new Map<string, { reason: string }>();
  for (const h of rows) {
    if (h.appliesToProcess && h.appliesToProcess !== process) continue;
    map.set(h.holidayDate, { reason: h.holidayType });
  }
  return map;
}
