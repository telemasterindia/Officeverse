/**
 * Officeverse — Photo Effects Engine registry (Phase 19). PURE config. No JSX.
 *
 * REAL PHOTO = IDENTITY. These are lightweight VISUAL treatments rendered
 * client-side (CSS / SVG / a small canvas burst) AROUND / BEHIND / OVER the
 * real photograph. They never alter the pixels, never call an AI service,
 * never create stored images, and have ZERO payroll / HR / points impact.
 *
 * Each effect declares a reduced-motion fallback so `prefers-reduced-motion`
 * viewers get a calm static version. Durations are bounded (900–4000 ms).
 *
 * This module deliberately imports nothing from payroll / HR / gamification.
 */

export const PHOTO_EFFECT_IDS = [
  "SMART",
  "ENERGETIC",
  "SPORTY",
  "CHAMPION",
  "FIRE",
  "CELEBRATION",
  "MONEY",
  "FESTIVAL",
  "VICTORY",
] as const;

export type PhotoEffectId = (typeof PHOTO_EFFECT_IDS)[number];

/** how the particle layer is drawn, if any */
export type ParticleKind =
  "none" | "confetti" | "sparkle" | "coins" | "colour-splash" | "fireworks";

export interface PhotoEffectConfig {
  id: PhotoEffectId;
  label: string;
  /** static ring / frame classes (always applied — safe under reduced motion) */
  ringClass: string;
  /** extra animated classes (dropped under reduced motion) */
  animateClass: string;
  /** soft background glow colour token */
  glow: string;
  particle: ParticleKind;
  /** overlay burst duration; a normal profile page passes 0 to show it static */
  durationMs: number;
  /** optional corner badge glyph */
  badge?: string;
  /** what a reduced-motion viewer sees instead of the animation */
  reducedMotion: {
    ringClass: string;
    glow: string;
    /** particles are never animated under reduced motion */
    particle: "none";
    note: string;
  };
}

const DEFAULT_ID: PhotoEffectId = "SMART";
const MIN_MS = 900;
const MAX_MS = 4000;

function clampMs(ms: number): number {
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(ms)));
}

export const PHOTO_EFFECTS: Record<PhotoEffectId, PhotoEffectConfig> = {
  SMART: {
    id: "SMART",
    label: "Smart",
    ringClass: "ring-2 ring-primary/40",
    animateClass: "ov-fx-glow-soft",
    glow: "color-mix(in oklab, var(--primary) 35%, transparent)",
    particle: "none",
    durationMs: clampMs(1200),
    reducedMotion: {
      ringClass: "ring-2 ring-primary/40",
      glow: "color-mix(in oklab, var(--primary) 20%, transparent)",
      particle: "none",
      note: "clean premium frame, no motion",
    },
  },
  ENERGETIC: {
    id: "ENERGETIC",
    label: "Energetic",
    ringClass: "ring-2 ring-accent/50",
    animateClass: "ov-fx-ring-pulse",
    glow: "color-mix(in oklab, var(--accent) 45%, transparent)",
    particle: "sparkle",
    durationMs: clampMs(1600),
    reducedMotion: {
      ringClass: "ring-2 ring-accent/50",
      glow: "color-mix(in oklab, var(--accent) 25%, transparent)",
      particle: "none",
      note: "dynamic ring, static",
    },
  },
  SPORTY: {
    id: "SPORTY",
    label: "Sporty",
    ringClass: "ring-2 ring-success/50",
    animateClass: "ov-fx-ring-spin",
    glow: "color-mix(in oklab, var(--success) 40%, transparent)",
    particle: "none",
    durationMs: clampMs(1800),
    reducedMotion: {
      ringClass: "ring-2 ring-success/50",
      glow: "color-mix(in oklab, var(--success) 22%, transparent)",
      particle: "none",
      note: "athletic accent frame, static",
    },
  },
  CHAMPION: {
    id: "CHAMPION",
    label: "Champion",
    ringClass: "ring-[3px] ring-warning/70",
    animateClass: "ov-fx-glow-strong",
    glow: "color-mix(in oklab, var(--warning) 55%, transparent)",
    particle: "sparkle",
    durationMs: clampMs(2400),
    badge: "★", // ★
    reducedMotion: {
      ringClass: "ring-[3px] ring-warning/70",
      glow: "color-mix(in oklab, var(--warning) 30%, transparent)",
      particle: "none",
      note: "premium ring + achievement badge, static",
    },
  },
  FIRE: {
    id: "FIRE",
    label: "Fire",
    ringClass: "ring-2 ring-[#ff6a00]/70",
    animateClass: "ov-fx-flame",
    glow: "color-mix(in oklab, #ff6a00 55%, transparent)",
    particle: "sparkle",
    durationMs: clampMs(1800),
    reducedMotion: {
      ringClass: "ring-2 ring-[#ff6a00]/70",
      glow: "color-mix(in oklab, #ff6a00 30%, transparent)",
      particle: "none",
      note: "warm edge glow, static",
    },
  },
  CELEBRATION: {
    id: "CELEBRATION",
    label: "Celebration",
    ringClass: "ring-2 ring-accent/50",
    animateClass: "ov-fx-glow-soft",
    glow: "color-mix(in oklab, var(--accent) 40%, transparent)",
    particle: "confetti",
    durationMs: clampMs(2600),
    reducedMotion: {
      ringClass: "ring-2 ring-accent/50",
      glow: "color-mix(in oklab, var(--accent) 22%, transparent)",
      particle: "none",
      note: "gentle highlight, no confetti",
    },
  },
  MONEY: {
    id: "MONEY",
    label: "Money",
    ringClass: "ring-2 ring-[#1a9c5b]/70",
    animateClass: "ov-fx-glow-soft",
    glow: "color-mix(in oklab, #1a9c5b 50%, transparent)",
    particle: "coins",
    durationMs: clampMs(2600),
    badge: "$",
    reducedMotion: {
      ringClass: "ring-2 ring-[#1a9c5b]/70",
      glow: "color-mix(in oklab, #1a9c5b 28%, transparent)",
      particle: "none",
      note: "green premium frame, no shower",
    },
  },
  FESTIVAL: {
    id: "FESTIVAL",
    label: "Festival",
    ringClass: "ring-2 ring-fuchsia-500/60",
    animateClass: "ov-fx-glow-soft",
    glow: "color-mix(in oklab, oklch(0.7 0.2 330) 45%, transparent)",
    particle: "colour-splash",
    durationMs: clampMs(2800),
    reducedMotion: {
      ringClass: "ring-2 ring-fuchsia-500/50",
      glow: "color-mix(in oklab, oklch(0.7 0.2 330) 22%, transparent)",
      particle: "none",
      note: "colour accent frame, no splash",
    },
  },
  VICTORY: {
    id: "VICTORY",
    label: "Victory",
    ringClass: "ring-[3px] ring-warning/70",
    animateClass: "ov-fx-glow-strong",
    glow: "color-mix(in oklab, var(--warning) 50%, transparent)",
    particle: "fireworks",
    durationMs: clampMs(3200),
    badge: "⚑", // ⚑
    reducedMotion: {
      ringClass: "ring-[3px] ring-warning/70",
      glow: "color-mix(in oklab, var(--warning) 28%, transparent)",
      particle: "none",
      note: "victory ring + flag badge, no fireworks",
    },
  },
};

