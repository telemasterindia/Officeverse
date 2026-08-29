/**
 * Officeverse — Live Experience: celebration orchestrator (Phase 21).
 *
 * ONE place decides whether an event celebrates, at what tier, with which
 * asset/effect, for how long, and at what priority. Celebration logic is not
 * scattered across CRM components.
 *
 * PURE: given the confirmed event + config + the enabled asset library, it
 * returns a fully-resolved CelebrationPayload. No DB, no I/O, no randomness
 * beyond the seeded pick in assets.ts.
 *
 * FOLLOW-UP NEVER CELEBRATES. There is no follow-up branch here and
 * `shouldCelebrate` rejects any kind that is not an approved recognition kind.
 */
import { pickAsset, type AssetLike } from "./assets";
import { priorityOf, type RecognitionKind } from "./priority";
import {
  TIER_ASSET_CATEGORIES,
  TIER_DURATION_MS,
  tierForKind,
  type CelebrationTier,
} from "./tiers";

export interface OrchestratorConfig {
  /** hard on/off for all celebrations (Admin) */
  celebrationsEnabled: boolean;
  /** "low" | "normal" | "high" — scales duration only */
  intensity: "low" | "normal" | "high";
  /** clamp for any single celebration (ms) — from office_tv_settings.rotationSec */
  maxDurationMs: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  celebrationsEnabled: true,
  intensity: "normal",
  maxDurationMs: 12_000,
};

export interface RecognitionEvent {
  kind: RecognitionKind;
  /** stable id of the underlying confirmed business event (for the seeded pick) */
  eventId: number;
  subject?: {
    userId: number;
    name: string;
    role: string;
    photoAvailable: boolean;
  } | null;
  /** short human line, e.g. "3 ACCEPTED LEADS" — never money amounts */
  headline?: string | null;
  announcementPriority?: string | undefined;
  /** explicit category override (announcements pick their own) */
  categoryOverride?: string | null;
}

export interface CelebrationPayload {
  kind: RecognitionKind;
  tier: CelebrationTier;
  effect: string;
  assetCategory: string;
  assetId: number | null;
  videoKey: string | null;
  subject: RecognitionEvent["subject"];
  headline: string | null;
  durationMs: number;
  priority: number;
}

const INTENSITY_SCALE: Record<OrchestratorConfig["intensity"], number> = {
  low: 0.6,
  normal: 1,
  high: 1.35,
};

const APPROVED_KINDS: ReadonlySet<string> = new Set([
  "EMERGENCY_ADMIN",
  "SALE",
  "TEAM_MILESTONE",
  "THIRD_ACCEPTED_LEAD",
  "LEAD_ACCEPTED",
  "LEAD_SUBMITTED",
  "ACHIEVEMENT_UNLOCKED",
  "ANNOUNCEMENT",
]);

export function shouldCelebrate(kind: string, config: OrchestratorConfig): boolean {
  if (!config.celebrationsEnabled) return false;
  return APPROVED_KINDS.has(kind);
}

function categoryFor(event: RecognitionEvent, tier: CelebrationTier): string {
  if (event.categoryOverride) return event.categoryOverride;
  const pool = TIER_ASSET_CATEGORIES[tier];
  const idx = Math.abs(event.eventId) % pool.length;
  return pool[idx]!;
}

export function buildCelebration(
  event: RecognitionEvent,
  assets: AssetLike[],
  config: OrchestratorConfig = DEFAULT_ORCHESTRATOR_CONFIG,
): CelebrationPayload | null {
  if (!shouldCelebrate(event.kind, config)) return null;

  const tier = tierForKind(event.kind);
  const category = categoryFor(event, tier);
  const resolved = pickAsset(category, assets, event.eventId);

  const raw = TIER_DURATION_MS[tier] * INTENSITY_SCALE[config.intensity];
  const durationMs = Math.max(2500, Math.min(config.maxDurationMs, Math.round(raw)));

  return {
    kind: event.kind,
    tier,
    effect: resolved.effect,
    assetCategory: category,
    assetId: resolved.assetId,
    videoKey: resolved.videoKey,
    subject: event.subject ?? null,
    headline: event.headline ?? null,
    durationMs,
    priority: priorityOf(event.kind, event.announcementPriority),
  };
}
