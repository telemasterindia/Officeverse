/**
 * Officeverse — Live Experience: active-announcement selection (Phase 21).
 *
 * PURE. Given the announcement rows and the SERVER wall-clock epoch, decide
 * which single announcement the TV should currently show. Scheduling uses
 * server-authoritative time — never the TV's browser clock.
 *
 *   - must be enabled and status "published" or "scheduled"
 *   - publishAt (if set) must be <= now; if null it is active as soon as
 *     published
 *   - expiresAt (if set) must be > now
 *   - among candidates, the highest priority wins (URGENT > IMPORTANT >
 *     NORMAL); ties broken by the most recent publishAt/created, then id
 */

export interface AnnouncementRowLike {
  id: number;
  status: string;
  enabled: boolean;
  priority: string; // NORMAL | IMPORTANT | URGENT
  /** epoch ms (already converted from IST wall-clock by the caller), or null */
  publishAtMs: number | null;
  expiresAtMs: number | null;
  publishedAtMs: number | null;
  createdAtMs: number;
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 3, IMPORTANT: 2, NORMAL: 1 };

export function isAnnouncementActive(a: AnnouncementRowLike, nowMs: number): boolean {
  if (!a.enabled) return false;
  if (a.status !== "published" && a.status !== "scheduled") return false;
  if (a.status === "scheduled" && a.publishAtMs == null) return false; // needs a time
  const startMs = a.publishAtMs ?? a.publishedAtMs ?? a.createdAtMs;
  if (startMs > nowMs) return false;
  if (a.expiresAtMs != null && a.expiresAtMs <= nowMs) return false;
  return true;
}

export function pickActiveAnnouncement<T extends AnnouncementRowLike>(
  rows: T[],
  nowMs: number,
): T | null {
  const live = rows.filter((r) => isAnnouncementActive(r, nowMs));
  if (live.length === 0) return null;
  live.sort((a, b) => {
    const pr = (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0);
    if (pr !== 0) return pr;
    const sa = a.publishAtMs ?? a.publishedAtMs ?? a.createdAtMs;
    const sb = b.publishAtMs ?? b.publishedAtMs ?? b.createdAtMs;
    return sb - sa || b.id - a.id;
  });
  return live[0] ?? null;
}

/** Rows whose expiry has passed — the caller flips these to status "expired". */
export function expiredAnnouncementIds(rows: AnnouncementRowLike[], nowMs: number): number[] {
  return rows
    .filter(
      (r) =>
        r.enabled &&
        (r.status === "published" || r.status === "scheduled") &&
        r.expiresAtMs != null &&
        r.expiresAtMs <= nowMs,
    )
    .map((r) => r.id);
}
