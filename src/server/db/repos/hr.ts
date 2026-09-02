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
  regularityBonus,
  users,
  type Holiday,
  type LeaveRequest,
  type NewHoliday,
  type NewLeaveDay,
  type NewLeaveRequest,
  type NewOffRecord,
  type NewRegularityBonus,
  type OffRecord,
  type RegularityBonus,
} from "@/lib/db/schema";
import { buildHolidayMap } from "@/server/hr/holiday-map";

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

/**
 * Admin UAT Batch-2 §5 — monthly CHECK-IN lateness counts, straight off the
 * stored `attendance.check_in_status` (NORMAL→ON_TIME / SHORT_LATE→SHORT /
 * LATE→LATE). These feed the Late-Units engine. Distinct from
 * `countAttendanceStatus` above, which counts the OVERALL day status (and so
 * also folds in early-departure "short attendance").
 */
export async function countCheckInLatenessInMonth(
  userId: number,
  from: string,
  to: string,
  ex: DBX = getDb(),
): Promise<{ shortLate: number; late: number }> {
  const rows = await ex
    .select({
      s: sql<number>`sum(case when ${attendance.checkInStatus} = 'SHORT' then 1 else 0 end)`,
      l: sql<number>`sum(case when ${attendance.checkInStatus} = 'LATE' then 1 else 0 end)`,
    })
    .from(attendance)
    .where(
      and(
        eq(attendance.userId, userId),
        gte(attendance.operationalDate, from),
        lte(attendance.operationalDate, to),
      ),
    );
  return { shortLate: Number(rows[0]?.s ?? 0), late: Number(rows[0]?.l ?? 0) };
}

/* ------------------------------- holidays ------------------------- */

export async function holidayMapInRange(
  from: string,
  to: string,
  process: string,
  ex: DBX = getDb(),
): Promise<Map<string, { reason: string }>> {
  // widen the fetch window so a holiday whose OBSERVED date lands in range is
  // included even if its actual date sits just outside it
  const rows = await ex
    .select()
    .from(holidays)
    .where(and(gte(holidays.holidayDate, from), lte(holidays.holidayDate, to)));
  return buildHolidayMap(rows, process);
}

/* -------- Phase 12: holiday CRUD (Admin/HR) + read for employees --- */

export async function insertHoliday(v: NewHoliday, ex: DBX = getDb()): Promise<number> {
  const res = await ex.insert(holidays).values(v);
  return Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
}

export async function getHolidayById(id: number, ex: DBX = getDb()): Promise<Holiday | undefined> {
  const rows = await ex.select().from(holidays).where(eq(holidays.id, id)).limit(1);
  return rows[0];
}

export async function updateHoliday(
  id: number,
  patch: Partial<NewHoliday>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(holidays).set(patch).where(eq(holidays.id, id));
}

export interface HolidayFilter {
  year?: string | undefined; // "YYYY"
  type?: string | undefined;
  process?: string | undefined;
  activeOnly?: boolean | undefined;
}

export async function listHolidays(f: HolidayFilter, ex: DBX = getDb()): Promise<Holiday[]> {
  const conds: SQL[] = [];
  if (f.year) {
    conds.push(gte(holidays.holidayDate, `${f.year}-01-01`));
    conds.push(lte(holidays.holidayDate, `${f.year}-12-31`));
  }
  if (f.type) conds.push(eq(holidays.holidayType, f.type as never));
  if (f.activeOnly) conds.push(eq(holidays.active, true));
  const rows = await ex
    .select()
    .from(holidays)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(holidays.holidayDate))
    .limit(2000);
  if (!f.process) return rows;
  return rows.filter((h) => h.appliesToProcess == null || h.appliesToProcess === f.process);
}

/* --------------------------- regularity_bonus -------------------- */

export async function getBonus(
  userId: number,
  periodMonth: string,
  ex: DBX = getDb(),
): Promise<RegularityBonus | undefined> {
  const rows = await ex
    .select()
    .from(regularityBonus)
    .where(and(eq(regularityBonus.userId, userId), eq(regularityBonus.periodMonth, periodMonth)))
    .limit(1);
  return rows[0];
}

export async function upsertBonus(v: NewRegularityBonus, ex: DBX = getDb()): Promise<void> {
  const existing = await getBonus(v.userId, v.periodMonth, ex);
  if (existing) {
    await ex
      .update(regularityBonus)
      .set({
        eligible: v.eligible,
        bonusAmount: v.bonusAmount ?? 0,
        leaveCount: v.leaveCount ?? 0,
        offCount: v.offCount ?? 0,
        disqualifyingReasons: v.disqualifyingReasons ?? [],
        calculatedAt: v.calculatedAt,
        calculationVersion: v.calculationVersion ?? "v1",
        updatedAt: v.updatedAt,
      })
      .where(eq(regularityBonus.id, existing.id));
  } else {
    await ex.insert(regularityBonus).values(v);
  }
}

export interface BonusFilter {
  month?: string | undefined;
  employee?: string | undefined;
  process?: string | undefined;
  eligible?: boolean | undefined;
}
export interface BonusListRow extends RegularityBonus {
  employeeName: string;
  employeeProcess: string;
}
export async function listBonusByFilters(
  f: BonusFilter,
  ex: DBX = getDb(),
): Promise<BonusListRow[]> {
  const conds: SQL[] = [];
  if (f.month) conds.push(eq(regularityBonus.periodMonth, f.month));
  if (f.eligible !== undefined) conds.push(eq(regularityBonus.eligible, f.eligible));
  const rows = await ex
    .select({
      row: regularityBonus,
      employeeName: users.fullName,
      employeeEmail: users.email,
      employeeProcess: users.process,
    })
    .from(regularityBonus)
    .innerJoin(users, eq(users.id, regularityBonus.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(regularityBonus.periodMonth))
    .limit(3000);
  const q = f.employee?.trim().toLowerCase();
  return rows
    .filter(
      (r) =>
        (!q ||
          r.employeeName.toLowerCase().includes(q) ||
          r.employeeEmail.toLowerCase().includes(q)) &&
        (!f.process || r.employeeProcess === f.process),
    )
    .map((r) => ({ ...r.row, employeeName: r.employeeName, employeeProcess: r.employeeProcess }));
}

/** distinct leave_days count in a calendar month (ORIGINAL + SANDWICH). */
export async function countLeaveDaysInMonth(
  userId: number,
  from: string,
  to: string,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`count(distinct ${leaveDays.leaveDate})` })
    .from(leaveDays)
    .where(
      and(
        eq(leaveDays.userId, userId),
        gte(leaveDays.leaveDate, from),
        lte(leaveDays.leaveDate, to),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

/** ACTIVE off_records for a month. */
export async function countActiveOffInMonth(
  userId: number,
  periodMonth: string,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`count(*)` })
    .from(offRecords)
    .where(
      and(
        eq(offRecords.userId, userId),
        eq(offRecords.periodMonth, periodMonth),
        eq(offRecords.status, "ACTIVE"),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}
