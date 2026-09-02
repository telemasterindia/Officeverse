/**
 * Officeverse — CELEBRATION PROFILE model (Phase 10). PURE.
 *
 * An Admin / Operations-Manager COMPOSES recognition effects into a named
 * profile (there is no fixed set of celebration combinations). This module owns
 * the profile CONFIG shape, its total/never-throwing normaliser + validator, and
 * the pure mapping from a stored profile onto the EXISTING renderer contract
 * (`components/celebration/celebration-visuals.ts` → `toCelebrationInput`).
 *
 * PRESENTATION ONLY. Nothing here scores, awards points, reads the ledger, or
 * touches payroll / salary / incentive money. `points` is passed through from
 * the authoritative scoring result — never computed.
 *
 * No DB, no I/O. The service layer (`celebration-profile-service.ts`) persists
 * and audits; the recognition bridge consumes `buildCelebrationPayload`.
 */
import type { CueSound } from "@/components/celebration/celebration-audio-profiles";

export const PROFILE_LEVELS = ["LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"] as const;
export type ProfileLevel = (typeof PROFILE_LEVELS)[number];

export const PROFILE_TRIGGERS = [
  "LEAD_SUBMITTED",
  "LEAD_ACCEPTED",
  "SALE",
  "THIRD_ACCEPTED_LEAD",
  "TEAM_MILESTONE",
  "ACHIEVEMENT_UNLOCKED",
  "MANUAL",
] as const;
export type ProfileTrigger = (typeof PROFILE_TRIGGERS)[number];

export const CUE_SOUNDS: readonly CueSound[] = [
  "none",
  "bell",
  "chime",
  "success",
  "applause",
  "victory",
  "alert",
];
const PARTICLE_SIZES = ["small", "medium", "large"] as const;
const FALL_SPEEDS = ["slow", "normal", "fast"] as const;
const INTENSITIES = ["low", "normal", "high"] as const;

export interface ProfileShow {
  photo: boolean;
  name: boolean;
  achievementText: boolean;
  points: boolean;
  /** incentive amount on the celebration — OFF by default, only where authorised */
  incentive: boolean;
}
export interface ProfileEffects {
  confetti: boolean;
  colourParticles: boolean;
  lightBurst: boolean;
  energyBurst: boolean;
  fireworks: boolean;
  dollarRain: boolean;
  goldEffect: boolean;
  victoryEffect: boolean;
}
export interface ProfileParticles {
  /** explicit particle count override, or null → derive from the level */
  count: number | null;
  size: (typeof PARTICLE_SIZES)[number] | null;
  fallSpeed: (typeof FALL_SPEEDS)[number] | null;
  /** 0..1 fraction of the screen the effect covers, or null → level default */
  spread: number | null;
}
export interface ProfileSound {
  opening: CueSound;
  closing: CueSound;
}
export interface ProfileTts {
  enabled: boolean;
  /** an approved template string; interpolated + sanitised at play time */
  template: string;
  rate: number; // 0.5 – 2
  pitch: number; // 0 – 2
  volume: number; // 0 – 1
  lang: string; // BCP-47 hint
}

export interface CelebrationProfileConfig {
  /** on-screen hold (ms), 2000–12000 */
  durationMs: number;
  intensity: (typeof INTENSITIES)[number];
  show: ProfileShow;
  effects: ProfileEffects;
  particles: ProfileParticles;
  light: { intensity: number | null };
  sound: ProfileSound;
  tts: ProfileTts;
  /** headline override, e.g. "LEAD ACCEPTED"; null → the trigger's default */
  achievementText: string | null;
}

export const DEFAULT_PROFILE_CONFIG: CelebrationProfileConfig = {
  durationMs: 5000,
  intensity: "normal",
  show: { photo: true, name: true, achievementText: true, points: true, incentive: false },
  effects: {
    confetti: true,
    colourParticles: true,
    lightBurst: true,
    energyBurst: false,
    fireworks: false,
    dollarRain: false,
    goldEffect: false,
    victoryEffect: false,
  },
  particles: { count: null, size: null, fallSpeed: null, spread: null },
  light: { intensity: null },
  sound: { opening: "chime", closing: "none" },
  tts: { enabled: false, template: "", rate: 1, pitch: 1, volume: 1, lang: "en-US" },
  achievementText: null,
};

/* ------------------------------ helpers ------------------------------ */

const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const clampNum = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : d;
const nullableEnum = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
const nullableNum = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};
const strOrNull = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s.slice(0, max) : null;
};

