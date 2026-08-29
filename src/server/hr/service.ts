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
  assertCanManageHolidays,
  assertCanManageLeave,
  canCancelLeave,
  canManageLeave,
  canRecalculateHr,
  type HrRole,
} from "../authz/hr";
import { holidayAwareProvider } from "./non-working";
import { planLeaveDays } from "./sandwich";
import { planOffRecords } from "./off-conversion";
import { usFederalHolidays } from "./us-federal";
import { bonusReasonText, computeRegularityBonus, type BonusResult } from "./regularity";
import * as repo from "../db/repos/hr";
import { addDaysYMD, nowIST } from "../time";
import type {
  Holiday,
  LeaveRequest,
  NewHoliday,
  NewLeaveDay,
  NewLeaveRequest,
  OffRecord,
  User,
} from "@/lib/db/schema";

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

/**
 * Recompute the ₹1,000 Monthly Regularity Bonus for a user + calendar month.
 *
 * FROZEN RULE: eligible iff NO approved leave AND NO effective Off during the
 * month. This consumes the AUTHORITATIVE Phase-11 outputs — the derived
 * `leave_days` rows (ORIGINAL + SANDWICH, attributed by their actual calculated
 * date) and the ACTIVE `off_records` (VOID excluded) — never `attendance.status`.
 *
 * Idempotent: upserts one row per (user, month). Adding a later approved leave
 * flips a ₹1,000 month to ₹0; cancelling it flips it back — just re-run.
 */
