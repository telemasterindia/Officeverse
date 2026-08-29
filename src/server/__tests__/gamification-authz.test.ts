import { describe, expect, it } from "vitest";
import {
  assertValidAdjustment,
  canManageGamification,
  canViewParticipant,
  isGamificationParticipant,
} from "../authz/gamification";

describe("gamification authz — participants vs managers", () => {
  it("only agents and closers are participants (earn points / appear on the board)", () => {
    expect(isGamificationParticipant("agent")).toBe(true);
    expect(isGamificationParticipant("closer")).toBe(true);
    expect(isGamificationParticipant("admin")).toBe(false);
    expect(isGamificationParticipant("hr")).toBe(false);
  });

  it("only Admin / HR manage + investigate", () => {
    expect(canManageGamification("admin")).toBe(true);
    expect(canManageGamification("hr")).toBe(true);
    expect(canManageGamification("agent")).toBe(false);
    expect(canManageGamification("closer")).toBe(false);
  });

  it("a participant may view only their own profile; a manager may view anyone", () => {
    expect(canViewParticipant("agent", 5, 5)).toBe(true);
    expect(canViewParticipant("agent", 5, 6)).toBe(false);
    expect(canViewParticipant("hr", 5, 6)).toBe(true);
    expect(canViewParticipant("admin", 1, 999)).toBe(true);
  });
});

describe("gamification authz — manual adjustments are guarded (no 'give N points' button)", () => {
  it("requires a manager", () => {
    expect(() => assertValidAdjustment("agent", 10, "helpdesk correction")).toThrow(/Admin|HR/i);
  });

  it("rejects a zero / non-integer / oversized amount", () => {
    expect(() => assertValidAdjustment("admin", 0, "no-op change")).toThrow(/non-zero/i);
    expect(() => assertValidAdjustment("admin", 1.5, "fractional")).toThrow();
    expect(() => assertValidAdjustment("admin", 250_000, "way too big")).toThrow();
  });

  it("requires a real reason (audited)", () => {
    expect(() => assertValidAdjustment("admin", -5, "x")).toThrow(/reason/i);
  });

  it("accepts a well-formed correction (positive or negative)", () => {
    expect(() => assertValidAdjustment("admin", -5, "double award on lead 41")).not.toThrow();
    expect(() => assertValidAdjustment("hr", 8, "missed milestone credit")).not.toThrow();
  });
});
