/**
 * Officeverse — shift_overrides repository (Admin UAT Batch-2 follow-up §1).
 * DATA ACCESS ONLY. Authorization lives in ../authz/shift-overrides.ts; the
 * shift maths lives in ../attendance/classify.ts (pure).
 *
 * One row per (process, operational_date) — the UNIQUE constraint plus a
 * get-then-write upsert keeps a date from ever having two competing shifts.
 */
import { and, asc, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import { shiftOverrides, users, type NewShiftOverride, type ShiftOverride } from "@/lib/db/schema";

export async function getShiftOverride(
  process: string,
  operationalDate: string,
  ex: DBX = getDb(),
): Promise<ShiftOverride | undefined> {
  const rows = await ex
    .select()
    .from(shiftOverrides)
    .where(
      and(
        eq(shiftOverrides.process, process as ShiftOverride["process"]),
        eq(shiftOverrides.operationalDate, operationalDate),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ShiftOverrideListRow extends ShiftOverride {
  createdByName: string | null;
}

export async function listShiftOverrides(
  f: { process?: string | undefined; from?: string | undefined; to?: string | undefined } = {},
  ex: DBX = getDb(),
): Promise<ShiftOverrideListRow[]> {
  const conds: SQL[] = [];
  if (f.process) conds.push(eq(shiftOverrides.process, f.process as ShiftOverride["process"]));
  if (f.from) conds.push(gte(shiftOverrides.operationalDate, f.from));
  if (f.to) conds.push(lte(shiftOverrides.operationalDate, f.to));
  const rows = await ex
    .select({ row: shiftOverrides, createdByName: users.fullName })
    .from(shiftOverrides)
    .leftJoin(users, eq(users.id, shiftOverrides.createdByUserId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(shiftOverrides.operationalDate), asc(shiftOverrides.process))
    .limit(1000);
  return rows.map((r) => ({ ...r.row, createdByName: r.createdByName ?? null }));
}

/** Insert or replace the row for (process, operational_date). */
export async function upsertShiftOverride(v: NewShiftOverride, ex: DBX = getDb()): Promise<void> {
  const existing = await getShiftOverride(v.process, v.operationalDate, ex);
  if (existing) {
    await ex
      .update(shiftOverrides)
      .set({
        startHhmm: v.startHhmm,
        endHhmm: v.endHhmm,
        reportingHhmm: v.reportingHhmm ?? null,
        shortLateFromHhmm: v.shortLateFromHhmm ?? null,
        lateFromHhmm: v.lateFromHhmm ?? null,
        reason: v.reason ?? null,
        updatedByUserId: v.updatedByUserId ?? null,
        updatedAt: v.updatedAt,
      })
      .where(eq(shiftOverrides.id, existing.id));
    return;
  }
  await ex.insert(shiftOverrides).values(v);
}

export async function deleteShiftOverride(
  process: string,
  operationalDate: string,
  ex: DBX = getDb(),
): Promise<boolean> {
  const existing = await getShiftOverride(process, operationalDate, ex);
  if (!existing) return false;
  await ex.delete(shiftOverrides).where(eq(shiftOverrides.id, existing.id));
  return true;
}
