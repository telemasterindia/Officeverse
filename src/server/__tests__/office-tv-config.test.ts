import { describe, expect, it } from "vitest";
import { DEFAULT_TV_CONFIG, resolveTvConfig } from "../live/config";

describe("resolveTvConfig", () => {
  it("returns safe defaults for a missing row (sound OFF, threshold configurable)", () => {
    const c = resolveTvConfig(null);
    expect(c).toEqual(DEFAULT_TV_CONFIG);
    expect(c.soundEnabled).toBe(false);
    expect(c.thirdAcceptedThreshold).toBe(3);
    expect(c.teamMilestoneEvery).toBe(0);
  });

  it("passes through a valid row", () => {
    const c = resolveTvConfig({
      displayName: "Sales Floor",
      rotationSec: 20,
      leaderboardWindow: "weekly",
      celebrationIntensity: "high",
      soundEnabled: true,
      thirdAcceptedThreshold: 5,
      teamMilestoneEvery: 100,
    });
    expect(c).toMatchObject({
      displayName: "Sales Floor",
      rotationSec: 20,
      leaderboardWindow: "weekly",
      celebrationIntensity: "high",
      soundEnabled: true,
      thirdAcceptedThreshold: 5,
      teamMilestoneEvery: 100,
    });
  });

  it("clamps / rejects out-of-range or bad values back to defaults", () => {
    const c = resolveTvConfig({
      rotationSec: 999,
      leaderboardWindow: "yearly",
      celebrationIntensity: "extreme",
      thirdAcceptedThreshold: 0,
      teamMilestoneEvery: -5,
    });
    expect(c.rotationSec).toBe(DEFAULT_TV_CONFIG.rotationSec);
    expect(c.leaderboardWindow).toBe("daily");
    expect(c.celebrationIntensity).toBe("normal");
    expect(c.thirdAcceptedThreshold).toBe(3);
    expect(c.teamMilestoneEvery).toBe(0);
  });
});
