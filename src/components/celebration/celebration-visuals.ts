/**
 * Officeverse — CINEMATIC CELEBRATION · pure presentation model (Phase 6).
 *
 * PURE. No React, no DOM, no network, no business logic. It turns the Phase-5
 * `recognitionBus "celebration"` payload into a normalised, null-safe view model
 * plus a deterministic timeline. The renderer (`CelebrationScene`) is a thin
 * driver over this — it never calculates points, rules, or business meaning.
 *
 * The renderer ONLY consumes the assigned level / profile / points / duration.
 * Level → visual INTENSITY (not business semantics).
 */

export const CELEBRATION_LEVELS = ["LEVEL_0", "LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"] as const;
export type CelebrationLevel = (typeof CELEBRATION_LEVELS)[number];

export function isCelebrationLevel(v: unknown): v is CelebrationLevel {
  return typeof v === "string" && (CELEBRATION_LEVELS as readonly string[]).includes(v);
}

/** Raw celebration payload as it arrives on `office-tv` `live.items[].data`.
 *  Every field is optional / `unknown` — a malformed event must never crash. */
export interface RawCelebrationData {
  kind?: unknown;
  tier?: unknown;
  effect?: unknown;
  durationMs?: unknown;
  headline?: unknown;
  subheadline?: unknown;
  points?: unknown;
  celebrationLevel?: unknown;
  celebrationProfile?: unknown;
  subject?: {
    userId?: unknown;
    name?: unknown;
    role?: unknown;
    photoAvailable?: unknown;
    /** data URL injected server-side by tv-service (existing photo system) */
    photo?: unknown;
  } | null;
}

export interface CelebrationInput {
  kind: string;
  level: CelebrationLevel;
  /** renderer profile token — "silent" | "standard" | "major" | "epic" | "hero" | … */
  profileName: string;
  employeeName: string | null;
  /** authenticated data URL of the real official photo, or null → initials */
  photoSrc: string | null;
  headline: string | null;
  subheadline: string | null;
  /** abstract points, always ≥ 0 (0 → the scene shows recognition, not "+0") */
  points: number;
  soundProfile: string;
  /** "confetti-light" | "confetti" | "fireworks" | "hero-burst" | "dollar-rain" | "none" */
  particleProfile: string;
  /** Phase 7 — audio-cue profile token (bell → TTS → chime); "silent" by default */
  audioProfile: string;
  /** clamped display duration in ms (3000–5500, or 2200 for reduced motion) */
  durationMs: number;
}

const MIN_MS = 3000;
// Phase 7 — LEVEL_2 (LEAD_ACCEPTED) may run to a full 6 s cinematic.
const MAX_MS = 6000;
const REDUCED_MS = 2600;

// Beat-sheet target: a LEVEL_1 celebration must actually last ~5 s on the TV so
// every beat (ignite → photo → name → headline → points → hold → exit) is
// clearly visible. Anything shorter reads as "a flash".
const LEVEL_DEFAULT_DURATION: Record<CelebrationLevel, number> = {
  LEVEL_0: 2600,
  LEVEL_1: 5000,
  LEVEL_2: 5200,
  LEVEL_3: 5400,
  LEVEL_4: 5500,
};

const LEVEL_DEFAULT_PROFILE: Record<CelebrationLevel, string> = {
  LEVEL_0: "silent",
  LEVEL_1: "standard",
  LEVEL_2: "major",
  LEVEL_3: "epic",
  LEVEL_4: "hero",
};

const LEVEL_DEFAULT_PARTICLE: Record<CelebrationLevel, string> = {
  LEVEL_0: "none",
  LEVEL_1: "confetti-light",
  LEVEL_2: "confetti",
  LEVEL_3: "fireworks",
  LEVEL_4: "hero-burst",
};

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
function asNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Resolve the celebration level. Order:
 *   1. `celebrationLevel` (Phase-5 string)  →  if a valid LEVEL_x
 *   2. `celebrationProfile.level`            →  if a valid LEVEL_x
 *   3. legacy `tier` 1..4                    →  LEVEL_1..LEVEL_4
 *   4. fallback                              →  LEVEL_1
 * An unknown / out-of-range value never throws — it degrades to LEVEL_1
 * (a visible-but-modest celebration), never LEVEL_0 (which is silent).
 */
export function resolveLevel(raw: RawCelebrationData): CelebrationLevel {
  if (isCelebrationLevel(raw.celebrationLevel)) return raw.celebrationLevel;
  const prof =
    raw.celebrationProfile && typeof raw.celebrationProfile === "object"
      ? (raw.celebrationProfile as Record<string, unknown>)
      : null;
  if (prof && isCelebrationLevel(prof["level"])) return prof["level"];
  const tier = Math.trunc(asNum(raw.tier));
  if (tier >= 1 && tier <= 4) return `LEVEL_${tier}` as CelebrationLevel;
  return "LEVEL_1";
}

