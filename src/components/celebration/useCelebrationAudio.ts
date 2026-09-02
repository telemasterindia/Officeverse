/**
 * Officeverse — celebration AUDIO + ANNOUNCEMENT CUE engine (Phase 6 · Phase 7).
 *
 * SAFE, best-effort, non-blocking. Office TV kiosks commonly block autoplay
 * until a user gesture, so this hook:
 *   - never throws
 *   - never blocks the celebration or the polling loop
 *   - continues SILENTLY when audio / speech is unavailable, blocked, or off
 *
 * Phase 7 adds a profile-driven sequence:
 *
 *   PRE sound  →  spoken announcement (browser speechSynthesis)  →  [scene]  →  POST sound
 *
 * No bundled / copyrighted audio: every sound effect is a short SYNTHESISED
 * Web-Audio tone pattern. Timing comes from the audio profile + the scene
 * duration — not scattered setTimeout calls in the view components.
 */
import { useEffect, useRef } from "react";
import type { AudioProfile, CueSound } from "./celebration-audio-profiles";

/* ------------------------- synthesised note sets ------------------------- */

const TONE_SETS: Record<string, number[]> = {
  none: [],
  chime: [880, 1174.7],
  cheer: [523.25, 659.25, 783.99],
  fanfare: [392, 523.25, 659.25, 783.99],
  anthem: [261.63, 392, 523.25, 659.25, 783.99],
};

/** PURE: profile hint → the synthesised note set (exported for tests). */
export function celebrationToneSet(profile: string): number[] {
  const key = String(profile ?? "").toLowerCase();
  if (TONE_SETS[key]) return TONE_SETS[key]!;
  if (key.includes("anthem") || key.includes("hero")) return TONE_SETS["anthem"]!;
  if (key.includes("fanfare")) return TONE_SETS["fanfare"]!;
  if (key.includes("cheer")) return TONE_SETS["cheer"]!;
  return TONE_SETS["chime"]!;
}

/** PURE: a short cue-sound → its synthesised tone pattern (Hz, per-note). */
export function cueSoundTones(cue: CueSound): number[] {
  switch (cue) {
    case "bell":
      return [1318.5, 987.77];
    case "chime":
      return [880, 1174.7];
    case "success":
      return [659.25, 987.77];
    case "applause":
      return [440, 554.37, 659.25, 830.61];
    case "victory":
      return [523.25, 659.25, 783.99, 1046.5];
    case "alert":
      return [740, 740, 932.33];
    default:
      return [];
  }
}

type AudioCtor = typeof AudioContext;

function getAudioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function getSpeech(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  try {
    return window.speechSynthesis ?? null;
  } catch {
    return null;
  }
}

/* ----------------------- legacy one-shot chord hook ---------------------- */

/**
 * Retained for compatibility. Plays a one-shot synthesised chord for
 * `soundProfile` when `enabled` and audio is permitted. Everything is wrapped —
 * a failure is a no-op.
 */
export function useCelebrationAudio(soundProfile: string, enabled: boolean): void {
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<{ osc: OscillatorNode; gain: GainNode }[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const tones = celebrationToneSet(soundProfile);
    if (tones.length === 0) return;
    const Ctor = getAudioCtor();
    if (!Ctor) return;

    let cancelled = false;
    let ctx: AudioContext | null = null;
    try {
      ctx = new Ctor();
      ctxRef.current = ctx;
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);
      master.gain.exponentialRampToValueAtTime(0.14, now + 0.06);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
      tones.forEach((freq, i) => {
        const osc = ctx!.createOscillator();
        const g = ctx!.createGain();
        osc.type = i === 0 ? "sine" : "triangle";
        osc.frequency.value = freq;
        g.gain.value = 1 / (i + 1.5);
        osc.connect(g);
        g.connect(master);
        osc.start(now + i * 0.05);
        osc.stop(now + 1.15);
        nodesRef.current.push({ osc, gain: g });
      });
      void ctx.resume?.().catch(() => undefined);
    } catch {
      /* audio unavailable — continue silently */
    }

    const teardown = () => {
      cancelled = true;
      for (const { osc } of nodesRef.current) {
        try {
          osc.stop();
        } catch {
          /* already stopped */
        }
        try {
          osc.disconnect();
        } catch {
          /* noop */
        }
      }
      nodesRef.current = [];
      const c = ctxRef.current;
      ctxRef.current = null;
      if (c && c.state !== "closed") {
        setTimeout(() => {
          try {
            void c.close();
          } catch {
            /* noop */
          }
        }, 1400);
      }
    };

    const t = setTimeout(() => {
      if (!cancelled) teardown();
    }, 1600);
    return () => {
      clearTimeout(t);
      teardown();
    };
  }, [soundProfile, enabled]);
}

/* --------------------- Phase 7: profile-driven cue engine --------------- */

/**
 * Phase 10 Stage 2 — an EXACT per-announcement audio override. When present it
 * takes precedence over the registry `profile`: the opening / closing cue and
 * the TTS voice / rate / pitch / volume / lang come straight from the
 * announcement config instead of the closest fixed profile. Everything stays
 * just as guarded — a missing AudioContext / speechSynthesis still degrades to
 * silence and the visual is unaffected.
 */
