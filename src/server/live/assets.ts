/**
 * Officeverse — Live Experience: celebration asset registry (Phase 21).
 *
 * Categories are conceptual. Each maps to a built-in Phase-19 CSS/SVG effect
 * (the guaranteed fallback) and MAY additionally have approved short video
 * assets uploaded by the Officeverse owner (celebration_assets table).
 *
 * NO AI-generated media. NO copyrighted sports broadcast footage. Only
 * original / licensed / owner-supplied assets.
 *
 * Randomisation among enabled assets changes PRESENTATION ONLY — never a
 * business outcome. It is seeded so a given event render is reproducible.
 */

export const CELEBRATION_CATEGORIES = [
  "VICTORY",
  "FIREWORKS",
  "CONFETTI",
  "GOLD",
  "MONEY",
  "ENERGY",
  "CHAMPION",
  "PARTY",
  "FESTIVAL",
] as const;
export type CelebrationCategory = (typeof CELEBRATION_CATEGORIES)[number];

export function isCelebrationCategory(x: string): x is CelebrationCategory {
  return (CELEBRATION_CATEGORIES as readonly string[]).includes(x);
}

/** Category → built-in Phase-19 effect name (never duplicated here, only referenced). */
export const BUILTIN_EFFECT_BY_CATEGORY: Record<CelebrationCategory, string> = {
  VICTORY: "VICTORY",
  FIREWORKS: "CELEBRATION",
  CONFETTI: "CELEBRATION",
  GOLD: "CHAMPION",
  MONEY: "MONEY",
  ENERGY: "ENERGETIC",
  CHAMPION: "CHAMPION",
  PARTY: "FESTIVAL",
  FESTIVAL: "FESTIVAL",
};

export function builtinEffectFor(category: string): string {
  return isCelebrationCategory(category) ? BUILTIN_EFFECT_BY_CATEGORY[category] : "CELEBRATION";
}

export interface AssetLike {
  id: number;
  category: string;
  kind: "video" | "effect";
  enabled: boolean;
  storageKey?: string | null;
  effect?: string | null;
}

export interface ResolvedAsset {
  assetId: number | null;
  category: string;
  /** built-in effect name to render as the guaranteed fallback / background */
  effect: string;
  /** storage key of an approved video, when one is available */
  videoKey: string | null;
}

/** Deterministic small PRNG so a render is reproducible from a seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick the asset to present for `category` from the enabled library. Prefers an
 * approved video; falls back to the built-in effect. `seed` makes the choice
 * deterministic (e.g. the recognition event id).
 */
export function pickAsset(category: string, assets: AssetLike[], seed = 0): ResolvedAsset {
  const effect = builtinEffectFor(category);
  const pool = assets.filter(
    (a) => a.enabled && a.category === category && a.kind === "video" && !!a.storageKey,
  );
  if (pool.length === 0) {
    return { assetId: null, category, effect, videoKey: null };
  }
  const idx = Math.floor(mulberry32(seed || 1)() * pool.length) % pool.length;
  const chosen = pool[idx]!;
  return { assetId: chosen.id, category, effect, videoKey: chosen.storageKey ?? null };
}

/** The seed rows created by seedOfficeTv() — built-in effects, no bytes. */
export const DEFAULT_CELEBRATION_ASSETS = CELEBRATION_CATEGORIES.map((category) => ({
  category,
  kind: "effect" as const,
  label: `${category} (built-in effect)`,
  effect: BUILTIN_EFFECT_BY_CATEGORY[category],
  enabled: true,
  builtin: true,
}));
