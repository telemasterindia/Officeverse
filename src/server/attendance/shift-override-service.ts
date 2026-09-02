/**
 * Officeverse — dynamic shift overrides (Admin UAT Batch-2 follow-up §1).
 *
 * An Admin may replace the default shift window + late boundaries for ONE
 * (process, operational date): temporary Saturday shift, early shift, a DST or
 * seasonal change. The attendance classifier for that date then uses the
 * effective row. Employees can never reach any of this.
 *
 * Historical safety:
 *   - the lazy `touchAttendance` path ONLY ever recomputes the CURRENT
 *     operational date, so adding a row for a future / other date never
 *     rewrites an earlier day;
 *   - a stored attendance row already snapshots its own shift anchors;
 *   - applying an override to an ALREADY-ELAPSED date is a deliberate,
 *     audited Admin action (`recomputeAttendanceForDate`) and still skips any
 *     `source = "corrected"` row.
 */
import { getDb, isDbConfigured } from "@/lib/db";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { assertCanManageShiftOverrides } from "../authz/shift-overrides";
import { nowIST } from "../time";
import { PROCESS_CODES } from "@/lib/db/schema";
import { HHMM_RE, resolveShift, type ShiftOverrideInput } from "./classify";
import { deriveAttendanceForDate, shiftOverrideToClassifier } from "./service";
import * as repo from "../db/repos/shift-overrides";
import * as attendanceRepo from "../db/repos/attendance";
import type { NewShiftOverride, User } from "@/lib/db/schema";
import type { ProcessCode } from "@/lib/officeverse/types";

type ProcessEnum = NewShiftOverride["process"];

type Meta = { ip?: string | null; userAgent?: string | null };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function assertHHMM(v: string, field: string): void {
  if (!HHMM_RE.test(v)) throw new HttpError(400, `${field} must be HH:MM (24h)`, "bad_time");
}
function optHHMM(v: string | null | undefined, field: string): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  assertHHMM(t, field);
  return t;
}
function assertProcess(p: string): asserts p is ProcessCode {
  if (!(PROCESS_CODES as readonly string[]).includes(p)) {
    throw new HttpError(400, "Unknown process", "bad_process");
  }
}

export interface ShiftOverrideDTO {
  process: string;
  operationalDate: string;
  startHHMM: string;
  endHHMM: string;
  reportingHHMM: string | null;
  shortLateFromHHMM: string | null;
  lateFromHHMM: string | null;
  reason: string | null;
  /** the fully-resolved effective window (derived boundaries filled in) */
  effective: { start: string; end: string; overnight: boolean; reportingHHMM: string | null };
  createdByName: string | null;
  updatedAt: string;
}

function toDTO(r: repo.ShiftOverrideListRow): ShiftOverrideDTO {
  const eff = resolveShift(r.process as ProcessCode, shiftOverrideToClassifier(r));
  return {
    process: r.process,
    operationalDate: r.operationalDate,
    startHHMM: r.startHhmm,
    endHHMM: r.endHhmm,
    reportingHHMM: r.reportingHhmm ?? null,
    shortLateFromHHMM: r.shortLateFromHhmm ?? null,
    lateFromHHMM: r.lateFromHhmm ?? null,
    reason: r.reason ?? null,
    effective: {
      start: eff.start,
      end: eff.end,
      overnight: eff.overnight,
      reportingHHMM: eff.rule?.reportingHHMM ?? null,
    },
    createdByName: r.createdByName,
    updatedAt: r.updatedAt,
  };
}

