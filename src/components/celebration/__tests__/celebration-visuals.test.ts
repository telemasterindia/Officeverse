/**
 * Phase 6 — cinematic celebration · pure presentation model.
 *
 * Covers section 31: payload mapping, missing data (never crash), LEVEL_0–4
 * intensity, timeline ordering + lifecycle (mount → phases → done, once),
 * repeated events, audio-hint selection.
 */
import { describe, expect, it } from "vitest";
import {
  CELEBRATION_LEVELS,
  celebrationTimeline,
  isRevealed,
  particleKindFor,
  phaseAt,
  resolveLevel,
  toCelebrationInput,
  visualsForLevel,
  type CelebrationLevel,
} from "../celebration-visuals";
import { celebrationToneSet } from "../useCelebrationAudio";

const full = {
  kind: "LEAD_SUBMITTED",
  tier: 1,
  effect: "ENERGY",
  durationMs: 4000,
  headline: "LEAD SUBMITTED",
  subheadline: "Big debt lead",
  points: 200,
  celebrationLevel: "LEVEL_1",
  celebrationProfile: {
    level: "LEVEL_1",
    profile: "standard",
    employeeName: "Amit",
    employeePhotoRef: "18",
    headline: "LEAD SUBMITTED",
    subheadline: "Big debt lead",
    points: 200,
    soundProfile: "chime",
    particleProfile: "confetti-light",
    durationMs: 4000,
  },
  subject: {
    userId: 18,
    name: "Amit",
    role: "agent",
    photoAvailable: true,
    photo: "data:image/jpeg;base64,AAAA",
  },
};

/* --------------------------- payload mapping --------------------------- */

describe("toCelebrationInput — payload mapping", () => {
  it("maps a full payload to every scene field", () => {
    const i = toCelebrationInput(full);
    expect(i).toMatchObject({
      kind: "LEAD_SUBMITTED",
      level: "LEVEL_1",
      profileName: "standard",
      employeeName: "Amit",
      photoSrc: "data:image/jpeg;base64,AAAA",
      headline: "LEAD SUBMITTED",
      subheadline: "Big debt lead",
      points: 200,
      soundProfile: "chime",
      particleProfile: "confetti-light",
      durationMs: 4000,
    });
  });

  it("photo comes from subject.photo (the server-injected data URL), never bytes in the event", () => {
    expect(toCelebrationInput(full).photoSrc).toBe("data:image/jpeg;base64,AAAA");
    expect(
      toCelebrationInput({ ...full, subject: { ...full.subject, photo: null } }).photoSrc,
    ).toBeNull();
    expect(
      toCelebrationInput({ ...full, subject: { ...full.subject, photo: undefined } }).photoSrc,
    ).toBeNull();
  });

  it("clamps duration to 3000–6000 (or 2600 when reduced)", () => {
    expect(
      toCelebrationInput({
        ...full,
        celebrationProfile: { ...full.celebrationProfile, durationMs: 100 },
      }).durationMs,
    ).toBe(3000);
    expect(
      toCelebrationInput({
        ...full,
        celebrationProfile: { ...full.celebrationProfile, durationMs: 99999 },
      }).durationMs,
    ).toBe(6000);
    expect(toCelebrationInput(full, { reduced: true }).durationMs).toBe(2600);
  });

  it("prefers celebrationProfile fields, falls back to top-level, then null", () => {
    const noProfile = {
      kind: "LEAD_SUBMITTED",
      headline: "HELLO",
      points: 12,
      tier: 2,
      subject: { userId: 1, name: "Bob" },
    };
    const i = toCelebrationInput(noProfile);
    expect(i.headline).toBe("HELLO");
    expect(i.employeeName).toBe("Bob");
    expect(i.points).toBe(12);
    expect(i.level).toBe("LEVEL_2"); // from tier
  });
});

