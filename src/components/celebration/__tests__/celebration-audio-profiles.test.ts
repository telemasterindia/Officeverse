/**
 * Phase 7 — celebration audio / announcement profile registry + safe template
 * interpolation. PURE.
 */
import { describe, expect, it } from "vitest";
import {
  AUDIO_PROFILES,
  ANNOUNCEMENT_TEMPLATES,
  interpolateAnnouncement,
  resolveAudioProfile,
  sanitizeSpeechValue,
} from "../celebration-audio-profiles";

describe("AUDIO_PROFILES registry", () => {
  it("has a silent default and a level-2 broadcast profile", () => {
    const ids = AUDIO_PROFILES.map((p) => p.id);
    expect(ids).toContain("silent");
    expect(ids).toContain("chime");
    expect(ids).toContain("level2-broadcast");
  });
  it("the level-2 profile is bell → spoken announcement → chime", () => {
    const p = resolveAudioProfile("level2-broadcast");
    expect(p.preSound).toBe("bell");
    expect(p.postSound).toBe("chime");
    expect(p.tts.enabled).toBe(true);
    expect(p.tts.template).toMatch(/\{employeeName\}/);
    expect(p.tts.rate).toBeGreaterThanOrEqual(0.5);
    expect(p.tts.rate).toBeLessThanOrEqual(2);
  });
  it("resolveAudioProfile never throws — unknown / null → silent", () => {
    expect(resolveAudioProfile(undefined).id).toBe("silent");
    expect(resolveAudioProfile("nope").id).toBe("silent");
    expect(resolveAudioProfile("").id).toBe("silent");
  });
  it("silent profile speaks nothing and plays nothing", () => {
    const p = resolveAudioProfile("silent");
    expect(p.preSound).toBe("none");
    expect(p.postSound).toBe("none");
    expect(p.tts.enabled).toBe(false);
  });
});

describe("interpolateAnnouncement — safe substitution only", () => {
  it("substitutes the approved recognition fields", () => {
    const out = interpolateAnnouncement(
      "Attention team! {employeeName} just earned {points} points for {headline}.",
      { employeeName: "Amit", points: 500, headline: "LEAD ACCEPTED" },
    );
    expect(out).toBe("Attention team! Amit just earned 500 points for LEAD ACCEPTED.");
  });

  it("drops unknown / unsafe placeholders — never leaves them raw, never executes them", () => {
    const out = interpolateAnnouncement(
      "{employeeName} {password} {__proto__} {constructor} {points}",
      { employeeName: "Bob", points: 10 },
    );
    expect(out).toBe("Bob 10");
    expect(out).not.toMatch(/password|__proto__|constructor|\{/);
  });

  it("sanitises DB-sourced values — no HTML / markup / control chars reach speech", () => {
    const out = interpolateAnnouncement("{employeeName}: {headline}", {
      employeeName: "<script>alert(1)</script>Ann",
      headline: "A & B <b>bold</b>",
    });
    expect(out).not.toMatch(/[<>&]/);
    expect(out).toMatch(/Ann/);
  });

  it("points is only spoken when > 0; missing name → a neutral fallback", () => {
    expect(interpolateAnnouncement("{employeeName} — {points} points", {})).toBe(
      "A team member — 0 points",
    );
    expect(interpolateAnnouncement("earned {points}", { points: -5 })).toBe("earned 0");
    expect(interpolateAnnouncement("earned {points}", { points: 12.9 })).toBe("earned 12");
  });

  it("a template with no speakable content yields '' (nothing spoken)", () => {
    expect(interpolateAnnouncement("{nope}{alsoNope}", {})).toBe("");
    expect(interpolateAnnouncement("   ", {})).toBe("");
  });

  it("every shipped template interpolates without throwing", () => {
    for (const t of ANNOUNCEMENT_TEMPLATES) {
      const out = interpolateAnnouncement(t, { employeeName: "Sam", points: 200, headline: "X" });
      expect(typeof out).toBe("string");
      expect(out).not.toMatch(/\{|\}/);
    }
  });
});

describe("sanitizeSpeechValue", () => {
  it("strips control chars + angle brackets, collapses whitespace, caps length", () => {
    expect(sanitizeSpeechValue("a" + String.fromCharCode(0, 31) + "b")).toBe("a b");
    expect(sanitizeSpeechValue("<x> & <y>")).toBe("x y");
    expect(sanitizeSpeechValue("  lots   of   space ")).toBe("lots of space");
    expect(sanitizeSpeechValue("z".repeat(500)).length).toBe(120);
  });
  it("null / undefined → ''", () => {
    expect(sanitizeSpeechValue(null)).toBe("");
    expect(sanitizeSpeechValue(undefined)).toBe("");
  });
});
