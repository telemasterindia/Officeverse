/**
 * Officeverse — Live Experience: deterministic event priority (Phase 21).
 *
 * The Office TV never shows two things at once and never orders events
 * randomly. This is the single ordering authority. If real business
 * requirements change the order, change the DEFAULT_PRIORITY map (data-driven),
 * never the comparison logic.
 */

export const RECOGNITION_KINDS = [
  "EMERGENCY_ADMIN",
  "SALE",
  "TEAM_MILESTONE",
  "THIRD_ACCEPTED_LEAD",
  "LEAD_ACCEPTED",
  "LEAD_SUBMITTED",
  "ACHIEVEMENT_UNLOCKED",
  "ANNOUNCEMENT",
] as const;
export type RecognitionKind = (typeof RECOGNITION_KINDS)[number];

/** Lower number = shown first. */
export const DEFAULT_PRIORITY: Record<RecognitionKind, number> = {
  EMERGENCY_ADMIN: 0,
  SALE: 10,
  TEAM_MILESTONE: 20,
  THIRD_ACCEPTED_LEAD: 30,
  LEAD_ACCEPTED: 40,
  LEAD_SUBMITTED: 50,
  ACHIEVEMENT_UNLOCKED: 60,
  ANNOUNCEMENT: 45, // a NORMAL announcement sits between accepted & submitted
};

/**
 * Admin announcement priority overrides its base weight.
 *   URGENT (15)    — sits between SALE (10) and TEAM_MILESTONE (20): it may
 *                    interrupt a normal celebration and a team milestone, but a
 *                    confirmed SALE (and EMERGENCY_ADMIN) still wins.
 *   IMPORTANT (25) — above THIRD_ACCEPTED_LEAD, below TEAM_MILESTONE.
 *   NORMAL (45)    — below every business recognition; it waits its turn.
 */
export const ANNOUNCEMENT_PRIORITY_WEIGHT: Record<"NORMAL" | "IMPORTANT" | "URGENT", number> = {
  URGENT: 15,
  IMPORTANT: 25,
  NORMAL: 45,
};

export function priorityOf(kind: RecognitionKind, announcementPriority?: string): number {
  if (kind === "ANNOUNCEMENT" && announcementPriority) {
    const w =
      ANNOUNCEMENT_PRIORITY_WEIGHT[announcementPriority as "NORMAL" | "IMPORTANT" | "URGENT"];
    if (typeof w === "number") return w;
  }
  return DEFAULT_PRIORITY[kind] ?? 100;
}

export interface PriorityKeyed {
  kind: RecognitionKind;
  /** monotonic enqueue sequence — the FIFO tie-break within one priority */
  seq: number;
  announcementPriority?: string | undefined;
}

/** Sort comparator: priority asc, then enqueue order asc. Never random. */
export function comparePriority(a: PriorityKeyed, b: PriorityKeyed): number {
  const pa = priorityOf(a.kind, a.announcementPriority);
  const pb = priorityOf(b.kind, b.announcementPriority);
  return pa - pb || a.seq - b.seq;
}
