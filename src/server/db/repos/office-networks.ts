/**
 * Officeverse — office-network repository (Phase 23). DATA ACCESS ONLY.
 */
import { asc, eq } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import { officeNetworks, type NewOfficeNetwork, type OfficeNetwork } from "@/lib/db/schema";

export async function listNetworks(ex: DBX = getDb()): Promise<OfficeNetwork[]> {
  return ex.select().from(officeNetworks).orderBy(asc(officeNetworks.id));
}

/** Active rows only — the set the login IP gate matches against. */
export async function listActiveNetworks(ex: DBX = getDb()): Promise<OfficeNetwork[]> {
  return ex.select().from(officeNetworks).where(eq(officeNetworks.enabled, true));
}

export async function getNetwork(
  id: number,
  ex: DBX = getDb(),
): Promise<OfficeNetwork | undefined> {
  const rows = await ex.select().from(officeNetworks).where(eq(officeNetworks.id, id)).limit(1);
  return rows[0];
}

export async function insertNetwork(
  v: NewOfficeNetwork,
  ex: DBX = getDb(),
): Promise<{ id: number }> {
  const res = await ex.insert(officeNetworks).values(v);
  return { id: Number((res as unknown as { insertId?: number }).insertId ?? 0) };
}

export async function updateNetwork(
  id: number,
  patch: Partial<NewOfficeNetwork>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(officeNetworks).set(patch).where(eq(officeNetworks.id, id));
}

export async function deleteNetwork(id: number, ex: DBX = getDb()): Promise<void> {
  await ex.delete(officeNetworks).where(eq(officeNetworks.id, id));
}

/** Count of OTHER active networks that would still serve `process` if `exceptId`
 *  were disabled/removed. A null-process ("all") active row counts for every
 *  process. Used for the lock-out impact warning. */
export async function countOtherActiveForProcess(
  process: string | null,
  exceptId: number,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex.select().from(officeNetworks).where(eq(officeNetworks.enabled, true));
  return rows.filter(
    (r) => r.id !== exceptId && (r.process == null || process == null || r.process === process),
  ).length;
}

export async function anyActive(ex: DBX = getDb()): Promise<boolean> {
  const rows = await ex
    .select({ id: officeNetworks.id })
    .from(officeNetworks)
    .where(eq(officeNetworks.enabled, true))
    .limit(1);
  return rows.length > 0;
}