export async function recomputeBonus(
  userId: number,
  process: string,
  month: string,
): Promise<BonusResult> {
  const db = getDb();
  // make sure the authoritative Phase-11 views are current first
  await recomputeLeaveDays(userId, process);
  await recomputeOff(userId, month);

  const { from, to } = monthBounds(month);
  const [leaveDaysInMonth, offInMonth] = await Promise.all([
    repo.countLeaveDaysInMonth(userId, from, to, db),
    repo.countActiveOffInMonth(userId, month, db),
  ]);

  const result = computeRegularityBonus({
    periodMonth: month,
    approvedLeaveDaysInMonth: leaveDaysInMonth,
    effectiveOffCountInMonth: offInMonth,
  });

  const now = nowIST();
  const existing = await repo.getBonus(userId, month, db);
  await repo.upsertBonus(
    {
      userId,
      periodMonth: month,
      eligible: result.eligible,
      bonusAmount: result.bonusAmount,
      leaveCount: result.leaveCount,
      offCount: result.offCount,
      disqualifyingReasons: result.disqualifyingReasons,
      calculatedAt: now,
      calculationVersion: result.calculationVersion,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    },
    db,
  );
  return result;
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
  const bonus = await recomputeBonus(targetUserId, targetProcess, month);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "hr.recalculate",
    entityType: "user",
    entityId: targetUserId,
    metadata: {
      month,
      bonusEligible: bonus.eligible,
      bonusAmount: bonus.bonusAmount,
      leaveCount: bonus.leaveCount,
      offCount: bonus.offCount,
    },
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

/* ================================================================= *
 *  PHASE 12 — Holiday calendar + ₹1,000 Monthly Regularity Bonus     *
 * ================================================================= */

/* -------------------------- holiday reads/DTO --------------------- */

export interface HolidayDTO {
  id: number;
  name: string;
  holidayType: string;
  /** the ACTUAL calendar date */
  holidayDate: string;
  /** the OBSERVED date (null → same as holidayDate) */
  observedDate: string | null;
  /** observedDate ?? holidayDate — the single day the sandwich engine uses */
  effectiveDate: string;
  observed: boolean;
  active: boolean;
  /** null = company-wide (every process) */
  appliesToProcess: string | null;
  createdByUserId?: number | null;
  updatedByUserId?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

function holidayDTO(h: Holiday, opts: { includeAudit: boolean }): HolidayDTO {
  const base: HolidayDTO = {
    id: h.id,
    name: h.name,
    holidayType: h.holidayType,
    holidayDate: h.holidayDate,
    observedDate: h.observedDate ?? null,
    effectiveDate: h.observedDate ?? h.holidayDate,
    observed: h.observed,
    active: h.active,
    appliesToProcess: h.appliesToProcess ?? null,
  };
  if (opts.includeAudit) {
    base.createdByUserId = h.createdByUserId ?? null;
    base.updatedByUserId = h.updatedByUserId ?? null;
    base.createdAt = h.createdAt;
    base.updatedAt = h.updatedAt;
  }
  return base;
}

/** Admin / HR: every holiday matching the filter, with audit columns. */
export async function listHolidays(
  actor: Pick<User, "role">,
  f: repo.HolidayFilter,
): Promise<{ dbUnavailable?: boolean; rows: HolidayDTO[] }> {
  assertCanManageHolidays(actor.role as HrRole);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listHolidays(f);
  return { rows: rows.map((h) => holidayDTO(h, { includeAudit: true })) };
}

/** Employee (agent / closer): read-only calendar for their OWN process plus
 *  company-wide holidays, ACTIVE only, no audit columns. */
export async function myHolidays(
  user: Pick<User, "process">,
  year: string,
): Promise<{ dbUnavailable?: boolean; rows: HolidayDTO[] }> {
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listHolidays({
    year,
    process: user.process,
    activeOnly: true,
  });
  return { rows: rows.map((h) => holidayDTO(h, { includeAudit: false })) };
}

/* -------------------------- holiday mutations -------------------- */

export interface AddHolidayInput {
  name: string;
  holidayType: string; // one of HOLIDAY_TYPES
  holidayDate: string; // YYYY-MM-DD
  observedDate?: string | undefined; // optional explicit observed date
  appliesToProcess?: string | undefined; // omitted / "" → company-wide (null)
}

type ProcessOrNull = NonNullable<Holiday["appliesToProcess"]> | null;

function normProcess(p?: string | undefined): ProcessOrNull {
  const v = (p ?? "").trim().toUpperCase();
  return v === "" ? null : (v as ProcessOrNull);
}

export async function addHoliday(
  actor: Pick<User, "id" | "role">,
  input: AddHolidayInput,
  meta: Meta = {},
): Promise<{ id: number }> {
  assertCanManageHolidays(actor.role as HrRole);
  const now = nowIST();
  const observedDate =
    input.observedDate && input.observedDate !== input.holidayDate ? input.observedDate : null;
  const v: NewHoliday = {
    name: input.name.trim().slice(0, 120),
    holidayType: input.holidayType as NewHoliday["holidayType"],
    holidayDate: input.holidayDate,
    observedDate,
    observed: observedDate != null,
    appliesToProcess: normProcess(input.appliesToProcess),
    active: true,
    createdByUserId: actor.id,
    updatedByUserId: actor.id,
    createdAt: now,
    updatedAt: now,
  };
  const id = await repo.insertHoliday(v);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "holiday.create",
    entityType: "holiday",
    entityId: id,
    metadata: {
      name: v.name,
      type: v.holidayType,
      date: v.holidayDate,
      observedDate: v.observedDate,
      appliesToProcess: v.appliesToProcess,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { id };
}

export interface UpdateHolidayInput {
  name?: string | undefined;
  holidayDate?: string | undefined;
  observedDate?: string | null | undefined;
  appliesToProcess?: string | null | undefined;
  active?: boolean | undefined;
}

export async function updateHolidayEntry(
  actor: Pick<User, "id" | "role">,
  id: number,
  patch: UpdateHolidayInput,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManageHolidays(actor.role as HrRole);
  const before = await repo.getHolidayById(id);
  if (!before) throw new HttpError(404, "Holiday not found", "not_found");

  const now = nowIST();
  const next: Partial<NewHoliday> = { updatedByUserId: actor.id, updatedAt: now };
  if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 120);
  if (patch.holidayDate !== undefined) next.holidayDate = patch.holidayDate;
  if (patch.observedDate !== undefined) {
    const hd = patch.holidayDate ?? before.holidayDate;
    const obs = patch.observedDate && patch.observedDate !== hd ? patch.observedDate : null;
    next.observedDate = obs;
    next.observed = obs != null;
  }
  if (patch.appliesToProcess !== undefined) {
    next.appliesToProcess = normProcess(patch.appliesToProcess ?? undefined);
  }
  if (patch.active !== undefined) next.active = patch.active;

  await repo.updateHoliday(id, next);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "holiday.update",
    entityType: "holiday",
    entityId: id,
    metadata: {
      before: {
        name: before.name,
        holidayDate: before.holidayDate,
        observedDate: before.observedDate,
        appliesToProcess: before.appliesToProcess,
        active: before.active,
      },
      after: {
        name: next.name ?? before.name,
        holidayDate: next.holidayDate ?? before.holidayDate,
        observedDate: next.observedDate ?? before.observedDate,
        appliesToProcess:
          next.appliesToProcess === undefined ? before.appliesToProcess : next.appliesToProcess,
        active: next.active ?? before.active,
      },
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

export async function deactivateHoliday(
  actor: Pick<User, "id" | "role">,
  id: number,
  meta: Meta = {},
): Promise<{ ok: true }> {
  return updateHolidayEntry(actor, id, { active: false }, meta);
}

/**
 * Generate + persist the 11 US federal holidays for a year from the official
 * rules (fixed-date, nth-weekday, last-Monday) plus the weekend-observance rule.
 * Dedupes on (holidayDate, holidayType, appliesToProcess) so re-running is safe.
 */
export async function seedUsFederal(
  actor: Pick<User, "id" | "role">,
  year: number,
  meta: Meta = {},
): Promise<{ dbUnavailable?: boolean; created: number; skipped: number }> {
  assertCanManageHolidays(actor.role as HrRole);
  if (!isDbConfigured()) return { dbUnavailable: true, created: 0, skipped: 0 };

  const existing = await repo.listHolidays({ year: String(year), type: "US_FEDERAL" });
  const seen = new Set(existing.map((h) => h.holidayDate));
  const now = nowIST();
  let created = 0;
  let skipped = 0;

  for (const h of usFederalHolidays(year)) {
    if (seen.has(h.actualDate)) {
      skipped += 1;
      continue;
    }
    const v: NewHoliday = {
      name: h.name,
      holidayType: "US_FEDERAL",
      holidayDate: h.actualDate,
      observedDate: h.observed ? h.observedDate : null,
      observed: h.observed,
      appliesToProcess: "US",
      active: true,
      createdByUserId: actor.id,
      updatedByUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await repo.insertHoliday(v);
    created += 1;
  }

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "holiday.seed_us_federal",
    entityType: "holiday",
    entityId: year,
    metadata: { year, created, skipped },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { created, skipped };
}

/* -------------------------- regularity bonus -------------------- */

export interface BonusDTO {
  /** the employee's user id — only populated for the Admin/HR list */
  userId?: number;
  employeeName?: string;
  process?: string;
  month: string;
  eligible: boolean;
  bonusAmount: number;
  leaveCount: number;
  offCount: number;
  reasonText: string;
  calculatedAt?: string;
  calculationVersion?: string;
}

function bonusResultFromRow(row: {
  periodMonth: string;
  eligible: boolean;
  bonusAmount: number;
  leaveCount: number;
  offCount: number;
  disqualifyingReasons: unknown;
  calculationVersion: string;
}): BonusResult {
  const reasons = Array.isArray(row.disqualifyingReasons)
    ? (row.disqualifyingReasons as BonusResult["disqualifyingReasons"])
    : [];
  return {
    periodMonth: row.periodMonth,
    eligible: row.eligible,
    bonusAmount: row.bonusAmount,
    leaveCount: row.leaveCount,
    offCount: row.offCount,
    disqualifyingReasons: reasons,
    calculationVersion: row.calculationVersion,
  };
}

/** Employee: recompute-on-read then return the caller's own bonus for a month. */
export async function myBonus(
  user: Pick<User, "id" | "process">,
  month: string,
): Promise<{ dbUnavailable?: boolean; bonus: BonusDTO }> {
  const empty: BonusDTO = {
    month,
    eligible: false,
    bonusAmount: 0,
    leaveCount: 0,
    offCount: 0,
    reasonText: "Not calculated yet.",
  };
  if (!isDbConfigured()) return { dbUnavailable: true, bonus: empty };

  const result = await recomputeBonus(user.id, user.process, month);
  const row = await repo.getBonus(user.id, month);
  return {
    bonus: {
      month,
      eligible: result.eligible,
      bonusAmount: result.bonusAmount,
      leaveCount: result.leaveCount,
      offCount: result.offCount,
      reasonText: bonusReasonText(result),
      ...(row
        ? { calculatedAt: row.calculatedAt, calculationVersion: row.calculationVersion }
        : {}),
    },
  };
}

/** Admin / HR: bonus rows across employees, with filters. Read-only — no
 *  recompute here (use recalcHr / recalcBonusForMonth to refresh). */
export async function listAllBonus(
  actor: Pick<User, "role">,
  f: repo.BonusFilter,
): Promise<{ dbUnavailable?: boolean; rows: BonusDTO[] }> {
  assertCanManageLeave(actor.role as HrRole);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listBonusByFilters(f);
  return {
    rows: rows.map((r) => {
      const result = bonusResultFromRow(r);
      return {
        userId: r.userId,
        employeeName: r.employeeName,
        process: r.employeeProcess,
        month: r.periodMonth,
        eligible: r.eligible,
        bonusAmount: r.bonusAmount,
        leaveCount: r.leaveCount,
        offCount: r.offCount,
        reasonText: bonusReasonText(result),
        calculatedAt: r.calculatedAt,
        calculationVersion: r.calculationVersion,
      };
    }),
  };
}

/**
 * Admin / HR: (re)calculate the regularity bonus for one employee + month.
 * Server-callable and idempotent so a future scheduler can loop it over all
 * active employees — Phase 12 builds no scheduler.
 */
export async function recalcBonusForEmployee(
  actor: Pick<User, "id" | "role" | "process">,
  targetUserId: number,
  month: string,
  meta: Meta = {},
): Promise<{ ok: true; bonus: BonusDTO }> {
  assertCanManageLeave(actor.role as HrRole);
  const process = await ownerProcessOf(targetUserId, actor);
  const result = await recomputeBonus(targetUserId, process, month);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "bonus.recalculate",
    entityType: "regularity_bonus",
    entityId: targetUserId,
    metadata: {
      month,
      eligible: result.eligible,
      bonusAmount: result.bonusAmount,
      leaveCount: result.leaveCount,
      offCount: result.offCount,
      version: result.calculationVersion,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return {
    ok: true,
    bonus: {
      month,
      eligible: result.eligible,
      bonusAmount: result.bonusAmount,
      leaveCount: result.leaveCount,
      offCount: result.offCount,
      reasonText: bonusReasonText(result),
    },
  };
}