/** Normalise a raw payload into the scene's view model. Total — never throws. */
export function toCelebrationInput(
  raw: RawCelebrationData | null | undefined,
  opts: { reduced?: boolean } = {},
): CelebrationInput {
  const r: RawCelebrationData = raw && typeof raw === "object" ? raw : {};
  const level = resolveLevel(r);
  const prof =
    r.celebrationProfile && typeof r.celebrationProfile === "object"
      ? (r.celebrationProfile as Record<string, unknown>)
      : {};
  const subject = r.subject && typeof r.subject === "object" ? r.subject : {};

  const employeeName = asStr(prof["employeeName"]) ?? asStr((subject as { name?: unknown }).name);
  const photoSrc = asStr((subject as { photo?: unknown }).photo);
  const headline = asStr(prof["headline"]) ?? asStr(r.headline);
  const subheadline = asStr(prof["subheadline"]) ?? asStr(r.subheadline);
  const points = Math.max(0, Math.trunc(asNum(prof["points"]) || asNum(r.points)));
  const soundProfile = asStr(prof["soundProfile"]) ?? "chime";
  const particleProfile = asStr(prof["particleProfile"]) ?? LEVEL_DEFAULT_PARTICLE[level];
  const audioProfile = asStr(prof["audioProfile"]) ?? "silent";
  const rawDur = asNum(prof["durationMs"]) || asNum(r.durationMs) || LEVEL_DEFAULT_DURATION[level];
  const durationMs = opts.reduced
    ? REDUCED_MS
    : Math.max(MIN_MS, Math.min(MAX_MS, rawDur || LEVEL_DEFAULT_DURATION[level]));

  return {
    kind: asStr(r.kind) ?? "RECOGNITION",
    level,
    profileName: asStr(prof["profile"]) ?? LEVEL_DEFAULT_PROFILE[level],
    employeeName,
    photoSrc,
    headline,
    subheadline,
    points,
    soundProfile,
    particleProfile,
    audioProfile,
    durationMs,
  };
}

/* --------------------------- visual intensity --------------------------- */

export type ParticleKind = "none" | "confetti" | "fireworks" | "hero" | "dollars";

export interface LevelVisuals {
  /** false for LEVEL_0 — a compact static recognition strip, no cinematic */
  showCinematic: boolean;
  photoScaleFrom: number;
  photoScaleTo: number;
  /** rem-ish multipliers relative to the base scene type scale */
  nameScale: number;
  headlineScale: number;
  pointsScale: number;
  particleCount: number;
  particleKind: ParticleKind;
  /** 0..1 — light-burst brightness / reach */
  lightIntensity: number;
  /** gradient accent stops for the name / burst */
  accent: readonly [string, string];
  screenShake: boolean;
  glow: boolean;
}

const ACCENTS: Record<CelebrationLevel, readonly [string, string]> = {
  LEVEL_0: ["#8ea3d6", "#8ea3d6"],
  // energetic electric-blue → cyan; the particle layer adds full-spectrum colour
  LEVEL_1: ["#4C8DFF", "#22D3EE"],
  LEVEL_2: ["#3B7BEF", "#34F5C5"],
  LEVEL_3: ["#7C5CFF", "#4C8DFF"],
  LEVEL_4: ["#FFC64B", "#FF7A59"],
};

/** particleProfile string → concrete particle kind (dollar-rain stays dormant
 *  unless the payload explicitly asks for it). */
export function particleKindFor(particleProfile: string, level: CelebrationLevel): ParticleKind {
  const p = particleProfile.toLowerCase();
  if (p.includes("dollar")) return "dollars";
  if (p.includes("hero") || p.includes("burst")) return "hero";
  if (p.includes("firework")) return "fireworks";
  if (p.includes("confetti")) return "confetti";
  if (p === "none") return "none";
  // unknown token → derive from level
  return level === "LEVEL_0" ? "none" : level >= "LEVEL_3" ? "fireworks" : "confetti";
}

