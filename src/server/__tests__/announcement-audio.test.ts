/**
 * Phase 10 Stage 2 — ANNOUNCEMENT audio / TTS model + the ONE sequence timeline.
 * PURE. Reuses the existing speech sanitiser; builds no second TTS engine.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANNOUNCEMENT_AUDIO,
  buildAnnouncementBusPayload,
  buildAnnouncementTimeline,
  buildSpokenText,
  normalizeAnnouncementAudio,
  sanitizeAnnouncementText,
  validateAnnouncementAudio,
} from "../live/announcement-audio";

describe("normalizeAnnouncementAudio — total, clamps, never throws", () => {
  it("null / garbage → the default audio config", () => {
    expect(normalizeAnnouncementAudio(null)).toEqual(DEFAULT_ANNOUNCEMENT_AUDIO);
    expect(normalizeAnnouncementAudio("x")).toEqual(DEFAULT_ANNOUNCEMENT_AUDIO);
  });
  it("clamps rate / pitch / volume and keeps a valid voice + lang", () => {
    const n = normalizeAnnouncementAudio({
      ttsEnabled: true,
      ttsConfig: { voiceName: "  Daniel  ", rate: 9, pitch: -1, volume: 4, lang: "en-GB" },
      openingSound: "bell",
      closingSound: "chime",
    });
    expect(n.ttsEnabled).toBe(true);
    expect(n.tts).toEqual({ voiceName: "Daniel", rate: 2, pitch: 0, volume: 1, lang: "en-GB" });
    expect(n.openingSound).toBe("bell");
    expect(n.closingSound).toBe("chime");
  });
  it("an unknown cue sound falls back to the default cue", () => {
    const n = normalizeAnnouncementAudio({ openingSound: "airhorn", closingSound: "kaboom" });
    expect(n.openingSound).toBe(DEFAULT_ANNOUNCEMENT_AUDIO.openingSound);
    expect(n.closingSound).toBe(DEFAULT_ANNOUNCEMENT_AUDIO.closingSound);
  });
  it("also reads a flat `tts` key (not just `ttsConfig`)", () => {
    const n = normalizeAnnouncementAudio({ tts: { rate: 1.5, lang: "hi-IN" } });
    expect(n.tts.rate).toBe(1.5);
    expect(n.tts.lang).toBe("hi-IN");
  });
});

describe("validateAnnouncementAudio", () => {
  it("accepts valid cue sounds", () => {
    expect(validateAnnouncementAudio({ openingSound: "bell", closingSound: "none" })).toEqual([]);
  });
  it("flags a bad opening / closing sound", () => {
    expect(validateAnnouncementAudio({ openingSound: "trumpet" })).toContain(
      "opening_sound_invalid",
    );
    expect(validateAnnouncementAudio({ closingSound: "gong" })).toContain("closing_sound_invalid");
  });
});

const CTRL = String.fromCharCode(7, 27, 31); // BEL, ESC, unit-separator

describe("sanitizeAnnouncementText — injection / oversize safety (section 14)", () => {
  it("strips angle brackets, ampersand and control chars — no markup ever persists", () => {
    const out = sanitizeAnnouncementText("<script>alert(1)</script> Power & Hour" + CTRL + "!");
    expect(out).not.toMatch(/[<>&]/);
    for (const c of CTRL) expect(out).not.toContain(c);
    expect(out).toContain("script");
    expect(out).toContain("Power");
  });
  it("hard-caps the length", () => {
    expect(sanitizeAnnouncementText("A".repeat(5000), 120)).toHaveLength(120);
  });
});

describe("buildSpokenText — reuses the approved-field interpolation + speech sanitiser", () => {
  it("a plain message passes through", () => {
    expect(buildSpokenText("Attention team! Power Hour starts now.")).toBe(
      "Attention team! Power Hour starts now.",
    );
  });
  it("only the four approved placeholders resolve; unknown ones are removed", () => {
    const out = buildSpokenText("Great job {employeeName}! {points} points. {evilKey}", {
      employeeName: "Amit",
      points: 500,
    });
    expect(out).toContain("Amit");
    expect(out).toContain("500");
    expect(out).not.toContain("evilKey");
    expect(out).not.toMatch(/[{}]/);
  });
  it("markup in a field value is stripped", () => {
    const out = buildSpokenText("Hello {employeeName}", { employeeName: "<b>x</b>" });
    expect(out).not.toMatch(/[<>]/);
  });
});

describe("buildAnnouncementTimeline — deterministic, central, steps skippable (§5)", () => {
  it("all four steps present → strictly ordered offsets inside the duration", () => {
    const tl = buildAnnouncementTimeline({
      durationMs: 12000,
      hasOpening: true,
      hasTts: true,
      hasCelebration: true,
      hasClosing: true,
    });
    expect(tl.openingAtMs).toBe(0);
    expect(tl.ttsAtMs).toBeGreaterThan(tl.openingAtMs!);
    expect(tl.celebrationAtMs).toBeGreaterThanOrEqual(tl.ttsAtMs!);
    expect(tl.closingAtMs).toBeGreaterThan(tl.celebrationAtMs!);
    expect(tl.closingAtMs).toBeLessThan(tl.totalMs);
  });
  it("absent steps are null and simply skipped", () => {
    const tl = buildAnnouncementTimeline({
      durationMs: 8000,
      hasOpening: false,
      hasTts: false,
      hasCelebration: false,
      hasClosing: false,
    });
    expect(tl).toMatchObject({
      openingAtMs: null,
      ttsAtMs: null,
      celebrationAtMs: null,
      closingAtMs: null,
    });
    expect(tl.totalMs).toBe(8000);
  });
  it("is deterministic + clamps the duration", () => {
    const args = {
      durationMs: 999999,
      hasOpening: true,
      hasTts: true,
      hasCelebration: false,
      hasClosing: true,
    };
    const a = buildAnnouncementTimeline(args);
    expect(a.totalMs).toBe(120000);
    for (let i = 0; i < 5; i++) expect(buildAnnouncementTimeline(args)).toEqual(a);
  });
});

describe("buildAnnouncementBusPayload — payload correctness (§20)", () => {
  const base = {
    id: 7,
    title: "POWER HOUR",
    subtitle: null,
    message: "Attention team! Power Hour starts now.",
    effect: null,
    priority: "IMPORTANT",
    durationMs: 12000,
    audio: normalizeAnnouncementAudio({
      ttsEnabled: true,
      ttsConfig: { voiceName: null, rate: 1, pitch: 1, volume: 1, lang: "en-US" },
      openingSound: "bell",
      closingSound: "bell",
    }),
    spokenText: "Attention team! Power Hour starts now.",
    celebration: null,
    preview: false,
    source: "operator" as const,
  };
  it("carries kind ANNOUNCEMENT, the resolved timeline, and the audio block", () => {
    const p = buildAnnouncementBusPayload(base);
    expect(p["kind"]).toBe("ANNOUNCEMENT");
    expect(p["announcementId"]).toBe(7);
    expect((p["audio"] as { openingSound: string }).openingSound).toBe("bell");
    expect((p["audio"] as { spokenText: string }).spokenText).toContain("Power Hour");
    const tl = p["timeline"] as { openingAtMs: number; ttsAtMs: number; closingAtMs: number };
    expect(tl.openingAtMs).toBe(0);
    expect(tl.ttsAtMs).toBeGreaterThan(0);
    expect(p["preview"]).toBe(false);
    expect(p["source"]).toBe("operator");
  });
  it("with TTS off + no sounds the timeline collapses but the payload is still valid", () => {
    const p = buildAnnouncementBusPayload({
      ...base,
      audio: normalizeAnnouncementAudio({
        ttsEnabled: false,
        openingSound: "none",
        closingSound: "none",
      }),
      spokenText: "",
    });
    const tl = p["timeline"] as Record<string, number | null>;
    expect(tl["openingAtMs"]).toBeNull();
    expect(tl["ttsAtMs"]).toBeNull();
    expect(p["kind"]).toBe("ANNOUNCEMENT");
  });
  it("preview:true marks a local-only payload", () => {
    expect(buildAnnouncementBusPayload({ ...base, preview: true })["preview"]).toBe(true);
  });
});
