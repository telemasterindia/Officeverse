/**
 * Officeverse — attendance repository (Phase 10). DATA ACCESS ONLY.
 *
 * One row per (user_id, operational_date) — the UNIQUE constraint plus a
 * get-then-write upsert keeps multiple sessions from creating duplicate days.
 * A row whose `source = "corrected"` is never overwritten by the derived path.
 */
import { and, asc, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import { attendance, users, type Attendance, type NewAttendance } from "@/lib/db/schema";

export async function getByUserAndDate(
  userId: number,
  operationalDate: string,
  ex: DBX = getDb(),
): Promise<Attendance | undefined> {
  const rows = await ex
    .select()
    .from(attendance)
    .where(and(eq(attendance.userId, userId), eq(attendance.operationalDate, operationalDate)))
    .limit(1);
  return rows[0];
}

export async function insertRow(values: NewAttendance, ex: DBX = getDb()): Promise<void> {
  await ex.insert(attendance).values(values);
}

/** Update the DERIVED fields of an existing row (never touches correction trail). */
export async function updateDerived(
  id: number,
  patch: Partial<NewAttendance>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(attendance).set(patch).where(eq(attendance.id, id));
}

export interface AttendanceListFilters {
  from?: string | undefined; // operational_date >=
  to?: string | undefined; // operational_date <=
  userIds?: number[] | undefined;
  process?: string | undefined;
  shiftName?: string | undefined;
  status?: string | undefined;
}

export interface AttendanceListRow extends Attendance {
  employeeName: string;
  employeeEmail: string;
}

export async function listByFilters(
  f: AttendanceListFilters,
  limit = 2000,
  ex: DBX = getDb(),
): Promise<AttendanceListRow[]> {
  const conds: SQL[] = [];
  if (f.from) conds.push(gte(attendance.operationalDate, f.from));
  if (f.to) conds.push(lte(attendance.operationalDate, f.to));
  if (f.userIds && f.userIds.length) conds.push(inArray(attendance.userId, f.userIds));
  if (f.process) conds.push(eq(attendance.process, f.process as never));
  if (f.shiftName) conds.push(eq(attendance.shiftName, f.shiftName));
  if (f.status) conds.push(eq(attendance.status, f.status as never));

  const rows = await ex
    .select({
      row: attendance,
      employeeName: users.fullName,
      employeeEmail: users.email,
    })
    .from(attendance)
    .innerJoin(users, eq(users.id, attendance.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(attendance.operationalDate), asc(users.fullName))
    .limit(limit);

  return rows.map((r) => ({
    ...r.row,
    employeeName: r.employeeName,
    employeeEmail: r.employeeEmail,
  }));
}

export async function listForUser(
  userId: number,
  from: string | undefined,
  to: string | undefined,
  limit = 400,
  ex: DBX = getDb(),
): Promise<Attendance[]> {
  const conds: SQL[] = [eq(attendance.userId, userId)];
  if (from) conds.push(gte(attendance.operationalDate, from));
  if (to) conds.push(lte(attendance.operationalDate, to));
  return ex
    .select()
    .from(attendance)
    .where(and(...conds))
    .orderBy(desc(attendance.operationalDate))
    .limit(limit);
}

export async function getById(id: number, ex: DBX = getDb()): Promise<Attendance | undefined> {
  const rows = await ex.select().from(attendance).where(eq(attendance.id, id)).limit(1);
  return rows[0];
}

/**
 * Apply an Admin/HR correction. Snapshots the PRE-correction derived values
 * into `original_snapshot` the first time only, so history is never lost.
 */
export async function applyCorrection(
  id: number,
  before: Attendance,
  patch: Partial<NewAttendance>,
  actorUserId: number,
  reason: string,
  nowWall: string,
  ex: DBX = getDb(),
): Promise<void> {
  const set: Partial<NewAttendance> = {
    ...patch,
    source: "corrected",
    correctedByUserId: actorUserId,
    correctedAt: nowWall,
    correctionReason: reason.slice(0, 500),
    updatedAt: nowWall,
  };
  if (before.originalSnapshot == null) {
    set.originalSnapshot = {
      firstCheckInAt: before.firstCheckInAt,
      lastCheckOutAt: before.lastCheckOutAt,
      totalMinutes: before.totalMinutes,
      lateMinutes: before.lateMinutes,
      earlyDepartureMinutes: before.earlyDepartureMinutes,
      checkInStatus: before.checkInStatus,
      checkOutStatus: before.checkOutStatus,
      status: before.status,
      shortAttendance: before.shortAttendance,
      capturedAt: nowWall,
    } as NewAttendance["originalSnapshot"];
  }
  await ex.update(attendance).set(set).where(eq(attendance.id, id));
}