export function visualsForLevel(
  level: CelebrationLevel,
  particleProfile: string,
  reduced = false,
): LevelVisuals {
  const kind = particleKindFor(particleProfile, level);
  const base: Record<CelebrationLevel, Omit<LevelVisuals, "particleKind" | "accent">> = {
    LEVEL_0: {
      showCinematic: false,
      photoScaleFrom: 1,
      photoScaleTo: 1,
      nameScale: 0.6,
      headlineScale: 0.5,
      pointsScale: 0.5,
      particleCount: 0,
      lightIntensity: 0,
      screenShake: false,
      glow: false,
    },
    // LEVEL_1 — the LEAD_SUBMITTED target. Must be a PROPER, TV-readable
    // celebration: a real photo hero-zoom (0.6 → 1.0), large text, a dense
    // multi-colour confetti + spray layer, and a bright energy burst.
    LEVEL_1: {
      showCinematic: true,
      photoScaleFrom: 0.62,
      photoScaleTo: 1,
      nameScale: 1.15,
      headlineScale: 1.05,
      pointsScale: 1.05,
      particleCount: 220,
      lightIntensity: 0.85,
      screenShake: false,
      glow: true,
    },
    LEVEL_2: {
      showCinematic: true,
      photoScaleFrom: 0.58,
      photoScaleTo: 1.06,
      nameScale: 1.3,
      headlineScale: 1.14,
      pointsScale: 1.16,
      particleCount: 340,
      lightIntensity: 0.95,
      screenShake: false,
      glow: true,
    },
    LEVEL_3: {
      showCinematic: true,
      photoScaleFrom: 0.55,
      photoScaleTo: 1.12,
      nameScale: 1.42,
      headlineScale: 1.22,
      pointsScale: 1.28,
      particleCount: 480,
      lightIntensity: 1,
      screenShake: true,
      glow: true,
    },
    LEVEL_4: {
      showCinematic: true,
      photoScaleFrom: 0.5,
      photoScaleTo: 1.2,
      nameScale: 1.6,
      headlineScale: 1.32,
      pointsScale: 1.44,
      particleCount: 640,
      lightIntensity: 1,
      screenShake: true,
      glow: true,
    },
  };
  const b = base[level];
  return {
    ...b,
    particleKind: b.showCinematic ? kind : "none",
    // reduced motion: no violent particle storm, but the scene still shows the
    // photo / name / headline / points with calm cross-fades + a colour wash.
    particleCount: reduced ? 0 : b.particleCount,
    lightIntensity: reduced ? Math.min(0.4, b.lightIntensity) : b.lightIntensity,
    screenShake: reduced ? false : b.screenShake,
    accent: ACCENTS[level],
  };
}

/* ------------------------------ timeline ------------------------------ */

export interface CelebrationTimeline {
  totalMs: number;
  igniteMs: number;
  photoMs: number;
  nameMs: number;
  headlineMs: number;
  pointsMs: number;
  peakMs: number;
  holdMs: number;
  exitMs: number;
}

export type CelebrationPhase =
  "ignite" | "photo" | "name" | "headline" | "points" | "peak" | "hold" | "exit" | "done";

/**
 * Deterministic cinematic timeline. Offsets are fractions of `durationMs` so the
 * whole sequence always fits inside the clamped duration. Reduced motion (short
 * duration) collapses the stagger but keeps the ordering.
 */
export function celebrationTimeline(
  durationMs: number,
  level: CelebrationLevel,
): CelebrationTimeline {
  const total = Math.max(1200, Math.trunc(durationMs));
  const f = (frac: number) => Math.round(total * frac);
  // LEVEL_0 has no cinematic — a flat hold then exit
  if (level === "LEVEL_0") {
    return {
      totalMs: total,
      igniteMs: 0,
      photoMs: 0,
      nameMs: 0,
      headlineMs: 0,
      pointsMs: 0,
      peakMs: 0,
      holdMs: f(0.15),
      exitMs: f(0.85),
    };
  }
  // Beat sheet (fractions of total; at total≈5000ms → the spec timeline):
  //   ignite   0.00        (0.0–0.4s dramatic background + light burst)
  //   photo    0.07 ≈ 0.35s (0.3–1.0s hero photo enters, scales up)
  //   name     0.15 ≈ 0.75s (0.7–1.4s employee name, LARGE)
  //   headline 0.24 ≈ 1.20s (1.1–1.8s achievement headline)
  //   points   0.32 ≈ 1.60s (1.5–2.2s points, prominent)
  //   peak     0.40 ≈ 2.00s (1.5–3.8s particle spray + colour + movement)
  //   hold     0.78 ≈ 3.90s (3.8–4.5s hero hold)
  //   exit     0.90 ≈ 4.50s (4.5–5.0s clean exit)
  return {
    totalMs: total,
    igniteMs: 0,
    photoMs: f(0.07),
    nameMs: f(0.15),
    headlineMs: f(0.24),
    pointsMs: f(0.32),
    peakMs: f(0.4),
    holdMs: f(0.72),
    exitMs: f(0.88),
  };
}

/** Phase active at elapsed time `t` (ms since scene start). Monotonic. */
export function phaseAt(t: number, tl: CelebrationTimeline): CelebrationPhase {
  if (t >= tl.totalMs) return "done";
  if (t >= tl.exitMs) return "exit";
  if (t >= tl.holdMs) return "hold";
  if (t >= tl.peakMs) return "peak";
  if (t >= tl.pointsMs && tl.pointsMs > 0) return "points";
  if (t >= tl.headlineMs && tl.headlineMs > 0) return "headline";
  if (t >= tl.nameMs && tl.nameMs > 0) return "name";
  if (t >= tl.photoMs && tl.photoMs > 0) return "photo";
  return "ignite";
}

/** Has element `el` entered yet at elapsed `t`? Used for staggered reveal. */
export function isRevealed(
  el: "photo" | "name" | "headline" | "points",
  t: number,
  tl: CelebrationTimeline,
): boolean {
  const at = { photo: tl.photoMs, name: tl.nameMs, headline: tl.headlineMs, points: tl.pointsMs }[
    el
  ];
  return t >= at;
}