export async function listShiftOverrides(
  actor: Pick<User, "role">,
  filter: { process?: string | undefined; from?: string | undefined; to?: string | undefined } = {},
): Promise<{ dbUnavailable?: boolean; rows: ShiftOverrideDTO[] }> {
  assertCanManageShiftOverrides(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listShiftOverrides(filter);
  return { rows: rows.map(toDTO) };
}

export interface SetShiftOverrideInput {
  process: string;
  operationalDate: string;
  startHHMM: string;
  endHHMM: string;
  reportingHHMM?: string | null | undefined;
  shortLateFromHHMM?: string | null | undefined;
  lateFromHHMM?: string | null | undefined;
  reason?: string | undefined;
}

export async function setShiftOverride(
  actor: Pick<User, "id" | "role">,
  input: SetShiftOverrideInput,
  meta: Meta = {},
): Promise<{ ok: true; override: ShiftOverrideDTO }> {
  assertCanManageShiftOverrides(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");

  assertProcess(input.process);
  if (!YMD.test(input.operationalDate)) {
    throw new HttpError(400, "operationalDate must be YYYY-MM-DD", "bad_date");
  }
  assertHHMM(input.startHHMM, "startHHMM");
  assertHHMM(input.endHHMM, "endHHMM");
  if (input.startHHMM === input.endHHMM) {
    throw new HttpError(400, "Shift start and end cannot be the same time", "bad_window");
  }

  const now = nowIST();
  const v: NewShiftOverride = {
    process: input.process as ProcessEnum,
    operationalDate: input.operationalDate,
    startHhmm: input.startHHMM,
    endHhmm: input.endHHMM,
    reportingHhmm: optHHMM(input.reportingHHMM, "reportingHHMM"),
    shortLateFromHhmm: optHHMM(input.shortLateFromHHMM, "shortLateFromHHMM"),
    lateFromHhmm: optHHMM(input.lateFromHHMM, "lateFromHHMM"),
    reason: input.reason?.trim().slice(0, 255) || null,
    createdByUserId: actor.id,
    updatedByUserId: actor.id,
    createdAt: now,
    updatedAt: now,
  };

  const existed = Boolean(await repo.getShiftOverride(input.process, input.operationalDate));
  await repo.upsertShiftOverride(v);

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: existed ? "shift_override.update" : "shift_override.create",
    entityType: "shift_override",
    entityId: null,
    metadata: {
      process: input.process,
      operationalDate: input.operationalDate,
      start: input.startHHMM,
      end: input.endHHMM,
      reason: v.reason,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  const rows = await repo.listShiftOverrides({
    process: input.process,
    from: input.operationalDate,
    to: input.operationalDate,
  });
  return { ok: true, override: toDTO(rows[0]!) };
}

export async function removeShiftOverride(
  actor: Pick<User, "id" | "role">,
  input: { process: string; operationalDate: string },
  meta: Meta = {},
): Promise<{ ok: true; removed: boolean }> {
  assertCanManageShiftOverrides(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  assertProcess(input.process);
  const removed = await repo.deleteShiftOverride(input.process, input.operationalDate);
  if (removed) {
    await recordAudit({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: "shift_override.delete",
      entityType: "shift_override",
      entityId: null,
      metadata: { process: input.process, operationalDate: input.operationalDate },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
  }
  return { ok: true, removed };
}

/**
 * Re-derive every NON-corrected attendance row for one (process, date) against
 * the current effective shift. Explicit Admin action so an override that lands
 * after the date has passed can still be applied deliberately — the automatic
 * path never touches an elapsed day.
 */
export async function recomputeAttendanceForDate(
  actor: Pick<User, "id" | "role">,
  input: { process: string; operationalDate: string },
  meta: Meta = {},
): Promise<{ ok: true; recomputed: number; skippedCorrected: number }> {
  assertCanManageShiftOverrides(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  assertProcess(input.process);
  if (!YMD.test(input.operationalDate)) {
    throw new HttpError(400, "operationalDate must be YYYY-MM-DD", "bad_date");
  }

  const rows = await attendanceRepo.listByFilters({
    from: input.operationalDate,
    to: input.operationalDate,
    process: input.process,
  });

  let recomputed = 0;
  let skippedCorrected = 0;
  for (const r of rows) {
    if (r.source === "corrected") {
      skippedCorrected += 1;
      continue;
    }
    await deriveAttendanceForDate(
      { id: r.userId, role: r.role },
      input.process as ProcessCode,
      input.operationalDate,
    );
    recomputed += 1;
  }

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "shift_override.recompute_attendance",
    entityType: "shift_override",
    entityId: null,
    metadata: {
      process: input.process,
      operationalDate: input.operationalDate,
      recomputed,
      skippedCorrected,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { ok: true, recomputed, skippedCorrected };
}

/** Read-only: the effective shift for a (process, date) — for the UI + probes. */
export async function effectiveShiftForDate(
  process: string,
  operationalDate: string,
): Promise<{
  start: string;
  end: string;
  overnight: boolean;
  reportingHHMM: string | null;
  shortLateFromHHMM: string | null;
  lateFromHHMM: string | null;
  source: "default" | "override";
}> {
  assertProcess(process);
  const row = isDbConfigured() ? await repo.getShiftOverride(process, operationalDate) : undefined;
  const ov: ShiftOverrideInput | null = shiftOverrideToClassifier(row);
  const eff = resolveShift(process, ov);
  return {
    start: eff.start,
    end: eff.end,
    overnight: eff.overnight,
    reportingHHMM: eff.rule?.reportingHHMM ?? null,
    shortLateFromHHMM: eff.rule?.shortLateFromHHMM ?? null,
    lateFromHHMM: eff.rule?.lateFromHHMM ?? null,
    source: eff.overridden ? "override" : "default",
  };
}