describe("toCelebrationInput — missing / malformed data never crashes", () => {
  it("null / undefined / non-object payload → safe LEVEL_1 defaults", () => {
    for (const bad of [null, undefined, "garbage", 42, [], true]) {
      const i = toCelebrationInput(bad as never);
      expect(i.level).toBe("LEVEL_1");
      expect(i.employeeName).toBeNull();
      expect(i.photoSrc).toBeNull();
      expect(i.headline).toBeNull();
      expect(i.points).toBe(0);
      expect(i.durationMs).toBeGreaterThanOrEqual(3000);
    }
  });

  it("points: 0 / negative / fractional → a clean non-negative integer", () => {
    expect(toCelebrationInput({ ...full, points: 0, celebrationProfile: null }).points).toBe(0);
    expect(toCelebrationInput({ ...full, points: -50, celebrationProfile: null }).points).toBe(0);
    expect(toCelebrationInput({ ...full, points: 12.9, celebrationProfile: null }).points).toBe(12);
    expect(toCelebrationInput({ ...full, points: "nope", celebrationProfile: null }).points).toBe(
      0,
    );
  });

  it("missing name / headline / photo → nulls, scene still has a valid input", () => {
    const i = toCelebrationInput({
      kind: "LEAD_SUBMITTED",
      tier: 1,
      subject: null,
      celebrationProfile: null,
    });
    expect(i.employeeName).toBeNull();
    expect(i.headline).toBeNull();
    expect(i.photoSrc).toBeNull();
    expect(i.kind).toBe("LEAD_SUBMITTED");
    expect(CELEBRATION_LEVELS).toContain(i.level);
  });
});

/* ------------------------------ level ------------------------------ */

describe("resolveLevel — precedence + safe fallback", () => {
  it("celebrationLevel > profile.level > tier > LEVEL_1", () => {
    expect(
      resolveLevel({
        celebrationLevel: "LEVEL_4",
        celebrationProfile: { level: "LEVEL_1" },
        tier: 2,
      }),
    ).toBe("LEVEL_4");
    expect(resolveLevel({ celebrationProfile: { level: "LEVEL_3" }, tier: 2 })).toBe("LEVEL_3");
    expect(resolveLevel({ tier: 2 })).toBe("LEVEL_2");
    expect(resolveLevel({ tier: 4 })).toBe("LEVEL_4");
    expect(resolveLevel({})).toBe("LEVEL_1");
  });
  it("an invalid level string never throws and never silently becomes LEVEL_0", () => {
    expect(resolveLevel({ celebrationLevel: "LEVEL_9" })).toBe("LEVEL_1");
    expect(resolveLevel({ celebrationLevel: 5, tier: "x" })).toBe("LEVEL_1");
  });
});

/* --------------------------- visual intensity --------------------------- */

describe("visualsForLevel — LEVEL_0..4 map to rising intensity", () => {
  it("LEVEL_0 is not cinematic (a subtle recognition state only)", () => {
    const v = visualsForLevel("LEVEL_0", "none");
    expect(v.showCinematic).toBe(false);
    expect(v.particleCount).toBe(0);
    expect(v.particleKind).toBe("none");
    expect(v.lightIntensity).toBe(0);
  });

  it("LEVEL_1..4 are cinematic with monotonically rising intensity", () => {
    const levels: CelebrationLevel[] = ["LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"];
    const v = levels.map((l) => visualsForLevel(l, "confetti"));
    expect(v.every((x) => x.showCinematic)).toBe(true);
    for (let i = 1; i < v.length; i++) {
      expect(v[i]!.particleCount).toBeGreaterThan(v[i - 1]!.particleCount);
      expect(v[i]!.nameScale).toBeGreaterThanOrEqual(v[i - 1]!.nameScale);
      expect(v[i]!.lightIntensity).toBeGreaterThanOrEqual(v[i - 1]!.lightIntensity);
    }
    expect(v[3]!.screenShake).toBe(true); // LEVEL_4 shakes
    expect(v[0]!.screenShake).toBe(false); // LEVEL_1 does not
  });

  it("reduced motion → no particle storm, no shake, calm (not zero) colour wash", () => {
    for (const l of ["LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"] as CelebrationLevel[]) {
      const v = visualsForLevel(l, "fireworks", true);
      expect(v.particleCount).toBe(0);
      expect(v.screenShake).toBe(false);
      expect(v.lightIntensity).toBeLessThanOrEqual(0.4);
      expect(v.showCinematic).toBe(true); // reduced still shows photo/name/headline
    }
  });

  it("LEVEL_1 is a GENUINELY VISIBLE TV celebration, not a token flash", () => {
    const v = visualsForLevel("LEVEL_1", "confetti-light");
    expect(v.showCinematic).toBe(true);
    expect(v.particleKind).toBe("confetti");
    expect(v.particleCount).toBeGreaterThanOrEqual(180); // dense enough to read on a TV
    expect(v.lightIntensity).toBeGreaterThanOrEqual(0.75); // a real burst, not a faint glow
    expect(v.glow).toBe(true);
    // a real hero zoom, not a 0.86 → 1.0 nudge
    expect(v.photoScaleTo - v.photoScaleFrom).toBeGreaterThanOrEqual(0.3);
    expect(v.nameScale).toBeGreaterThanOrEqual(1); // name is the hero text
  });

  it("LEVEL_1 timeline hits the spec beat sheet over ~5s (photo→name→headline→points→hold→exit)", () => {
    const tl = celebrationTimeline(5000, "LEVEL_1");
    expect(tl.totalMs).toBe(5000);
    // ordered, distinct beats
    expect(tl.photoMs).toBeLessThan(tl.nameMs);
    expect(tl.nameMs).toBeLessThan(tl.headlineMs);
    expect(tl.headlineMs).toBeLessThan(tl.pointsMs);
    expect(tl.pointsMs).toBeLessThan(tl.peakMs);
    // photo ~0.3–1.0s, points in by ~2.2s, a real hero hold, exit ~4.5–5.0s
    expect(tl.photoMs).toBeLessThanOrEqual(1000);
    expect(tl.pointsMs).toBeLessThanOrEqual(2200);
    expect(tl.holdMs - tl.pointsMs).toBeGreaterThanOrEqual(1200); // sustained visible celebration
    expect(tl.exitMs).toBeGreaterThanOrEqual(4200);
    expect(tl.exitMs).toBeLessThan(tl.totalMs);
  });
});