export interface InlineAudioSpec {
  openingSound: CueSound;
  closingSound: CueSound;
  tts: {
    voiceName?: string | null;
    rate: number;
    pitch: number;
    volume: number;
    lang: string;
  };
}

export interface CelebrationCueInput {
  profile: AudioProfile;
  /** already-interpolated + sanitised announcement text, or "" for none */
  announcement: string;
  /** the existing office_tv_settings.soundEnabled master flag */
  soundEnabled: boolean;
  reduced: boolean;
  /** clamped scene duration (ms) — used to schedule the POST sound */
  durationMs: number;
  /** exact per-announcement audio; overrides `profile` when given */
  inlineSpec?: InlineAudioSpec | null;
}

/**
 * Drive the PRE-sound → spoken announcement → POST-sound sequence for one
 * celebration. Every step is guarded: if the browser blocks autoplay or has no
 * `speechSynthesis`, the sequence degrades to silence and the visual scene is
 * unaffected. Cleans up oscillators, the AudioContext, `speechSynthesis`, and
 * every timer on unmount.
 */
export function useCelebrationCue(input: CelebrationCueInput): void {
  const { profile, announcement, soundEnabled, reduced, durationMs, inlineSpec } = input;
  const preSound: CueSound = inlineSpec ? inlineSpec.openingSound : profile.preSound;
  const postSound: CueSound = inlineSpec ? inlineSpec.closingSound : profile.postSound;
  const ttsOn = inlineSpec ? announcement.trim().length > 0 : profile.tts.enabled;
  const ttsCfg = inlineSpec ? inlineSpec.tts : profile.tts;
  const ctxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const spokeRef = useRef(false);

  useEffect(() => {
    // audio is NEVER required for recognition — bail cleanly when muted / reduced
    if (!soundEnabled || reduced) return;

    const Ctor = getAudioCtor();

    /** play one short synthesised tone pattern; never throws */
    const playCue = (cue: CueSound) => {
      const tones = cueSoundTones(cue);
      if (!Ctor || tones.length === 0) return;
      try {
        const ctx = ctxRef.current ?? new Ctor();
        ctxRef.current = ctx;
        const now = ctx.currentTime;
        const master = ctx.createGain();
        master.gain.value = 0.0001;
        master.connect(ctx.destination);
        master.gain.exponentialRampToValueAtTime(0.12, now + 0.04);
        master.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
        tones.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = i === 0 ? "sine" : "triangle";
          osc.frequency.value = freq;
          g.gain.value = 0.9 / (i + 1.4);
          osc.connect(g);
          g.connect(master);
          osc.start(now + i * 0.08);
          osc.stop(now + 0.95 + i * 0.08);
          oscRef.current.push(osc);
        });
        void ctx.resume?.().catch(() => undefined);
      } catch {
        /* audio blocked — silent, visual continues */
      }
    };

    /** speak the announcement via the browser; never throws, never blocks */
    const speak = () => {
      if (spokeRef.current || !ttsOn || announcement.trim().length === 0) return;
      const synth = getSpeech();
      if (!synth || typeof window.SpeechSynthesisUtterance !== "function") return;
      try {
        spokeRef.current = true;
        const u = new SpeechSynthesisUtterance(announcement);
        u.rate = clamp(ttsCfg.rate, 0.5, 2);
        u.pitch = clamp(ttsCfg.pitch, 0, 2);
        u.volume = clamp(ttsCfg.volume, 0, 1);
        u.lang = ttsCfg.lang || "en-US";
        const voices = synth.getVoices?.() ?? [];
        const wantName =
          inlineSpec && typeof inlineSpec.tts.voiceName === "string"
            ? inlineSpec.tts.voiceName.toLowerCase()
            : null;
        const byName = wantName
          ? voices.find((v) => v.name?.toLowerCase() === wantName)
          : undefined;
        const byLang = voices.find((v) => v.lang?.toLowerCase().startsWith(u.lang.toLowerCase()));
        const match = byName ?? byLang;
        if (match) u.voice = match;
        u.onerror = () => undefined; // blocked / interrupted → ignore
        synth.speak(u);
      } catch {
        /* speech unavailable — silent, visual continues */
      }
    };

    // sequence: PRE now → announcement shortly after → POST near the end
    playCue(preSound);
    timersRef.current.push(setTimeout(speak, 420));
    if (postSound !== "none") {
      const at = Math.max(600, Math.min(durationMs - 350, durationMs + 250));
      timersRef.current.push(setTimeout(() => playCue(postSound), at));
    }

    return () => {
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
      for (const osc of oscRef.current) {
        try {
          osc.stop();
        } catch {
          /* already stopped */
        }
        try {
          osc.disconnect();
        } catch {
          /* noop */
        }
      }
      oscRef.current = [];
      try {
        getSpeech()?.cancel();
      } catch {
        /* noop */
      }
      const c = ctxRef.current;
      ctxRef.current = null;
      if (c && c.state !== "closed") {
        setTimeout(() => {
          try {
            void c.close();
          } catch {
            /* noop */
          }
        }, 1200);
      }
    };
    // one cue sequence per mounted celebration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}
