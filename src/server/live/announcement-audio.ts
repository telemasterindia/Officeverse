/**
 * Officeverse — ANNOUNCEMENT audio / TTS model + sequence timeline (Phase 10
 * Stage 2). PURE. No DB, no I/O, no React.
 *
 * The Announcement Command Center needs EXACT per-announcement audio — the fixed
 * 5-entry `AUDIO_PROFILES` registry can only approximate it (Stage 1 mapped to
 * the "closest" one). This is the smallest additive model: an audio config that
 * lives on the announcement row (`office_tv_announcements.tts_config` etc.) plus
 * the ONE deterministic sequence timeline both the Preview and the Office TV
 * execute:
 *
 *   OPENING SOUND → short pause → TTS ANNOUNCEMENT → optional CELEBRATION → CLOSING SOUND
 *
 * Reuses the EXISTING speech sanitiser / template interpolation — it never
 * builds a second TTS engine. Presentation only: nothing here scores, awards
 * points, or references payroll / salary / incentive money.
 */
import {
  interpolateAnnouncement,
  sanitizeSpeechValue,
  type AnnouncementFields,
  type CueSound,
} from "@/components/celebration/celebration-audio-profiles";

/** the approved cue-sound library (matches `cueSoundTones` in useCelebrationAudio) */
export const ANNOUNCEMENT_CUE_SOUNDS: readonly CueSound[] = [
  "none",
  "bell",
  "chime",
  "success",
  "applause",
  "victory",
  "alert",
];

export interface AnnouncementTtsConfig {
  /** preferred voice name hint; the browser resolves the closest available */
  voiceName: string | null;
  rate: number; // 0.5 – 2
  pitch: number; // 0 – 2
  volume: number; // 0 – 1
  lang: string; // BCP-47 hint
}

export interface AnnouncementAudioConfig {
  ttsEnabled: boolean;
  tts: AnnouncementTtsConfig;
  openingSound: CueSound;
  closingSound: CueSound;
}

export const DEFAULT_ANNOUNCEMENT_AUDIO: AnnouncementAudioConfig = {
  ttsEnabled: false,
  tts: { voiceName: null, rate: 1, pitch: 1, volume: 1, lang: "en-US" },
  openingSound: "bell",
  closingSound: "bell",
};

const clampNum = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const asCue = (v: unknown, d: CueSound): CueSound =>
  typeof v === "string" && (ANNOUNCEMENT_CUE_SOUNDS as readonly string[]).includes(v)
    ? (v as CueSound)
    : d;

/** Total — never throws. Any malformed field falls back to a safe default. */
export function normalizeAnnouncementAudio(raw: unknown): AnnouncementAudioConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tts = (r["tts"] ?? r["ttsConfig"] ?? {}) as Record<string, unknown>;
  const d = DEFAULT_ANNOUNCEMENT_AUDIO;
  return {
    ttsEnabled: typeof r["ttsEnabled"] === "boolean" ? r["ttsEnabled"] : d.ttsEnabled,
    tts: {
      voiceName:
        typeof tts["voiceName"] === "string" && tts["voiceName"].trim()
          ? tts["voiceName"].trim().slice(0, 80)
          : null,
      rate: clampNum(tts["rate"], 0.5, 2, d.tts.rate),
      pitch: clampNum(tts["pitch"], 0, 2, d.tts.pitch),
      volume: clampNum(tts["volume"], 0, 1, d.tts.volume),
      lang:
        typeof tts["lang"] === "string" && tts["lang"].trim()
          ? tts["lang"].trim().slice(0, 12)
          : d.tts.lang,
    },
    openingSound: asCue(r["openingSound"], d.openingSound),
    closingSound: asCue(r["closingSound"], d.closingSound),
  };
}

export function validateAnnouncementAudio(raw: unknown): string[] {
  const errs: string[] = [];
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (
      r["openingSound"] != null &&
      asCue(r["openingSound"], "none") === "none" &&
      r["openingSound"] !== "none"
    )
      errs.push("opening_sound_invalid");
    if (
      r["closingSound"] != null &&
      asCue(r["closingSound"], "none") === "none" &&
      r["closingSound"] !== "none"
    )
      errs.push("closing_sound_invalid");
  }
  return errs;
}

/* --------------------- text safety (HTML / script / size) ------------- */

/**
 * Sanitise free announcement text for STORAGE + DISPLAY: strip control chars +
 * angle brackets / ampersand (no markup ever reaches the TV DOM), collapse
 * whitespace, hard cap the length. React escapes on render too — this is
 * defence in depth so nothing unsafe is ever persisted.
 */
