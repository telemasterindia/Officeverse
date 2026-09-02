/**
 * Phase 10 — CELEBRATION PROFILE model. PURE.
 *
 * A profile COMPOSES effects (no fixed combinations). This pins the total,
 * never-throwing normaliser/validator and the pure mapping onto the EXISTING
 * renderer contract (`toCelebrationInput`). Presentation only — no points math.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE_CONFIG,
  buildCelebrationPayload,
  normalizeProfileConfig,
  resolveAudioProfileId,
  resolveParticleProfile,
  resolveSoundProfile,
  validateProfileConfig,
  type CelebrationProfileConfig,
} from "../live/celebration-profile";
import { toCelebrationInput } from "@/components/celebration/celebration-visuals";

type DeepPartialCfg = Partial<
  Omit<CelebrationProfileConfig, "effects" | "show" | "sound" | "tts">
> & {
  effects?: Partial<CelebrationProfileConfig["effects"]>;
  show?: Partial<CelebrationProfileConfig["show"]>;
  sound?: Partial<CelebrationProfileConfig["sound"]>;
  tts?: Partial<CelebrationProfileConfig["tts"]>;
};

const cfg = (over: DeepPartialCfg = {}): CelebrationProfileConfig => ({
  ...DEFAULT_PROFILE_CONFIG,
  ...over,
  effects: { ...DEFAULT_PROFILE_CONFIG.effects, ...(over.effects ?? {}) },
  show: { ...DEFAULT_PROFILE_CONFIG.show, ...(over.show ?? {}) },
  sound: { ...DEFAULT_PROFILE_CONFIG.sound, ...(over.sound ?? {}) },
  tts: { ...DEFAULT_PROFILE_CONFIG.tts, ...(over.tts ?? {}) },
});

describe("normalizeProfileConfig — total, clamps, never throws", () => {
  it("null / garbage → the default config", () => {
    expect(normalizeProfileConfig(null)).toEqual(DEFAULT_PROFILE_CONFIG);
    expect(normalizeProfileConfig("nope")).toEqual(DEFAULT_PROFILE_CONFIG);
    expect(normalizeProfileConfig(42)).toEqual(DEFAULT_PROFILE_CONFIG);
  });
  it("clamps duration, rate/pitch/volume, particle count, spread", () => {
    const n = normalizeProfileConfig({
      durationMs: 999999,
      tts: { enabled: true, template: "hi {employeeName}", rate: 9, pitch: -3, volume: 5 },
      particles: { count: 99999, spread: 4, size: "huge", fallSpeed: "warp" },
      light: { intensity: 2 },
    });
    expect(n.durationMs).toBe(12000);
    expect(n.tts.rate).toBe(2);
    expect(n.tts.pitch).toBe(0);
    expect(n.tts.volume).toBe(1);
    expect(n.particles.count).toBe(1200);
    expect(n.particles.spread).toBe(1);
    expect(n.particles.size).toBeNull(); // unknown enum → null
    expect(n.particles.fallSpeed).toBeNull();
    expect(n.light.intensity).toBe(1);
  });
  it("unknown sound cue → the default cue, unknown intensity → 'normal'", () => {
    const n = normalizeProfileConfig({
      intensity: "extreme",
      sound: { opening: "airhorn", closing: "bell" },
    });
    expect(n.intensity).toBe("normal");
    expect(n.sound.opening).toBe("chime");
    expect(n.sound.closing).toBe("bell");
  });
  it("is idempotent", () => {
    const once = normalizeProfileConfig({ durationMs: 4000, effects: { dollarRain: true } });
    expect(normalizeProfileConfig(once)).toEqual(once);
  });
});

describe("validateProfileConfig", () => {
  it("accepts a well-formed config", () => {
    expect(validateProfileConfig(cfg())).toEqual([]);
  });
  it("flags no effects selected", () => {
    const c = cfg({
      effects: {
        confetti: false,
        colourParticles: false,
        lightBurst: false,
        energyBurst: false,
        fireworks: false,
        dollarRain: false,
        goldEffect: false,
        victoryEffect: false,
      },
    });
    expect(validateProfileConfig(c)).toContain("no_effect_selected");
  });
  it("flags TTS enabled with no template", () => {
    expect(
      validateProfileConfig(
        cfg({ tts: { ...DEFAULT_PROFILE_CONFIG.tts, enabled: true, template: "" } }),
      ),
    ).toContain("tts_template_missing");
  });
  it("missing config object → config_missing", () => {
    expect(validateProfileConfig(null)).toEqual(["config_missing"]);
  });
});

describe("resolveParticleProfile — effect composition (dollar rain wins)", () => {
  it("dollarRain beats everything", () => {
    expect(
      resolveParticleProfile(
        cfg({ effects: { dollarRain: true, fireworks: true, confetti: true } }),
      ),
    ).toBe("dollar-rain");
  });
  it("fireworks next, then gold/victory/energy → hero-burst", () => {
    expect(resolveParticleProfile(cfg({ effects: { dollarRain: false, fireworks: true } }))).toBe(
      "fireworks",
    );
    expect(
      resolveParticleProfile(
        cfg({
          effects: {
            dollarRain: false,
            fireworks: false,
            confetti: false,
            colourParticles: false,
            goldEffect: true,
          },
        }),
      ),
    ).toBe("hero-burst");
  });
  it("confetti by intensity, none when nothing visual", () => {
    expect(
      resolveParticleProfile(
        cfg({
          intensity: "low",
          effects: {
            dollarRain: false,
            fireworks: false,
            goldEffect: false,
            victoryEffect: false,
            energyBurst: false,
            confetti: true,
          },
        }),
      ),
    ).toBe("confetti-light");
    expect(
      resolveParticleProfile(
        cfg({
          intensity: "high",
          effects: {
            dollarRain: false,
            fireworks: false,
            goldEffect: false,
            victoryEffect: false,
            energyBurst: false,
            confetti: true,
          },
        }),
      ),
    ).toBe("confetti");
    expect(
      resolveParticleProfile(
        cfg({
          effects: {
            confetti: false,
            colourParticles: false,
            lightBurst: true,
            energyBurst: false,
            fireworks: false,
            dollarRain: false,
            goldEffect: false,
            victoryEffect: false,
          },
        }),
      ),
    ).toBe("none");
  });
});

describe("resolveSoundProfile / resolveAudioProfileId", () => {
  it("sound profile is level-keyed", () => {
    expect(resolveSoundProfile("LEVEL_1")).toBe("chime");
    expect(resolveSoundProfile("LEVEL_4")).toBe("anthem");
  });
  it("audio-cue id maps to the closest registry profile", () => {
    expect(
      resolveAudioProfileId(
        cfg({
          sound: { opening: "none", closing: "none" },
          tts: { ...DEFAULT_PROFILE_CONFIG.tts },
        }),
      ),
    ).toBe("silent");
    expect(resolveAudioProfileId(cfg({ sound: { opening: "chime", closing: "none" } }))).toBe(
      "chime",
    );
    expect(
      resolveAudioProfileId(
        cfg({
          sound: { opening: "bell", closing: "chime" },
          tts: { ...DEFAULT_PROFILE_CONFIG.tts, enabled: true, template: "x" },
        }),
      ),
    ).toBe("level2-broadcast");
    expect(resolveAudioProfileId(cfg({ sound: { opening: "victory", closing: "applause" } }))).toBe(
      "hero-broadcast",
    );
    expect(resolveAudioProfileId(cfg({ sound: { opening: "alert", closing: "none" } }))).toBe(
      "epic-broadcast",
    );
  });
});

describe("buildCelebrationPayload → round-trips through the renderer contract", () => {
  it("an enabled profile visibly changes the celebration the TV renders", () => {
    const payload = buildCelebrationPayload({
      config: cfg({
        durationMs: 4200,
        effects: { dollarRain: true },
        achievementText: "LEAD ACCEPTED",
      }),
      level: "LEVEL_2",
      kind: "LEAD_ACCEPTED",
      employeeName: "Amit",
      employeePhotoRef: "7",
      headline: null,
      points: 500,
    });
    // the recognition bus carries the payload as `celebrationProfile` alongside
    // `celebrationLevel` + `subject` — mirror that envelope
    const input = toCelebrationInput({
      celebrationLevel: payload["level"],
      celebrationProfile: payload,
      points: payload["points"],
      subject: { name: payload["employeeName"] },
    });
    expect(input.level).toBe("LEVEL_2");
    expect(input.particleProfile).toBe("dollar-rain");
    expect(input.employeeName).toBe("Amit");
    expect(input.headline).toBe("LEAD ACCEPTED");
    expect(input.points).toBe(500);
    expect(input.durationMs).toBe(4200);
  });
  it("points are passed through, never computed; null → 0", () => {
    const p = buildCelebrationPayload({
      config: cfg(),
      level: "LEVEL_1",
      kind: "LEAD_SUBMITTED",
      employeeName: "X",
      employeePhotoRef: null,
      headline: "LEAD SUBMITTED",
      points: null,
    });
    expect(p["points"]).toBe(0);
    expect(
      toCelebrationInput({
        celebrationLevel: p["level"],
        celebrationProfile: p,
        points: p["points"],
      }).points,
    ).toBe(0);
  });
  it("is deterministic", () => {
    const args = {
      config: cfg({ effects: { fireworks: true } }),
      level: "LEVEL_3" as const,
      kind: "SALE",
      employeeName: "Y",
      employeePhotoRef: null,
      headline: "SALE",
      points: 1000,
    };
    const a = buildCelebrationPayload(args);
    for (let i = 0; i < 5; i++) expect(buildCelebrationPayload(args)).toEqual(a);
  });
});
