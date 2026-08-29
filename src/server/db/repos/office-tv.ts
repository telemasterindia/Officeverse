/**
 * Officeverse — Office TV / Live Experience repositories (Phase 21).
 * DATA ACCESS ONLY. Read-heavy; the TV surface never writes through here.
 * Nothing in this module is read by HR / payroll code.
 */
import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  celebrationAssets,
  officeTvAnnouncements,
  officeTvDisplays,
  officeTvEvents,
  officeTvSettings,
  type CelebrationAsset,
  type NewCelebrationAsset,
  type NewOfficeTvAnnouncement,
  type NewOfficeTvDisplay,
  type NewOfficeTvEvent,
  type OfficeTvAnnouncement,
  type OfficeTvDisplay,
  type OfficeTvEvent,
  type OfficeTvSettings,
} from "@/lib/db/schema";

/* ----------------------------- displays ----------------------------- */

export async function insertDisplay(
  v: NewOfficeTvDisplay,
  ex: DBX = getDb(),
): Promise<{ id: number }> {
  const res = await ex.insert(officeTvDisplays).values(v);
  return { id: Number((res as unknown as { insertId?: number }).insertId ?? 0) };
}

export async function listDisplays(ex: DBX = getDb()): Promise<OfficeTvDisplay[]> {
  return ex.select().from(officeTvDisplays).orderBy(desc(officeTvDisplays.id));
}

export async function findDisplayByHash(
  tokenHash: string,
  ex: DBX = getDb(),
): Promise<OfficeTvDisplay | undefined> {
  const rows = await ex
    .select()
    .from(officeTvDisplays)
    .where(eq(officeTvDisplays.tokenHash, tokenHash))
    .limit(1);
  return rows[0];
}

export async function getDisplay(
  id: number,
  ex: DBX = getDb(),
): Promise<OfficeTvDisplay | undefined> {
  const rows = await ex.select().from(officeTvDisplays).where(eq(officeTvDisplays.id, id)).limit(1);
  return rows[0];
}

export async function touchDisplaySeen(
  id: number,
  nowWall: string,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(officeTvDisplays).set({ lastSeenAt: nowWall }).where(eq(officeTvDisplays.id, id));
}

export async function updateDisplay(
  id: number,
  patch: Partial<NewOfficeTvDisplay>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(officeTvDisplays).set(patch).where(eq(officeTvDisplays.id, id));
}

/* ----------------------------- settings ---------------------------- */

export async function getTvSettings(ex: DBX = getDb()): Promise<OfficeTvSettings | undefined> {
  const rows = await ex.select().from(officeTvSettings).where(eq(officeTvSettings.id, 1)).limit(1);
  return rows[0];
}

export async function upsertTvSettings(
  patch: Partial<Omit<OfficeTvSettings, "id">>,
  ex: DBX = getDb(),
): Promise<void> {
  const existing = await getTvSettings(ex);
  if (existing) {
    await ex.update(officeTvSettings).set(patch).where(eq(officeTvSettings.id, 1));
  } else {
    await ex.insert(officeTvSettings).values({ id: 1, ...patch });
  }
}

/* ------------------------------ assets ---------------------------- */

export async function listAssets(ex: DBX = getDb()): Promise<CelebrationAsset[]> {
  return ex.select().from(celebrationAssets).orderBy(desc(celebrationAssets.id));
}

export async function listEnabledAssets(ex: DBX = getDb()): Promise<CelebrationAsset[]> {
  return ex.select().from(celebrationAssets).where(eq(celebrationAssets.enabled, true));
}

export async function getAsset(
  id: number,
  ex: DBX = getDb(),
): Promise<CelebrationAsset | undefined> {
  const rows = await ex
    .select()
    .from(celebrationAssets)
    .where(eq(celebrationAssets.id, id))
    .limit(1);
  return rows[0];
}

export async function insertAsset(
  v: NewCelebrationAsset,
  ex: DBX = getDb(),
): Promise<{ id: number }> {
  const res = await ex.insert(celebrationAssets).values(v);
  return { id: Number((res as unknown as { insertId?: number }).insertId ?? 0) };
}

export async function updateAsset(
  id: number,
  patch: Partial<NewCelebrationAsset>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(celebrationAssets).set(patch).where(eq(celebrationAssets.id, id));
}

export async function deleteAsset(id: number, ex: DBX = getDb()): Promise<void> {
  await ex.delete(celebrationAssets).where(eq(celebrationAssets.id, id));
}

export async function countAssetsInCategory(category: string, ex: DBX = getDb()): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`count(*)` })
    .from(celebrationAssets)
    .where(eq(celebrationAssets.category, category));
  return Number(rows[0]?.n ?? 0);
}

/* --------------------------- announcements ------------------------ */

