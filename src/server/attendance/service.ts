/**
 * Officeverse — attendance service (Phase 10).
 *
 * DERIVED from Phase-9A `sessions` (no second login tracker), computed with
 * SERVER-SIDE timestamps + the SERVER-AUTHORITATIVE `users.process`, persisted
 * as one row per (user, operational date). Recomputed lazily on authenticated
 * activity — NO scheduler, NO always-on process, GoDaddy-portable.
 *
 * Absence marking is DEFERRED (needs a scheduler). Off-conversion / leave /
 * holiday / regularity-bonus / salary / incentive logic is NOT here.
 */
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { shiftDateIST } from "@/lib/officeverse/shift";
import type { ProcessCode } from "@/lib/officeverse/types";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import {
  assertCanCorrectAttendance,
  assertCanViewAllAttendance,
  assertCanViewManagedAttendance,
  assertCanViewOwnAttendance,
  assertValidOverride,
  type OverrideClass,
} from "../authz/attendance";
import { classifyAttendance, LATE_RULES } from "./classify";
import { mergedMinutes, type Interval } from "./merge";
import * as repo from "../db/repos/attendance";
import { istWallClockToEpochMs, nowIST } from "../time";
import type { Attendance, NewAttendance, User } from "@/lib/db/schema";

const TRACKED_ROLES = new Set<User["role"]>(["agent", "closer"]);

/* ---------------------------- lazy recompute ---------------------------- */

const lastTouch = new Map<string, number>();
const TOUCH_THROTTLE_MS = 90_000;