describe("particleKindFor — dollar-rain stays dormant unless requested", () => {
  it("maps the Phase-5 particle profiles", () => {
    expect(particleKindFor("confetti-light", "LEVEL_1")).toBe("confetti");
    expect(particleKindFor("confetti", "LEVEL_2")).toBe("confetti");
    expect(particleKindFor("fireworks", "LEVEL_3")).toBe("fireworks");
    expect(particleKindFor("hero-burst", "LEVEL_4")).toBe("hero");
    expect(particleKindFor("none", "LEVEL_0")).toBe("none");
  });
  it("dollar-rain only when the payload explicitly asks for it", () => {
    expect(particleKindFor("dollar-rain", "LEVEL_4")).toBe("dollars");
    // an ordinary LEVEL_1 / LEVEL_4 never produces dollars on its own
    expect(particleKindFor("confetti-light", "LEVEL_1")).not.toBe("dollars");
    expect(particleKindFor("hero-burst", "LEVEL_4")).not.toBe("dollars");
  });
  it("visualsForLevel keeps dollar-rain dormant for a normal LEVEL_1", () => {
    expect(visualsForLevel("LEVEL_1", "confetti-light").particleKind).toBe("confetti");
  });

  it("Phase 7 — LEVEL_2 with a dollar-rain profile → visible dollar particles", () => {
    const v = visualsForLevel("LEVEL_2", "dollar-rain");
    expect(v.particleKind).toBe("dollars");
    expect(v.showCinematic).toBe(true);
    expect(v.particleCount).toBeGreaterThanOrEqual(240); // dense enough for a TV
    // stronger than a plain LEVEL_1 confetti scene
    expect(v.particleCount).toBeGreaterThan(
      visualsForLevel("LEVEL_1", "confetti-light").particleCount,
    );
    expect(v.lightIntensity).toBeGreaterThan(
      visualsForLevel("LEVEL_1", "confetti-light").lightIntensity,
    );
  });
});

describe("Phase 7 — audioProfile passthrough", () => {
  it("toCelebrationInput surfaces celebrationProfile.audioProfile, defaulting to 'silent'", () => {
    const withAudio = toCelebrationInput({
      ...full,
      celebrationProfile: { ...full.celebrationProfile, audioProfile: "level2-broadcast" },
    });
    expect(withAudio.audioProfile).toBe("level2-broadcast");
    expect(toCelebrationInput(full).audioProfile).toBe("silent"); // no key → silent
    expect(toCelebrationInput(null as never).audioProfile).toBe("silent"); // never throws
  });
});