/** Total — never throws. Any missing / malformed field falls back to a default. */
export function normalizeProfileConfig(raw: unknown): CelebrationProfileConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PROFILE_CONFIG;
  const show = (r["show"] ?? {}) as Record<string, unknown>;
  const eff = (r["effects"] ?? {}) as Record<string, unknown>;
  const par = (r["particles"] ?? {}) as Record<string, unknown>;
  const light = (r["light"] ?? {}) as Record<string, unknown>;
  const sound = (r["sound"] ?? {}) as Record<string, unknown>;
  const tts = (r["tts"] ?? {}) as Record<string, unknown>;
  return {
    durationMs: Math.round(clampNum(r["durationMs"], 2000, 12000, d.durationMs)),
    intensity: oneOf(r["intensity"], INTENSITIES, d.intensity),
    show: {
      photo: bool(show["photo"], d.show.photo),
      name: bool(show["name"], d.show.name),
      achievementText: bool(show["achievementText"], d.show.achievementText),
      points: bool(show["points"], d.show.points),
      incentive: bool(show["incentive"], d.show.incentive),
    },
    effects: {
      confetti: bool(eff["confetti"], d.effects.confetti),
      colourParticles: bool(eff["colourParticles"], d.effects.colourParticles),
      lightBurst: bool(eff["lightBurst"], d.effects.lightBurst),
      energyBurst: bool(eff["energyBurst"], d.effects.energyBurst),
      fireworks: bool(eff["fireworks"], d.effects.fireworks),
      dollarRain: bool(eff["dollarRain"], d.effects.dollarRain),
      goldEffect: bool(eff["goldEffect"], d.effects.goldEffect),
      victoryEffect: bool(eff["victoryEffect"], d.effects.victoryEffect),
    },
    particles: {
      count: par["count"] == null ? null : Math.round(clampNum(par["count"], 0, 1200, 0)),
      size: nullableEnum(par["size"], PARTICLE_SIZES),
      fallSpeed: nullableEnum(par["fallSpeed"], FALL_SPEEDS),
      spread: nullableNum(par["spread"], 0, 1),
    },
    light: { intensity: nullableNum(light["intensity"], 0, 1) },
    sound: {
      opening: oneOf(sound["opening"], CUE_SOUNDS, d.sound.opening),
      closing: oneOf(sound["closing"], CUE_SOUNDS, d.sound.closing),
    },
    tts: {
      enabled: bool(tts["enabled"], d.tts.enabled),
      template:
        typeof tts["template"] === "string" ? tts["template"].slice(0, 240) : d.tts.template,
      rate: clampNum(tts["rate"], 0.5, 2, d.tts.rate),
      pitch: clampNum(tts["pitch"], 0, 2, d.tts.pitch),
      volume: clampNum(tts["volume"], 0, 1, d.tts.volume),
      lang:
        typeof tts["lang"] === "string" && tts["lang"].trim()
          ? tts["lang"].trim().slice(0, 12)
          : d.tts.lang,
    },
    achievementText: strOrNull(r["achievementText"], 60),
  };
}

/** Field-level codes for the service to reject a bad draft (never throws). */
export function validateProfileConfig(raw: unknown): string[] {
  const errs: string[] = [];
  if (!raw || typeof raw !== "object") return ["config_missing"];
  const c = normalizeProfileConfig(raw);
  const anyEffect = Object.values(c.effects).some(Boolean);
  if (!anyEffect) errs.push("no_effect_selected");
  if (c.tts.enabled && c.tts.template.trim().length < 3) errs.push("tts_template_missing");
  if (c.durationMs < 2000 || c.durationMs > 12000) errs.push("duration_out_of_range");
  return errs;
}

/* --------------------- map a profile onto the renderer ------------------- */

/** effect toggles → the renderer's `particleProfile` string token */
export function resolveParticleProfile(cfg: CelebrationProfileConfig): string {
  const e = cfg.effects;
  if (e.dollarRain) return "dollar-rain";
  if (e.fireworks) return "fireworks";
  if (e.goldEffect || e.victoryEffect || e.energyBurst) return "hero-burst";
  if (e.confetti || e.colourParticles)
    return cfg.intensity === "low" ? "confetti-light" : "confetti";
  return "none";
}

/** legacy one-shot chord token (drives `celebrationToneSet`) — by level */
export function resolveSoundProfile(level: ProfileLevel): string {
  return { LEVEL_1: "chime", LEVEL_2: "cheer", LEVEL_3: "fanfare", LEVEL_4: "anthem" }[level];
}

/**
 * Stage-1 mapping of a profile's sound + TTS onto the CLOSEST registry
 * audio-cue profile id (`components/celebration/celebration-audio-profiles`).
 * A later stage adds an inline audio spec so opening / closing / voice / rate /
 * pitch are honoured exactly; until then this picks the nearest bell/chime/TTS
 * sequence and the visual celebration is never affected either way.
 */
export function resolveAudioProfileId(cfg: CelebrationProfileConfig): string {
  const { opening, closing } = cfg.sound;
  if (opening === "victory") return "hero-broadcast";
  if (opening === "alert") return "epic-broadcast";
  if (cfg.tts.enabled || opening === "bell") return "level2-broadcast";
  if (opening !== "none" || closing !== "none") return "chime";
  return "silent";
}

export interface BuildPayloadInput {
  config: CelebrationProfileConfig;
  level: ProfileLevel;
  kind: string;
  employeeName: string | null;
  employeePhotoRef: string | null;
  headline: string | null;
  subheadline?: string | null;
  /** authoritative points from the scoring result (0 / null when none) */
  points: number | null;
}

/**
 * The `celebrationProfile` object the recognition bus carries and
 * `toCelebrationInput` consumes. Extra keys (`show` / `effects` / `particles` /
 * `light`) are ignored by today's renderer and read by the Stage-3 renderer.
 */
export function buildCelebrationPayload(input: BuildPayloadInput): Record<string, unknown> {
  const { config: c, level } = input;
  const headline = input.headline ?? c.achievementText ?? input.kind.replace(/_/g, " ");
  const points =
    typeof input.points === "number" && Number.isFinite(input.points)
      ? Math.max(0, Math.trunc(input.points))
      : 0;
  return {
    level,
    profile:
      level === "LEVEL_4"
        ? "hero"
        : level === "LEVEL_3"
          ? "epic"
          : level === "LEVEL_2"
            ? "major"
            : "standard",
    employeeName: input.employeeName ?? null,
    employeePhotoRef: input.employeePhotoRef ?? null,
    headline,
    subheadline: input.subheadline ?? null,
    points,
    soundProfile: resolveSoundProfile(level),
    particleProfile: resolveParticleProfile(c),
    durationMs: c.durationMs,
    audioProfile: resolveAudioProfileId(c),
    // Stage-3 renderer hints (safe to ignore today):
    show: c.show,
    effects: c.effects,
    particles: c.particles,
    light: c.light,
    intensity: c.intensity,
  };
}
