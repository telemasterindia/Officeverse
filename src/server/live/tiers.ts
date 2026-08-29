/**
 * Officeverse — Live Experience: celebration tiers (Phase 21).
 *
 * Tiers are PRESENTATION intensity only. They carry NO monetary meaning.
 * A tier never creates payroll, salary, commission, incentive or bonus data.
 *
 *   TIER 1  small   — brief acknowledgement (LEAD_SUBMITTED, ACHIEVEMENT)
 *   TIER 2  medium  — confetti / victory (LEAD_ACCEPTED)
 *   TIER 3  heavy   — fireworks + money visual + glitter (THIRD_ACCEPTED_LEAD,
 *                     TEAM_MILESTONE) — "money visual" is a VISUAL EFFECT ONLY
 *   TIER 4  premium — highest tier (SALE, EMERGENCY_ADMIN)
 */
import type { RecognitionKind } from "./priority";

export const CELEBRATION_TIERS = [1, 2, 3, 4] as const;
export type CelebrationTier = (typeof CELEBRATION_TIERS)[number];

/** Data-driven default; a future approved config may override per deployment. */
export const DEFAULT_EVENT_TIER: Record<RecognitionKind, CelebrationTier> = {
  EMERGENCY_ADMIN: 4,
  SALE: 4,
  TEAM_MILESTONE: 3,
  THIRD_ACCEPTED_LEAD: 3,
  LEAD_ACCEPTED: 2,
  ANNOUNCEMENT: 2,
  LEAD_SUBMITTED: 1,
  ACHIEVEMENT_UNLOCKED: 1,
};

export function tierForKind(kind: RecognitionKind): CelebrationTier {
  return DEFAULT_EVENT_TIER[kind] ?? 1;
}

/** Suggested asset category per tier (the orchestrator may randomise within). */
export const TIER_ASSET_CATEGORIES: Record<CelebrationTier, string[]> = {
  1: ["ENERGY", "CONFETTI"],
  2: ["CONFETTI", "VICTORY", "PARTY"],
  3: ["FIREWORKS", "GOLD", "MONEY", "CHAMPION"],
  4: ["CHAMPION", "FIREWORKS", "GOLD", "VICTORY"],
};

/** Base display duration by tier (ms) — clamped again by TV settings. */
export const TIER_DURATION_MS: Record<CelebrationTier, number> = {
  1: 4000,
  2: 6000,
  3: 9000,
  4: 11000,
};