/** Never throws — called from context.getAuth() on every authenticated request. */
export async function touchAttendanceSafe(
  user: Pick<User, "id" | "role" | "process">,
): Promise<void> {
  try {
    if (!TRACKED_ROLES.has(user.role) || !isDbConfigured()) return;
    await touchAttendance(user);
  } catch (err) {
    console.warn(
      `[attendance] touch failed for user ${user.id}: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }
}

export async function touchAttendance(
  user: Pick<User, "id" | "role" | "process">,
  nowWall: string = nowIST(),
): Promise<void> {
  const process = user.process as ProcessCode;
  const nowMs = istWallClockToEpochMs(nowWall);
  const operationalDate = shiftDateIST(nowMs, process);

  const throttleKey = `${user.id}:${operationalDate}`;
  const prev = lastTouch.get(throttleKey);
  if (prev && nowMs - prev < TOUCH_THROTTLE_MS) return;
  lastTouch.set(throttleKey, nowMs);

  const db = getDb();

  const existing = await repo.getByUserAndDate(user.id, operationalDate, db);
  if (existing?.source === "corrected") return; // never clobber a manual correction

  // all of this user's sessions whose check-in maps to THIS operational date.
  // Phase 23: ONLY attendance-eligible sessions (office-network logins of an
  // office-gated role) contribute. A remote Closer session never creates
  // attendance; changing IP alone never creates a new attendance event.
  const rows = await db
    .select({
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      revokedAt: sessions.revokedAt,
      attendanceEligible: sessions.attendanceEligible,
    })
    .from(sessions)
    .where(eq(sessions.userId, user.id));

  const daySessions = rows.filter(
    (s) =>
      s.attendanceEligible === true &&
      shiftDateIST(istWallClockToEpochMs(s.createdAt), process) === operationalDate,
  );
  if (daySessions.length === 0) return;

  const cls = classifyAttendance({ process, operationalDate });
  const startMs = istWallClockToEpochMs(cls.shiftStartAt);
  const endMs = istWallClockToEpochMs(cls.shiftEndAt);

  let firstInMs = Number.POSITIVE_INFINITY;
  let lastOutMs = Number.NEGATIVE_INFINITY;
  const intervals: Interval[] = [];
  for (const s of daySessions) {
    const inMs = istWallClockToEpochMs(s.createdAt);
    // a revoked session ended at revoked_at; a live session is "present" up to now
    const outMs = s.revokedAt
      ? istWallClockToEpochMs(s.revokedAt)
      : Math.max(istWallClockToEpochMs(s.lastSeenAt), nowMs);
    firstInMs = Math.min(firstInMs, inMs);
    lastOutMs = Math.max(lastOutMs, outMs);
    // duration is counted only WITHIN the shift window (a tab left open all
    // afternoon must not inflate the total)
    intervals.push({ startMs: Math.max(inMs, startMs), endMs: Math.min(outMs, endMs) });
  }

  const firstCheckInAt = wallOf(firstInMs);
  const lastCheckOutAt = wallOf(lastOutMs);
  const finalCls = classifyAttendance({ process, operationalDate, firstCheckInAt, lastCheckOutAt });
  const totalMinutes = mergedMinutes(intervals);

  const derived: Partial<NewAttendance> = {
    process,
    shiftName: shiftLabel(process),
    reportingAt: finalCls.reportingAt,
    shiftStartAt: finalCls.shiftStartAt,
    shiftEndAt: finalCls.shiftEndAt,
    firstCheckInAt,
    lastCheckOutAt,
    totalMinutes,
    lateMinutes: finalCls.lateMinutes,
    earlyDepartureMinutes: finalCls.earlyDepartureMinutes,
    checkInStatus: finalCls.checkInStatus,
    checkOutStatus: finalCls.checkOutStatus,
    status: finalCls.status,
    shortAttendance: finalCls.shortAttendance,
    sessionCount: daySessions.length,
    updatedAt: nowWall,
  };

  if (existing) {
    await repo.updateDerived(existing.id, derived, db);
  } else {
    await repo.insertRow(
      {
        ...(derived as Record<string, unknown>),
        userId: user.id,
        role: user.role,
        operationalDate,
        source: "derived",
        createdAt: nowWall,
      } as NewAttendance,
      db,
    );
  }
}

function wallOf(ms: number): string {
  return nowIST(ms).slice(0, 19);
}

function shiftLabel(p: ProcessCode): string {
  return p === "US" ? "US SHIFT" : p === "IN" ? "INDIA SHIFT" : `${p} SHIFT`;
}

/* ------------------------------- read side ---------------------------- */

export interface AttendanceDTO {
  id: number;
  employeeName?: string;
  role: string;
  process: string;
  shiftName: string;
  operationalDate: string;
  reportingAt: string;
  shiftStartAt: string;
  shiftEndAt: string;
  firstCheckInAt: string | null;
  lastCheckOutAt: string | null;
  totalMinutes: number;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  checkInStatus: string;
  checkOutStatus: string;
  status: string;
  shortAttendance: boolean;
  /** business-facing check-in classification */
  lateClass: "NORMAL" | "SHORT_LATE" | "LATE" | "PENDING";
  sessionCount: number;
  source: string;
  corrected: boolean;
  correctionReason: string | null;
  classificationPending: boolean;
}

/** business classification derived from the stored raw statuses */
function lateClassOf(a: Attendance): AttendanceDTO["lateClass"] {
  if (!LATE_RULES[a.process as keyof typeof LATE_RULES]) return "PENDING";
  if (a.checkInStatus === "LATE") return "LATE";
  if (a.checkInStatus === "SHORT") return "SHORT_LATE";
  if (a.checkInStatus === "ON_TIME") return "NORMAL";
  return "PENDING";
}

function toDTO(a: Attendance, employeeName?: string): AttendanceDTO {
  return {
    id: a.id,
    ...(employeeName ? { employeeName } : {}),
    role: a.role,
    process: a.process,
    shiftName: a.shiftName,
    operationalDate: a.operationalDate,
    reportingAt: a.reportingAt,
    shiftStartAt: a.shiftStartAt,
    shiftEndAt: a.shiftEndAt,
    firstCheckInAt: a.firstCheckInAt ?? null,
    lastCheckOutAt: a.lastCheckOutAt ?? null,
    totalMinutes: a.totalMinutes,
    lateMinutes: a.lateMinutes,
    earlyDepartureMinutes: a.earlyDepartureMinutes,
    checkInStatus: a.checkInStatus,
    checkOutStatus: a.checkOutStatus,
    status: a.status,
    shortAttendance: a.shortAttendance,
    lateClass: lateClassOf(a),
    sessionCount: a.sessionCount,
    source: a.source,
    corrected: a.source === "corrected",
    correctionReason: a.correctionReason ?? null,
    classificationPending: !LATE_RULES[a.process as keyof typeof LATE_RULES],
  };
}

export interface MyAttendanceResult {
  rows: AttendanceDTO[];
  dbUnavailable?: boolean;
}

export async function listMyAttendance(
  user: Pick<User, "id" | "role">,
  range: { from?: string | undefined; to?: string | undefined } = {},
): Promise<MyAttendanceResult> {
  // Agents have NO attendance visibility (own history included) — server-enforced.
  assertCanViewOwnAttendance(user.role);
  if (!isDbConfigured()) return { rows: [], dbUnavailable: true };
  const rows = await repo.listForUser(user.id, range.from, range.to);
  return { rows: rows.map((r) => toDTO(r)) };
}

/**
 * Manager view of AGENT attendance. A Closer sees ONLY agents in their own
 * process (US Closer → US Agents; India Closer → India Agents). HR / Admin see
 * every agent. Never carries any compensation field.
 */
export async function listManagedAttendance(
  actor: Pick<User, "role" | "process">,
  f: AdminAttendanceFilters,
): Promise<AdminAttendanceResult> {
  assertCanViewManagedAttendance(actor.role);
  if (!isDbConfigured()) return { rows: [], dbUnavailable: true };

  // A Closer is hard-scoped to their own process; HR/Admin may pass a filter.
  const process = actor.role === "closer" ? (actor.process as string) : f.process || undefined;

  let userIds: number[] | undefined;
  if (f.employee && f.employee.trim()) {
    const q = f.employee.trim().toLowerCase();
    const matched = await getDb()
      .select({ id: users.id, email: users.email, name: users.fullName })
      .from(users);
    userIds = matched
      .filter((u) => u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))
      .map((u) => u.id);
    if (userIds.length === 0) return { rows: [] };
  }

  const rows = await repo.listByFilters({
    from: f.from,
    to: f.to,
    userIds,
    process,
    shiftName: f.shiftName,
    status: f.status,
  });
  // manager operational view = AGENT rows only (never closer/admin/hr rows)
  return { rows: rows.filter((r) => r.role === "agent").map((r) => toDTO(r, r.employeeName)) };
}

export interface AdminAttendanceFilters {
  from?: string | undefined;
  to?: string | undefined;
  employee?: string | undefined; // email / name fragment
  process?: string | undefined;
  shiftName?: string | undefined;
  status?: string | undefined;
}

export interface AdminAttendanceResult {
  rows: AttendanceDTO[];
  dbUnavailable?: boolean;
}

export async function listAllAttendance(
  actor: Pick<User, "role">,
  f: AdminAttendanceFilters,
): Promise<AdminAttendanceResult> {
  assertCanViewAllAttendance(actor.role);
  if (!isDbConfigured()) return { rows: [], dbUnavailable: true };

  let userIds: number[] | undefined;
  if (f.employee && f.employee.trim()) {
    const q = f.employee.trim().toLowerCase();
    const matched = await getDb()
      .select({ id: users.id, email: users.email, name: users.fullName })
      .from(users);
    userIds = matched
      .filter((u) => u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))
      .map((u) => u.id);
    if (userIds.length === 0) return { rows: [] };
  }

  const rows = await repo.listByFilters({
    from: f.from,
    to: f.to,
    userIds,
    process: f.process,
    shiftName: f.shiftName,
    status: f.status,
  });
  return { rows: rows.map((r) => toDTO(r, r.employeeName)) };
}

/* ---------------------------- correction ---------------------------- */

const CORRECTABLE = new Set<keyof NewAttendance>([
  "firstCheckInAt",
  "lastCheckOutAt",
  "totalMinutes",
  "lateMinutes",
  "earlyDepartureMinutes",
  "status",
  "checkInStatus",
  "checkOutStatus",
  "shortAttendance",
]);

export async function correctAttendance(
  actor: Pick<User, "id" | "role">,
  id: number,
  patch: Record<string, unknown>,
  reason: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ ok: true }> {
  assertCanCorrectAttendance(actor.role);
  if (!reason.trim()) {
    throw new HttpError(400, "A correction reason is required", "reason_required");
  }
  const db = getDb();
  const before = await repo.getById(id, db);
  if (!before) {
    throw new HttpError(404, "Attendance row not found", "not_found");
  }

  const safe: Partial<NewAttendance> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (CORRECTABLE.has(k as keyof NewAttendance)) {
      (safe as Record<string, unknown>)[k] = v;
    }
  }
  if (Object.keys(safe).length === 0) {
    throw new HttpError(400, "No correctable fields supplied", "no_fields");
  }

  const now = nowIST();
  await repo.applyCorrection(id, before, safe, actor.id, reason.trim(), now, db);

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "attendance.correct",
    entityType: "attendance",
    entityId: id,
    metadata: { fields: Object.keys(safe), reason: reason.trim().slice(0, 300) },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { ok: true };
}

/* ----------------------- classification override ------------------ *
 * The spec's HR/Admin UI contract: pick NORMAL / SHORT LATE / LATE + a reason.
 * This maps that one choice onto the stored raw statuses and reuses
 * `correctAttendance` so the audit trail + `original_snapshot` (the ORIGINAL
 * system result stays traceable) + "corrected rows are never re-derived" all
 * still apply. Every server-side calc that reads `attendance.status` (2 LATE →
 * OFF, 3 SHORT LATE → OFF, Regularity Bonus) then uses the corrected value —
 * nothing is faked.                                                            */

const OVERRIDE_TO_STATUS: Record<
  OverrideClass,
  { status: string; checkInStatus: string; shortAttendance: boolean }
> = {
  NORMAL: { status: "ON_TIME", checkInStatus: "ON_TIME", shortAttendance: false },
  SHORT_LATE: { status: "SHORT_ATTENDANCE", checkInStatus: "SHORT", shortAttendance: true },
  LATE: { status: "LATE", checkInStatus: "LATE", shortAttendance: false },
};

export async function overrideAttendanceClass(
  actor: Pick<User, "id" | "role">,
  input: { id: number; newClass: string; reason: string },
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ ok: true; from: string; to: string }> {
  assertValidOverride(actor.role, input.newClass, input.reason);
  const db = getDb();
  const before = await repo.getById(input.id, db);
  if (!before) throw new HttpError(404, "Attendance row not found", "not_found");

  const target = OVERRIDE_TO_STATUS[input.newClass as OverrideClass];
  const fromClass = lateClassOf(before);
  await correctAttendance(actor, input.id, { ...target }, input.reason, meta);

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "attendance.override",
    entityType: "attendance",
    entityId: input.id,
    metadata: {
      operationalDate: before.operationalDate,
      original: fromClass,
      new: input.newClass,
      actualCheckIn: before.firstCheckInAt ?? null,
      actualCheckOut: before.lastCheckOutAt ?? null,
      originalOfficeNetwork:
        (before.originalSnapshot as { officeNetworkId?: unknown })?.officeNetworkId ?? null,
      reason: input.reason.trim().slice(0, 300),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, from: fromClass, to: input.newClass };
}
