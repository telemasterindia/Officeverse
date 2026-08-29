/**
 * Officeverse — gamification ACHIEVEMENTS foundation (Phase 20). PURE.
 *
 * Data-driven registry. Each achievement carries machine `criteria`; the
 * evaluator reads the THRESHOLD from the criteria — no threshold is hard-coded
 * in logic. The seed rows below are placeholders an Admin tunes; a threshold of
 * 0 (or `enabled:false`) effectively parks an achievement until configured.
 *
 * Awarded once per (user, code) unless `repeatable` (none are in Phase 20).
 * Earned history is append-only — never deleted.
 */

export type AchievementCriteria =
  | { kind: "COUNT"; event: "LEAD_ACCEPTED" | "SALE" | "LEAD_SUBMITTED"; threshold: number }
  | { kind: "STREAK"; streakType: "ACCEPTED_LEAD_STREAK"; threshold: number }
  | { kind: "MANUAL" };

export interface AchievementDef {
  code: string;
  name: string;
  description: string;
  badge: string;
  category: "milestone" | "streak" | "quality" | "team" | "general";
  criteria: AchievementCriteria;
  repeatable: boolean;
  enabled: boolean;
}

/** Seed set. Thresholds are CONFIGURABLE placeholders (an Admin edits the rows). */
export const DEFAULT_ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    code: "FIRST_ACCEPTED_LEAD",
    name: "First Accepted Lead",
    description: "Your first lead accepted by a closer.",
    badge: "✓",
    category: "milestone",
    criteria: { kind: "COUNT", event: "LEAD_ACCEPTED", threshold: 1 },
    repeatable: false,
    enabled: true,
  },
  {
    code: "FIRST_SALE",
    name: "First Sale",
    description: "Your first closed sale.",
    badge: "◆",
    category: "milestone",
    criteria: { kind: "COUNT", event: "SALE", threshold: 1 },
    repeatable: false,
    enabled: true,
  },
  {
    code: "MILESTONE_ACCEPTED_LEADS",
    name: "Accepted-Lead Milestone",
    description: "Reach the configured number of accepted leads.",
    badge: "★",
    category: "milestone",
    // threshold 0 → parked until an Admin sets a real number
    criteria: { kind: "COUNT", event: "LEAD_ACCEPTED", threshold: 0 },
    repeatable: false,
    enabled: true,
  },
  {
    code: "ACCEPTED_LEAD_STREAK",
    name: "Accepted-Lead Streak",
    description: "Consecutive operational days with an accepted lead.",
    badge: "⚡",
    category: "streak",
    criteria: { kind: "STREAK", streakType: "ACCEPTED_LEAD_STREAK", threshold: 0 },
    repeatable: false,
    enabled: true,
  },
] as const;

export interface AchievementRowLike {
  code: string;
  criteria: unknown;
  repeatable: boolean;
  enabled: boolean;
}

export interface AchievementSignals {
  acceptedLeadCount: number;
  salesCount: number;
  submittedLeadCount: number;
  acceptedLeadStreak: number;
  /** codes the user has already earned (non-repeatable → skip) */
  alreadyEarned: ReadonlySet<string>;
}

function readCriteria(raw: unknown): AchievementCriteria | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (
    c["kind"] === "COUNT" &&
    typeof c["threshold"] === "number" &&
    typeof c["event"] === "string"
  ) {
    return { kind: "COUNT", event: c["event"] as never, threshold: c["threshold"] };
  }
  if (c["kind"] === "STREAK" && typeof c["threshold"] === "number") {
    return {
      kind: "STREAK",
      streakType: (c["streakType"] as never) ?? "ACCEPTED_LEAD_STREAK",
      threshold: c["threshold"],
    };
  }
  if (c["kind"] === "MANUAL") return { kind: "MANUAL" };
  return null;
}

function satisfied(c: AchievementCriteria, s: AchievementSignals): boolean {
  if (c.kind === "MANUAL") return false; // MANUAL is awarded explicitly, never auto
  if (c.threshold <= 0) return false; // parked until configured
  if (c.kind === "STREAK") return s.acceptedLeadStreak >= c.threshold;
  if (c.event === "LEAD_ACCEPTED") return s.acceptedLeadCount >= c.threshold;
  if (c.event === "SALE") return s.salesCount >= c.threshold;
  if (c.event === "LEAD_SUBMITTED") return s.submittedLeadCount >= c.threshold;
  return false;
}

/**
 * Given the registry rows + the user's current signals, return the codes that
 * are newly earned (enabled, criteria met, not already held). Deterministic and
 * side-effect free — the service persists + dedupes on the unique
 * (user, code) index.
 */
export function evaluateAchievements(
  registry: AchievementRowLike[],
  signals: AchievementSignals,
): string[] {
  const out: string[] = [];
  for (const row of registry) {
    if (!row.enabled) continue;
    if (!row.repeatable && signals.alreadyEarned.has(row.code)) continue;
    const c = readCriteria(row.criteria);
    if (c && satisfied(c, signals)) out.push(row.code);
  }
  return out;
}