/** Resolve an id, falling back to SMART for anything unknown / undefined. */
export function resolveEffect(id: string | null | undefined): PhotoEffectConfig {
  if (id && (PHOTO_EFFECT_IDS as readonly string[]).includes(id)) {
    return PHOTO_EFFECTS[id as PhotoEffectId];
  }
  return PHOTO_EFFECTS[DEFAULT_ID];
}

export function isKnownEffect(id: string): id is PhotoEffectId {
  return (PHOTO_EFFECT_IDS as readonly string[]).includes(id);
}

/* --------------------- future celebration events --------------------- *
 * Phase 19 only wires the reusable engine + this mapping. The gamification
 * RULES (when an event fires, points, rankings, achievements) are a later
 * phase. Follow-up activity is deliberately NOT a celebration event —
 * Follow-up Health is an operational tracker and must stay out of here.     */

export const CELEBRATION_EVENTS = [
  "LEAD_SUBMITTED",
  "LEAD_ACCEPTED",
  "THIRD_ACCEPTED_LEAD",
  "SALE",
  "TEAM_MILESTONE",
  "ACHIEVEMENT_UNLOCKED",
] as const;
export type CelebrationEvent = (typeof CELEBRATION_EVENTS)[number];

export const EVENT_EFFECT_MAP: Record<CelebrationEvent, PhotoEffectId> = {
  LEAD_SUBMITTED: "ENERGETIC",
  LEAD_ACCEPTED: "CELEBRATION",
  THIRD_ACCEPTED_LEAD: "CHAMPION",
  SALE: "MONEY",
  TEAM_MILESTONE: "VICTORY",
  ACHIEVEMENT_UNLOCKED: "FESTIVAL",
};

/** never maps a follow-up (or any unknown) event to a celebration */
export function effectForEvent(event: string): PhotoEffectConfig {
  if ((CELEBRATION_EVENTS as readonly string[]).includes(event)) {
    return PHOTO_EFFECTS[EVENT_EFFECT_MAP[event as CelebrationEvent]];
  }
  return PHOTO_EFFECTS[DEFAULT_ID];
}

export function isCelebrationEvent(event: string): event is CelebrationEvent {
  return (CELEBRATION_EVENTS as readonly string[]).includes(event);
}
