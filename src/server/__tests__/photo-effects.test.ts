import { describe, expect, it } from "vitest";
import {
  CELEBRATION_EVENTS,
  EVENT_EFFECT_MAP,
  PHOTO_EFFECT_IDS,
  PHOTO_EFFECTS,
  effectForEvent,
  isCelebrationEvent,
  isKnownEffect,
  resolveEffect,
} from "@/lib/officeverse/photo-effects";

describe("Photo Effects Engine — registry", () => {
  it("ships exactly the 9 named effects", () => {
    expect([...PHOTO_EFFECT_IDS]).toEqual([
      "SMART",
      "ENERGETIC",
      "SPORTY",
      "CHAMPION",
      "FIRE",
      "CELEBRATION",
      "MONEY",
      "FESTIVAL",
      "VICTORY",
    ]);
  });

  it("every effect renders-safe: bounded duration + a static reduced-motion fallback", () => {
    for (const id of PHOTO_EFFECT_IDS) {
      const fx = PHOTO_EFFECTS[id];
      expect(fx.id).toBe(id);
      expect(fx.durationMs).toBeGreaterThanOrEqual(900);
      expect(fx.durationMs).toBeLessThanOrEqual(4000);
      expect(fx.reducedMotion).toBeTruthy();
      expect(fx.reducedMotion.particle).toBe("none"); // never animates under reduced motion
      expect(typeof fx.reducedMotion.ringClass).toBe("string");
      expect(fx.ringClass.length).toBeGreaterThan(0);
    }
  });

  it("resolveEffect falls back to SMART for anything unknown / missing", () => {
    expect(resolveEffect("SMART").id).toBe("SMART");
    expect(resolveEffect("MONEY").id).toBe("MONEY");
    expect(resolveEffect("NOT_A_REAL_EFFECT").id).toBe("SMART");
    expect(resolveEffect(null).id).toBe("SMART");
    expect(resolveEffect(undefined).id).toBe("SMART");
    expect(resolveEffect("").id).toBe("SMART");
  });

  it("isKnownEffect", () => {
    expect(isKnownEffect("VICTORY")).toBe(true);
    expect(isKnownEffect("victory")).toBe(false);
    expect(isKnownEffect("XYZ")).toBe(false);
  });
});

describe("celebration events — reusable mapping only (no gamification rules)", () => {
  it("maps the 6 recognition events to an effect", () => {
    expect([...CELEBRATION_EVENTS]).toEqual([
      "LEAD_SUBMITTED",
      "LEAD_ACCEPTED",
      "THIRD_ACCEPTED_LEAD",
      "SALE",
      "TEAM_MILESTONE",
      "ACHIEVEMENT_UNLOCKED",
    ]);
    for (const e of CELEBRATION_EVENTS) {
      expect(isKnownEffect(EVENT_EFFECT_MAP[e])).toBe(true);
      expect(effectForEvent(e).id).toBe(EVENT_EFFECT_MAP[e]);
    }
  });

  it("FOLLOW-UP activity is NEVER a celebration event", () => {
    for (const k of Object.keys(EVENT_EFFECT_MAP)) expect(k).not.toMatch(/follow.?up/i);
    for (const k of CELEBRATION_EVENTS) expect(k).not.toMatch(/follow.?up/i);
    expect(isCelebrationEvent("FOLLOW_UP_DONE")).toBe(false);
    expect(isCelebrationEvent("FOLLOW_UP_REMINDER")).toBe(false);
    // an unknown / follow-up event → the calm default, not a burst
    expect(effectForEvent("FOLLOW_UP_DONE").id).toBe("SMART");
    expect(effectForEvent("ANYTHING_ELSE").id).toBe("SMART");
  });
});