/* ------------------------------ timeline ------------------------------ */

describe("celebrationTimeline + phaseAt — deterministic 3–5s sequence", () => {
  it("all offsets are ordered and fit inside the duration", () => {
    const tl = celebrationTimeline(4000, "LEVEL_1");
    const seq = [
      tl.igniteMs,
      tl.photoMs,
      tl.nameMs,
      tl.headlineMs,
      tl.pointsMs,
      tl.peakMs,
      tl.holdMs,
      tl.exitMs,
    ];
    for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeGreaterThanOrEqual(seq[i - 1]!);
    expect(tl.exitMs).toBeLessThan(tl.totalMs);
  });

  it("phase progresses ignite → … → done and only forwards (mount to cleanup)", () => {
    const tl = celebrationTimeline(4200, "LEVEL_2");
    const order = ["ignite", "photo", "name", "headline", "points", "peak", "hold", "exit", "done"];
    let lastIdx = -1;
    let doneCount = 0;
    for (let t = 0; t <= tl.totalMs + 50; t += 25) {
      const p = phaseAt(t, tl);
      const idx = order.indexOf(p);
      expect(idx).toBeGreaterThanOrEqual(lastIdx); // never goes backwards
      lastIdx = idx;
      if (p === "done") doneCount++;
    }
    expect(phaseAt(0, tl)).toBe("ignite");
    expect(phaseAt(tl.totalMs, tl)).toBe("done");
    expect(phaseAt(tl.totalMs - 1, tl)).toBe("exit");
    expect(doneCount).toBeGreaterThan(0); // reaches done and stays there
  });

  it("LEVEL_0 timeline has no reveal beats — just settles then exits", () => {
    const tl = celebrationTimeline(2200, "LEVEL_0");
    expect(tl.photoMs).toBe(0);
    expect(tl.nameMs).toBe(0);
    expect(tl.headlineMs).toBe(0);
    expect(tl.pointsMs).toBe(0);
    expect(tl.exitMs).toBeLessThan(tl.totalMs);
    expect(phaseAt(tl.totalMs - 1, tl)).toBe("exit");
    expect(phaseAt(tl.totalMs, tl)).toBe("done");
    // a LEVEL_0 payload never surfaces a "points"/"name"/"headline" reveal beat
    for (const el of ["photo", "name", "headline", "points"] as const) {
      expect(isRevealed(el, 0, tl)).toBe(true); // at===0, so trivially "revealed" — the static strip ignores this
    }
  });

  it("isRevealed flips true once and stays true", () => {
    const tl = celebrationTimeline(4000, "LEVEL_3");
    for (const el of ["photo", "name", "headline", "points"] as const) {
      expect(isRevealed(el, 0, tl)).toBe(false);
      expect(isRevealed(el, tl.totalMs, tl)).toBe(true);
      const at = {
        photo: tl.photoMs,
        name: tl.nameMs,
        headline: tl.headlineMs,
        points: tl.pointsMs,
      }[el];
      expect(isRevealed(el, at, tl)).toBe(true);
      expect(isRevealed(el, at - 1, tl)).toBe(false);
    }
  });

  it("100 sequential celebrations produce identical, bounded timelines (no drift / growth)", () => {
    const a = celebrationTimeline(4000, "LEVEL_1");
    for (let i = 0; i < 100; i++) {
      const b = celebrationTimeline(4000, "LEVEL_1");
      expect(b).toEqual(a);
      const inp = toCelebrationInput(full);
      expect(inp.durationMs).toBe(4000);
    }
  });
});

/* ------------------------------ audio ------------------------------ */

describe("celebrationToneSet — synthesised, non-copyrighted hint only", () => {
  it("richer chord for bigger sound profiles; empty for none; safe on junk", () => {
    expect(celebrationToneSet("none")).toEqual([]);
    expect(celebrationToneSet("chime").length).toBe(2);
    expect(celebrationToneSet("anthem").length).toBeGreaterThan(celebrationToneSet("chime").length);
    expect(celebrationToneSet("hero").length).toBe(celebrationToneSet("anthem").length);
    expect(celebrationToneSet("" as never)).toEqual(celebrationToneSet("chime"));
    expect(celebrationToneSet(undefined as never)).toEqual(celebrationToneSet("chime"));
  });
});
