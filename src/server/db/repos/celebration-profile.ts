/**
 * Officeverse — CELEBRATION PROFILE repository (Phase 10). DATA ACCESS ONLY.
 *
 * One mutable row per profile (no immutable version snapshots — a profile is
 * presentation config, not a money entitlement). Nothing here scores, awards
 * points, or reads payroll / incentive tables.
 */
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  celebrationProfiles,
  type CelebrationProfileRow,
  type NewCelebrationProfileRow,
} from "@/lib/db/schema";

export async function insertProfile(
  v: NewCelebrationProfileRow,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex.insert(celebrationProfiles).values(v).$returningId();
  return Number(rows[0]?.id ?? 0);
}

export async function updateProfile(
  id: number,
  patch: Partial<
    Pick<
      NewCelebrationProfileRow,
      | "name"
      | "description"
      | "enabled"
      | "recognitionLevel"
      | "triggerEvent"
      | "priority"
      | "config"
      | "updatedAt"
    >
  >,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(celebrationProfiles).set(patch).where(eq(celebrationProfiles.id, id));
}

export async function getProfile(
  id: number,
  ex: DBX = getDb(),
): Promise<CelebrationProfileRow | undefined> {
  const rows = await ex
    .select()
    .from(celebrationProfiles)
    .where(eq(celebrationProfiles.id, id))
    .limit(1);
  return rows[0];
}

export async function listProfiles(ex: DBX = getDb()): Promise<CelebrationProfileRow[]> {
  return ex
    .select()
    .from(celebrationProfiles)
    .orderBy(asc(celebrationProfiles.priority), asc(celebrationProfiles.id));
}

/** Enabled profiles bound to `trigger` (or unbound), by priority then id. */
export async function listEnabledProfilesForTrigger(
  trigger: string,
  ex: DBX = getDb(),
): Promise<CelebrationProfileRow[]> {
  return ex
    .select()
    .from(celebrationProfiles)
    .where(
      and(
        eq(celebrationProfiles.enabled, true),
        or(
          eq(celebrationProfiles.triggerEvent, trigger as never),
          isNull(celebrationProfiles.triggerEvent),
        ),
      ),
    )
    .orderBy(asc(celebrationProfiles.priority), asc(celebrationProfiles.id));
}
