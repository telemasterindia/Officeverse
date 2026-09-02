/**
 * Officeverse — CELEBRATION AUDIO / ANNOUNCEMENT PROFILES (Phase 7). PURE.
 *
 * A data-driven registry of audio-cue profiles. Nothing here plays audio — the
 * React layer (`useCelebrationAudio`) reads a resolved profile and drives:
 *
 *   PRE_CELEBRATION_SOUND → SPOKEN_ANNOUNCEMENT (TTS) → [visual scene] → POST_CELEBRATION_SOUND
 *
 * All sound effects are SYNTHESISED (Web Audio oscillator tones) — no bundled
 * audio file, no copyrighted IPL song / broadcast audio. TTS uses the browser's
 * own `speechSynthesis` where available; if it is missing or blocked the visual
 * celebration still plays (audio is never required).
 *
 * The announcement TEMPLATE substitutes ONLY the approved recognition fields
 * below, each sanitised — never raw DB values, never HTML.
 */

export type CueSound = "none" | "bell" | "chime" | "success" | "applause" | "victory" | "alert";

export interface TtsSpec {
  enabled: boolean;
  /** e.g. "Attention team! {employeeName} has just accepted a lead." */
  template: string;
  rate: number; // 0.5 – 2
  pitch: number; // 0 – 2
  volume: number; // 0 – 1
  /** BCP-47 hint, e.g. "en-US"; the browser picks the closest available voice */
  lang: string;
}

export interface AudioProfile {
  id: string;
  label: string;
  preSound: CueSound;
  postSound: CueSound;
  tts: TtsSpec;
}

const BASE_TTS: TtsSpec = {
  enabled: false,
  template: "",
  rate: 1,
  pitch: 1,
  volume: 1,
  lang: "en-US",
};

/** The approved templates a business user may pick from (no free-text HTML). */
export const ANNOUNCEMENT_TEMPLATES: readonly string[] = [
  "Attention team! {employeeName} has just accepted a lead.",
  "Great job {employeeName}! A new lead has been accepted.",
  "Team alert! {employeeName} just earned {points} points.",
  "Outstanding work! {employeeName} has accepted a high-value lead.",
  "{employeeName} — {headline}. {points} points.",
];

export const AUDIO_PROFILES: readonly AudioProfile[] = [
  { id: "silent", label: "Silent", preSound: "none", postSound: "none", tts: { ...BASE_TTS } },
  {
    id: "chime",
    label: "Chime (Level 1)",
    preSound: "chime",
    postSound: "none",
    tts: { ...BASE_TTS },
  },
  {
    id: "level2-broadcast",
    label: "Broadcast bell + announcement (Level 2)",
    preSound: "bell",
    postSound: "chime",
    tts: {
      ...BASE_TTS,
      enabled: true,
      template: ANNOUNCEMENT_TEMPLATES[0]!,
      rate: 1,
      pitch: 1,
      volume: 1,
      lang: "en-US",
    },
  },
  {
    id: "epic-broadcast",
    label: "Epic broadcast (Level 3)",
    preSound: "alert",
    postSound: "victory",
    tts: { ...BASE_TTS, enabled: true, template: ANNOUNCEMENT_TEMPLATES[3]!, lang: "en-US" },
  },
  {
    id: "hero-broadcast",
    label: "Hero broadcast (Level 4)",
    preSound: "victory",
    postSound: "applause",
    tts: { ...BASE_TTS, enabled: true, template: ANNOUNCEMENT_TEMPLATES[3]!, lang: "en-US" },
  },
];

const BY_ID = new Map(AUDIO_PROFILES.map((p) => [p.id, p]));

/** Never throws. Unknown / empty → the "silent" profile. */
export function resolveAudioProfile(id: string | null | undefined): AudioProfile {
  return BY_ID.get(String(id ?? "").trim()) ?? BY_ID.get("silent")!;
}

/* --------------------------- template interpolation --------------------------- */

export interface AnnouncementFields {
  employeeName?: string | null;
  points?: number | null;
  headline?: string | null;
  eventLabel?: string | null;
}

/** the ONLY placeholders a template may reference */
const ALLOWED_KEYS = ["employeeName", "points", "headline", "eventLabel"] as const;

/**
 * Strip anything unsafe from a value going into speech: C0/C1 control chars,
 * angle brackets / ampersand (no markup), collapse whitespace, cap length.
 */
export function sanitizeSpeechValue(v: unknown): string {
  const raw = v == null ? "" : String(v);
  let out = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) out += " ";
    else if (ch === "<" || ch === ">" || ch === "&") out += " ";
    else out += ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * Interpolate `{employeeName}` / `{points}` / `{headline}` / `{eventLabel}` in a
 * template. Unknown placeholders are removed (never left raw, never executed).
 * Returns "" when the result has no speakable content.
 */
export function interpolateAnnouncement(template: string, fields: AnnouncementFields): string {
  const values: Record<string, string> = {
    employeeName: sanitizeSpeechValue(fields.employeeName) || "A team member",
    points:
      typeof fields.points === "number" && Number.isFinite(fields.points) && fields.points > 0
        ? String(Math.trunc(fields.points))
        : "0",
    headline: sanitizeSpeechValue(fields.headline) || "a recognition",
    eventLabel: sanitizeSpeechValue(fields.eventLabel) || "an event",
  };
  const out = String(template ?? "")
    .replace(/\{(\w+)\}/g, (_m, key: string) =>
      (ALLOWED_KEYS as readonly string[]).includes(key) ? (values[key] ?? "") : "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return /[a-z0-9]/i.test(out) ? out : "";
}