export function sanitizeAnnouncementText(v: unknown, max = 600): string {
  const raw = v == null ? "" : String(v);
  let out = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) out += " ";
    else if (ch === "<" || ch === ">" || ch === "&") out += " ";
    else out += ch;
  }
  return out
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, max);
}

/**
 * The spoken text for an announcement. Runs through the EXISTING approved-field
 * interpolation + speech sanitiser: `{employeeName}` / `{points}` / `{headline}`
 * / `{eventLabel}` are the only placeholders, everything else is stripped, and
 * the result can never contain markup. Returns "" when there is nothing
 * speakable (the sequence then skips the TTS step, visuals unaffected).
 */
export function buildSpokenText(message: string, fields: AnnouncementFields = {}): string {
  const interpolated = interpolateAnnouncement(String(message ?? ""), fields);
  return sanitizeSpeechValue(interpolated).slice(0, 300);
}

/* ----------------------- the ONE sequence timeline -------------------- */

export interface AnnouncementTimeline {
  totalMs: number;
  openingAtMs: number | null;
  ttsAtMs: number | null;
  celebrationAtMs: number | null;
  closingAtMs: number | null;
}

export interface TimelineInput {
  durationMs: number;
  hasOpening: boolean;
  hasTts: boolean;
  hasCelebration: boolean;
  hasClosing: boolean;
}

const OPENING_PAUSE_MS = 650; // "short pause" between the opening cue and speech
const TTS_ESTIMATE_MS = 2600; // reserved window for the spoken line
const CLOSING_LEADOUT_MS = 500; // closing cue lands this far before the end

/**
 * Deterministic. Given the announcement duration and which steps are present,
 * return the millisecond offset of each step. Central — no component computes
 * its own timing. Steps that are absent are null and simply skipped.
 */
export function buildAnnouncementTimeline(input: TimelineInput): AnnouncementTimeline {
  const total = Math.max(2500, Math.min(120_000, Math.trunc(input.durationMs) || 12_000));
  const openingAtMs = input.hasOpening ? 0 : null;
  const ttsAtMs = input.hasTts ? (input.hasOpening ? OPENING_PAUSE_MS : 200) : null;
  const afterTts = (ttsAtMs ?? openingAtMs ?? 0) + (input.hasTts ? TTS_ESTIMATE_MS : 400);
  const celebrationAtMs = input.hasCelebration
    ? Math.min(afterTts, Math.max(0, total - 3200))
    : null;
  const closingAtMs = input.hasClosing ? Math.max(0, total - CLOSING_LEADOUT_MS) : null;
  return { totalMs: total, openingAtMs, ttsAtMs, celebrationAtMs, closingAtMs };
}

/* --------------------------- the bus payload ------------------------- */

export interface AnnouncementBusInput {
  id: number;
  title: string;
  subtitle: string | null;
  message: string;
  effect: string | null;
  priority: string;
  durationMs: number;
  audio: AnnouncementAudioConfig;
  /** already interpolated + speech-sanitised, or "" for no speech */
  spokenText: string;
  /** optional celebration-profile renderer payload for the mid-sequence visual */
  celebration: Record<string, unknown> | null;
  /** true → a local Preview only; it never reaches the live bus / TV */
  preview: boolean;
  source: "operator" | "power_hour" | "milestone";
}

/**
 * The object published to `recognitionBus.publish("announcement", …)`. The bus
 * already supports the `"announcement"` type; nothing new is introduced. The
 * Office TV + the Preview both read this exact shape and run
 * `buildAnnouncementTimeline` over it.
 */
export function buildAnnouncementBusPayload(input: AnnouncementBusInput): Record<string, unknown> {
  const timeline = buildAnnouncementTimeline({
    durationMs: input.durationMs,
    hasOpening: input.audio.openingSound !== "none",
    hasTts: input.audio.ttsEnabled && input.spokenText.trim().length > 0,
    hasCelebration: !!input.celebration,
    hasClosing: input.audio.closingSound !== "none",
  });
  return {
    kind: "ANNOUNCEMENT",
    announcementId: input.id,
    title: input.title,
    subtitle: input.subtitle,
    message: input.message,
    effect: input.effect ?? "celebration",
    priority: input.priority,
    durationMs: timeline.totalMs,
    timeline,
    audio: {
      openingSound: input.audio.openingSound,
      closingSound: input.audio.closingSound,
      ttsEnabled: input.audio.ttsEnabled,
      tts: input.audio.tts,
      spokenText: input.spokenText,
    },
    celebration: input.celebration,
    preview: input.preview,
    source: input.source,
  };
}
