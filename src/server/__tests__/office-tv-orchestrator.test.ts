import { describe, expect, it } from "vitest";
import {
  buildCelebration,
  DEFAULT_ORCHESTRATOR_CONFIG,
  shouldCelebrate,
  type RecognitionEvent,
} from "../live/orchestrator";
import type { AssetLike } from "../live/assets";

const cfg = { ...DEFAULT_ORCHESTRATOR_CONFIG, maxDurationMs: 12_000 };

function evt(over: Partial<RecognitionEvent> = {}): RecognitionEvent {
  return {
    kind: over.kind ?? "LEAD_ACCEPTED",
    eventId: over.eventId ?? 42,
    subject:
      over.subject === undefined
        ? { userId: 7, name: "Rahul", role: "agent", photoAvailable: true }
        : over.subject,
    headline: over.headline ?? null,
  };
}

describe("celebration orchestrator", () => {
  it("celebrates only approved recognition kinds — follow-up activity never qualifies", () => {
    expect(shouldCelebrate("LEAD_ACCEPTED", cfg)).toBe(true);
    expect(shouldCelebrate("SALE", cfg)).toBe(true);
    expect(shouldCelebrate("FOLLOW_UP_OPENED", cfg)).toBe(false);
    expect(shouldCelebrate("FOLLOWUP_VIEWED", cfg)).toBe(false);
    expect(shouldCelebrate("LOGIN", cfg)).toBe(false);
    expect(buildCelebration(evt({ kind: "FOLLOW_UP_OPENED" as never }), [], cfg)).toBeNull();
  });

  it("respects the global celebrations-enabled switch", () => {
    expect(buildCelebration(evt(), [], { ...cfg, celebrationsEnabled: false })).toBeNull();
  });

  it("assigns tier by kind — SALE is the top tier, LEAD_SUBMITTED the smallest", () => {
    expect(buildCelebration(evt({ kind: "SALE" }), [], cfg)!.tier).toBe(4);
    expect(buildCelebration(evt({ kind: "THIRD_ACCEPTED_LEAD" }), [], cfg)!.tier).toBe(3);
    expect(buildCelebration(evt({ kind: "LEAD_ACCEPTED" }), [], cfg)!.tier).toBe(2);
    expect(buildCelebration(evt({ kind: "LEAD_SUBMITTED" }), [], cfg)!.tier).toBe(1);
  });

  it("falls back to a built-in effect when the library has no video for the category", () => {
    const c = buildCelebration(evt({ kind: "SALE" }), [], cfg)!;
    expect(c.videoKey).toBeNull();
    expect(c.assetId).toBeNull();
    expect(typeof c.effect).toBe("string");
    expect(c.effect.length).toBeGreaterThan(0);
  });

  it("prefers an approved video asset when one is enabled for the chosen category", () => {
    // force the category by seeding many assets across all tier-4 categories
    const cats = ["CHAMPION", "FIREWORKS", "GOLD", "VICTORY"];
    const assets: AssetLike[] = cats.map((category, i) => ({
      id: 100 + i,
      category,
      kind: "video",
      enabled: true,
      storageKey: `celebrations/${category}/x.mp4`,
      effect: null,
    }));
    const c = buildCelebration(evt({ kind: "SALE", eventId: 7 }), assets, cfg)!;
    expect(c.assetId).not.toBeNull();
    expect(c.videoKey).toMatch(/celebrations\//);
  });

  it("is deterministic for a given eventId (same asset + duration every render)", () => {
    const assets: AssetLike[] = [
      {
        id: 1,
        category: "CHAMPION",
        kind: "video",
        enabled: true,
        storageKey: "a.mp4",
        effect: null,
      },
      {
        id: 2,
        category: "CHAMPION",
        kind: "video",
        enabled: true,
        storageKey: "b.mp4",
        effect: null,
      },
    ];
    const a = buildCelebration(evt({ kind: "SALE", eventId: 999 }), assets, cfg);
    const b = buildCelebration(evt({ kind: "SALE", eventId: 999 }), assets, cfg);
    expect(a).toEqual(b);
  });

  it("clamps duration to the configured max and scales with intensity", () => {
    const low = buildCelebration(evt({ kind: "SALE" }), [], { ...cfg, intensity: "low" })!;
    const high = buildCelebration(evt({ kind: "SALE" }), [], { ...cfg, intensity: "high" })!;
    expect(low.durationMs).toBeLessThan(high.durationMs);
    const tiny = buildCelebration(evt({ kind: "SALE" }), [], { ...cfg, maxDurationMs: 3000 })!;
    expect(tiny.durationMs).toBeLessThanOrEqual(3000);
  });
});
