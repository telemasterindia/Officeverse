/**
 * Officeverse — CELEBRATION DECISION contract (Phase 5). PURE. No DB, no I/O,
 * no imports from `events/*`, `scoring/*`, `hr/*` or `payroll/*`.
 *
 * Recognition decides *whether* an achievement is celebrated and *what kind* of
 * celebration should eventually be shown — a SEMANTIC level, never a visual
 * design. The future Office TV renderer consumes this contract; nothing here
 * renders anything.
 *
 *   Scoring        → "how many points did the employee earn?"   (points ledger)
 *   Recognition    → "should this be recognised, and how big?"  (this file)
 *
 * Levels are semantic intensity only. They carry NO monetary meaning and never
 * create payroll / salary / incentive data.
 *
 *   LEVEL_0  no visible celebration
 *   LEVEL_1  normal recognition
 *   LEVEL_2  major recognition
 *   LEVEL_3  major achievement
 *   LEVEL_4  hero / milestone
 */

export const CELEBRATION_LEVELS = ["LEVEL_0", "LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"] as const;
export type CelebrationLevel = (typeof CELEBRATION_LEVELS)[number];

export function isCelebrationLevel(v: unknown): v is CelebrationLevel {
  return typeof v === "string" && (CELEBRATION_LEVELS as readonly string[]).includes(v);
}

/** Named presentation profile the renderer keys off (NOT a visual spec). */
export type CelebrationProfileName = "silent" | "standard" | "major" | "epic" | "hero";

export interface CelebrationProfile {
  level: CelebrationLevel;
  profile: CelebrationProfileName;
  /** display name of the recognised employee (null for team-wide moments) */
  employeeName: string | null;
  /** opaque reference into the EXISTING photo system (users.photo_asset_id) —
   *  never the image bytes; the renderer fetches via the profile-photo API */
  employeePhotoRef: string | null;
  /** short line, e.g. "LEAD SUBMITTED" — never a currency amount */
  headline: string | null;
  /** optional secondary line, e.g. the matched scoring rule name */
  subheadline: string | null;
  /** abstract points for THIS recognition (0 when the event is not score-bearing) */
  points: number;
  /** renderer hints — semantic tokens, not asset ids */
  soundProfile: string;
  particleProfile: string;
  /** suggested on-screen duration (ms); the TV settings still clamp it */
  durationMs: number;
}

/* ------------------------------------------------------------------ *
 *  TEMPORARY INTERNAL DEFAULT — recognition-kind → celebration level  *
 *  Isolated here on purpose. It is NOT wired to point thresholds and  *
 *  NOT part of business scoring. A later phase replaces this with an  *
 *  Admin-authored / product-approved mapping.                        *
 * ------------------------------------------------------------------ */
const DEFAULT_KIND_LEVEL: Readonly<Record<string, CelebrationLevel>> = {
  LEAD_SUBMITTED: "LEVEL_1",
  ACHIEVEMENT_UNLOCKED: "LEVEL_1",
  LEAD_ACCEPTED: "LEVEL_2",
  ANNOUNCEMENT: "LEVEL_2",
  THIRD_ACCEPTED_LEAD: "LEVEL_3",
  TEAM_MILESTONE: "LEVEL_3",
  SALE: "LEVEL_4",
  EMERGENCY_ADMIN: "LEVEL_4",
};

interface LevelPreset {
  profile: CelebrationProfileName;
  soundProfile: string;
  particleProfile: string;
  durationMs: number;
}

const LEVEL_PRESET: Readonly<Record<CelebrationLevel, LevelPreset>> = {
  LEVEL_0: { profile: "silent", soundProfile: "none", particleProfile: "none", durationMs: 0 },
  LEVEL_1: {
    profile: "standard",
    soundProfile: "chime",
    particleProfile: "confetti-light",
    durationMs: 4000,
  },
  LEVEL_2: {
    profile: "major",
    soundProfile: "cheer",
    // Phase 7 — LEAD_ACCEPTED is a higher-value moment: dollar rain is the
    // primary Level-2 particle effect (the renderer layers confetti on top).
    particleProfile: "dollar-rain",
    durationMs: 6000,
  },
  LEVEL_3: {
    profile: "epic",
    soundProfile: "fanfare",
    particleProfile: "fireworks",
    durationMs: 9000,
  },
  LEVEL_4: {
    profile: "hero",
    soundProfile: "anthem",
    particleProfile: "hero-burst",
    durationMs: 11000,
  },
};

export interface CelebrationDecisionInput {
  /** the approved recognition KIND (from the event registry), or any string */
  recognitionKind: string;
  employeeName?: string | null;
  employeePhotoRef?: string | null;
  /** abstract points the Scoring Engine awarded for this event, or null when
   *  scoring did not run / has no rule (Recognition still functions) */
  points?: number | null;
  /** matched scoring rule name, if any — surfaced as the subheadline */
  scoredRuleName?: string | null;
  headline?: string | null;
  /** hard override — force a specific level regardless of the default map */
  levelOverride?: CelebrationLevel | null;
}

/**
 * Decide the celebration for one recognised achievement. Total — never throws.
 * An unknown recognition kind → LEVEL_0 (no visible celebration). An invalid
 * `levelOverride` is ignored.
 */
export function decideCelebration(input: CelebrationDecisionInput): CelebrationProfile {
  const level: CelebrationLevel = isCelebrationLevel(input.levelOverride)
    ? input.levelOverride
    : (DEFAULT_KIND_LEVEL[input.recognitionKind] ?? "LEVEL_0");

  const preset = LEVEL_PRESET[level];
  const rawPoints = input.points;
  const points =
    typeof rawPoints === "number" && Number.isFinite(rawPoints) ? Math.trunc(rawPoints) : 0;

  return {
    level,
    profile: preset.profile,
    employeeName: input.employeeName ?? null,
    employeePhotoRef: input.employeePhotoRef ?? null,
    headline: input.headline ?? null,
    subheadline: input.scoredRuleName ?? null,
    points,
    soundProfile: preset.soundProfile,
    particleProfile: preset.particleProfile,
    durationMs: preset.durationMs,
  };
}