export async function insertAnnouncement(
  v: NewOfficeTvAnnouncement,
  ex: DBX = getDb(),
): Promise<{ id: number }> {
  const res = await ex.insert(officeTvAnnouncements).values(v);
  return { id: Number((res as unknown as { insertId?: number }).insertId ?? 0) };
}

export async function listAnnouncements(
  limit = 50,
  ex: DBX = getDb(),
): Promise<OfficeTvAnnouncement[]> {
  return ex
    .select()
    .from(officeTvAnnouncements)
    .orderBy(desc(officeTvAnnouncements.id))
    .limit(Math.min(200, Math.max(1, limit)));
}

export async function getAnnouncement(
  id: number,
  ex: DBX = getDb(),
): Promise<OfficeTvAnnouncement | undefined> {
  const rows = await ex
    .select()
    .from(officeTvAnnouncements)
    .where(eq(officeTvAnnouncements.id, id))
    .limit(1);
  return rows[0];
}

export async function updateAnnouncement(
  id: number,
  patch: Partial<NewOfficeTvAnnouncement>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(officeTvAnnouncements).set(patch).where(eq(officeTvAnnouncements.id, id));
}

/** enabled rows still in a live-eligible status (scheduled / published). */
export async function liveAnnouncements(ex: DBX = getDb()): Promise<OfficeTvAnnouncement[]> {
  return ex
    .select()
    .from(officeTvAnnouncements)
    .where(
      and(
        eq(officeTvAnnouncements.enabled, true),
        inArray(officeTvAnnouncements.status, ["scheduled", "published"]),
      ),
    )
    .orderBy(desc(officeTvAnnouncements.id))
    .limit(100);
}

export async function markAnnouncementsExpired(ids: number[], ex: DBX = getDb()): Promise<void> {
  if (ids.length === 0) return;
  await ex
    .update(officeTvAnnouncements)
    .set({ status: "expired" })
    .where(inArray(officeTvAnnouncements.id, ids));
}

/* ------------------------------ events ---------------------------- */

/** Award-once: relies on the unique dedupe_key index. Never throws on dup. */
export async function insertTvEvent(
  v: NewOfficeTvEvent,
  ex: DBX = getDb(),
): Promise<{ id: number; created: boolean }> {
  const existing = await ex
    .select({ id: officeTvEvents.id })
    .from(officeTvEvents)
    .where(eq(officeTvEvents.dedupeKey, v.dedupeKey))
    .limit(1);
  if (existing[0]) return { id: existing[0].id, created: false };
  try {
    const res = await ex.insert(officeTvEvents).values(v);
    return { id: Number((res as unknown as { insertId?: number }).insertId ?? 0), created: true };
  } catch {
    const row = await ex
      .select({ id: officeTvEvents.id })
      .from(officeTvEvents)
      .where(eq(officeTvEvents.dedupeKey, v.dedupeKey))
      .limit(1);
    return { id: row[0]?.id ?? 0, created: false };
  }
}

/** Count recognition rows for one subject on an operational date, by kind. */
export async function countSubjectEventsForDate(
  subjectUserId: number,
  kinds: string[],
  operationalDate: string,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`count(*)` })
    .from(officeTvEvents)
    .where(
      and(
        eq(officeTvEvents.subjectUserId, subjectUserId),
        eq(officeTvEvents.operationalDate, operationalDate),
        inArray(officeTvEvents.kind, kinds),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

/** Count recognition rows for the whole team on an operational date, by kind. */
export async function countEventsForDate(
  kinds: string[],
  operationalDate: string,
  ex: DBX = getDb(),
): Promise<number> {
  const rows = await ex
    .select({ n: sql<number>`count(*)` })
    .from(officeTvEvents)
    .where(
      and(eq(officeTvEvents.operationalDate, operationalDate), inArray(officeTvEvents.kind, kinds)),
    );
  return Number(rows[0]?.n ?? 0);
}

export async function listEventsForDate(
  operationalDate: string,
  limit = 30,
  ex: DBX = getDb(),
): Promise<OfficeTvEvent[]> {
  return ex
    .select()
    .from(officeTvEvents)
    .where(eq(officeTvEvents.operationalDate, operationalDate))
    .orderBy(desc(officeTvEvents.id))
    .limit(Math.min(100, Math.max(1, limit)));
}

export interface KindCount {
  kind: string;
  n: number;
}

export async function countEventsByKindSince(
  fromOperationalDate: string,
  ex: DBX = getDb(),
): Promise<KindCount[]> {
  const conds: SQL[] = [gte(officeTvEvents.operationalDate, fromOperationalDate)];
  const rows = await ex
    .select({ kind: officeTvEvents.kind, n: sql<number>`count(*)` })
    .from(officeTvEvents)
    .where(and(...conds))
    .groupBy(officeTvEvents.kind);
  return rows.map((r) => ({ kind: r.kind, n: Number(r.n) }));
}
