/**
 * Officeverse — RECENT RECOGNITION feed helpers (Phase 10 Stage 3). PURE.
 *
 * The Office TV "Recent Achievement" screen reads the EXISTING `office_tv_events`
 * recognition log (kind / tier / timestamp / subject). This module turns a raw
 * `kind` into a human label + headline and maps the presentation `tier` to the
 * semantic recognition LEVEL. No DB, no scoring, no points math — points are
 * looked up from the authoritative ledger by the caller and passed through.
 */

const KIND_LABEL: Readonly<Record<string, string>> = {
  LEAD_SUBMITTED: "Lead submitted",
  LEAD_ACCEPTED: "Lead accepted",
  THIRD_ACCEPTED_LEAD: "On fire",
  SALE: "Sale",
  ACHIEVEMENT_UNLOCKED: "Achievement",
  TEAM_MILESTONE: "Team milestone",
  ANNOUNCEMENT: "Announcement",
  CELEBRATION_TEST: "Celebration test",
  CELEBRATION_PROFILE_PLAY: "Celebration",
};
const KIND_HEADLINE: Readonly<Record<string, string>> = {
  LEAD_SUBMITTED: "LEAD SUBMITTED",
  LEAD_ACCEPTED: "LEAD ACCEPTED",
  THIRD_ACCEPTED_LEAD: "ON FIRE",
  SALE: "SALE",
  ACHIEVEMENT_UNLOCKED: "ACHIEVEMENT UNLOCKED",
  TEAM_MILESTONE: "TEAM MILESTONE",
};

export function recognitionEventLabel(kind: string): string {
  return (
    KIND_LABEL[kind] ??
    kind
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

export function recognitionHeadline(kind: string, message?: string | null): string {
  return KIND_HEADLINE[kind] ?? (message?.trim() || recognitionEventLabel(kind).toUpperCase());
}

/** presentation tier 1..4 → semantic recognition level; anything else → null */
export function levelForTier(tier: number | null | undefined): string | null {
  const t = Math.trunc(Number(tier));
  return t >= 1 && t <= 4 ? `LEVEL_${t}` : null;
}

/** stable key for a points-by-reference lookup */
export function referenceKey(userId: number, refType: string | null, refId: string | null): string {
  return `${userId}:${refType ?? ""}:${refId ?? ""}`;
}

export interface RawRecognitionRow {
  id: number;
  kind: string;
  subjectUserId: number | null;
  message: string | null;
  tier: number;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

export interface RecentRecognitionItem {
  id: number;
  kind: string;
  eventLabel: string;
  headline: string;
  level: string | null;
  points: number | null;
  subjectUserId: number | null;
  name: string | null;
  photo: string | null;
  createdAt: string;
}

/**
 * Build the enriched feed. `names` / `photos` / `points` are resolved by the
 * caller from authoritative sources (users table, the token-authed photo path,
 * the points ledger). Rows without a subject still render (team milestones).
 */
export function buildRecentRecognitionFeed(
  rows: RawRecognitionRow[],
  lookups: {
    names: Record<number, string | null>;
    photos: Record<number, string | null>;
    points: Record<string, number>;
  },
  limit = 8,
): RecentRecognitionItem[] {
  return rows.slice(0, limit).map((r) => {
    const key =
      r.subjectUserId != null ? referenceKey(r.subjectUserId, r.referenceType, r.referenceId) : "";
    const pts = key && key in lookups.points ? lookups.points[key]! : null;
    return {
      id: r.id,
      kind: r.kind,
      eventLabel: recognitionEventLabel(r.kind),
      headline: recognitionHeadline(r.kind, r.message),
      level: levelForTier(r.tier),
      points: typeof pts === "number" && pts > 0 ? pts : null,
      subjectUserId: r.subjectUserId ?? null,
      name: r.subjectUserId != null ? (lookups.names[r.subjectUserId] ?? null) : null,
      photo: r.subjectUserId != null ? (lookups.photos[r.subjectUserId] ?? null) : null,
      createdAt: r.createdAt,
    };
  });
}
