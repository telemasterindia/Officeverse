import { describe, expect, it } from "vitest";
import {
  assertCanManagePhotoFor,
  canManagePhotoFor,
  isPhotoManager,
  resolvePhotoTarget,
} from "../authz/photo";

describe("profile-photo authorization", () => {
  it("any employee can manage their OWN photo", () => {
    for (const role of ["agent", "closer", "hr", "admin"]) {
      expect(canManagePhotoFor(role, 7, 7)).toBe(true);
      expect(() => assertCanManagePhotoFor(role, 7, 7)).not.toThrow();
    }
  });

  it("Admin / HR can manage anyone's photo; Agent / Closer cannot", () => {
    expect(canManagePhotoFor("admin", 1, 99)).toBe(true);
    expect(canManagePhotoFor("hr", 1, 99)).toBe(true);
    expect(canManagePhotoFor("agent", 1, 99)).toBe(false);
    expect(canManagePhotoFor("closer", 1, 99)).toBe(false);
    expect(() => assertCanManagePhotoFor("agent", 1, 99)).toThrow(/your own/);
  });

  it("isPhotoManager", () => {
    expect(isPhotoManager("admin")).toBe(true);
    expect(isPhotoManager("hr")).toBe(true);
    expect(isPhotoManager("agent")).toBe(false);
  });

  it("resolvePhotoTarget forces a non-manager to self, honours the id for Admin/HR", () => {
    // agent asking to edit user 42 → forced back to self (7)
    expect(resolvePhotoTarget("agent", 7, 42)).toBe(7);
    expect(resolvePhotoTarget("closer", 7, 42)).toBe(7);
    // admin/hr → honoured
    expect(resolvePhotoTarget("admin", 1, 42)).toBe(42);
    expect(resolvePhotoTarget("hr", 1, 42)).toBe(42);
    // no id / own id → self
    expect(resolvePhotoTarget("agent", 7, null)).toBe(7);
    expect(resolvePhotoTarget("admin", 1, 1)).toBe(1);
  });
});
