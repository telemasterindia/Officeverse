import { describe, expect, it } from "vitest";
import { assertCanManageOfficeNetworks, canManageOfficeNetworks } from "../authz/office-networks";
import {
  assertValidOverride,
  canViewManagedAttendance,
  closerCanViewAgent,
  OVERRIDE_CLASSES,
} from "../authz/attendance";

describe("office-network management — ADMIN ONLY (Admin UAT §11)", () => {
  it("only Admin may manage; Agent, Closer and HR may not", () => {
    expect(canManageOfficeNetworks("admin")).toBe(true);
    expect(canManageOfficeNetworks("hr")).toBe(false);
    expect(canManageOfficeNetworks("agent")).toBe(false);
    expect(canManageOfficeNetworks("closer")).toBe(false);
    expect(() => assertCanManageOfficeNetworks("agent")).toThrow(/Admin/i);
    expect(() => assertCanManageOfficeNetworks("closer")).toThrow(/Admin/i);
    expect(() => assertCanManageOfficeNetworks("hr")).toThrow(/Admin/i);
    expect(() => assertCanManageOfficeNetworks("admin")).not.toThrow();
  });
});

describe("attendance visibility scope (Phase 23)", () => {
  it("Closer / HR / Admin may open a manager view; Agent may not", () => {
    expect(canViewManagedAttendance("closer")).toBe(true);
    expect(canViewManagedAttendance("hr")).toBe(true);
    expect(canViewManagedAttendance("admin")).toBe(true);
    expect(canViewManagedAttendance("agent")).toBe(false);
  });

  it("a Closer sees AGENT attendance ONLY within their own process", () => {
    expect(closerCanViewAgent("closer", "US", "agent", "US")).toBe(true);
    expect(closerCanViewAgent("closer", "US", "agent", "IN")).toBe(false); // cross-process
    expect(closerCanViewAgent("closer", "IN", "agent", "IN")).toBe(true);
    expect(closerCanViewAgent("closer", "IN", "agent", "US")).toBe(false);
    expect(closerCanViewAgent("closer", "US", "closer", "US")).toBe(false); // agents only
    // HR / Admin unrestricted
    expect(closerCanViewAgent("hr", "US", "agent", "IN")).toBe(true);
    expect(closerCanViewAgent("admin", "IN", "agent", "US")).toBe(true);
  });
});

describe("attendance override guard (Phase 23 §18/§39)", () => {
  it("classes are exactly NORMAL / SHORT_LATE / LATE", () => {
    expect([...OVERRIDE_CLASSES]).toEqual(["NORMAL", "SHORT_LATE", "LATE"]);
  });

  it("Admin / HR may override with a reason", () => {
    expect(() => assertValidOverride("admin", "SHORT_LATE", "Heavy rain")).not.toThrow();
    expect(() => assertValidOverride("hr", "NORMAL", "Company network issue")).not.toThrow();
  });

  it("Agent / Closer may NOT override", () => {
    expect(() => assertValidOverride("agent", "NORMAL", "please")).toThrow(/Admin|HR/i);
    expect(() => assertValidOverride("closer", "NORMAL", "please")).toThrow(/Admin|HR/i);
  });

  it("missing reason → denied", () => {
    expect(() => assertValidOverride("admin", "LATE", "")).toThrow(/reason/i);
    expect(() => assertValidOverride("admin", "LATE", "x")).toThrow(/reason/i);
  });

  it("invalid target class → denied", () => {
    expect(() => assertValidOverride("admin", "ON_TIME", "valid reason")).toThrow(
      /classification/i,
    );
    expect(() => assertValidOverride("admin", "ABSENT", "valid reason")).toThrow();
  });
});
