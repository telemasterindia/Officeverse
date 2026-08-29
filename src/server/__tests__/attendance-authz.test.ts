import { describe, expect, it } from "vitest";
import {
  assertCanCorrectAttendance,
  assertCanViewAllAttendance,
  canCorrectAttendance,
  canViewAllAttendance,
  canViewOwnAttendance,
} from "../authz/attendance";
import { HttpError } from "../http-error";

describe("attendance authorization", () => {
  it("Admin + HR may view ALL attendance; Agent + Closer may not", () => {
    expect(canViewAllAttendance("admin")).toBe(true);
    expect(canViewAllAttendance("hr")).toBe(true);
    expect(canViewAllAttendance("agent")).toBe(false);
    expect(canViewAllAttendance("closer")).toBe(false);
  });

  it("Admin + HR may correct; Agent + Closer may not", () => {
    expect(canCorrectAttendance("admin")).toBe(true);
    expect(canCorrectAttendance("hr")).toBe(true);
    expect(canCorrectAttendance("agent")).toBe(false);
    expect(canCorrectAttendance("closer")).toBe(false);
  });

  it("Agents have NO own-attendance visibility; everyone else may see their own (Phase 23)", () => {
    expect(canViewOwnAttendance("agent")).toBe(false);
    expect(canViewOwnAttendance("closer")).toBe(true);
    expect(canViewOwnAttendance("hr")).toBe(true);
    expect(canViewOwnAttendance("admin")).toBe(true);
  });

  it("assert* throws HttpError(403) for a non-manager role", () => {
    expect(() => assertCanViewAllAttendance("admin")).not.toThrow();
    expect(() => assertCanCorrectAttendance("hr")).not.toThrow();
    for (const role of ["agent", "closer"] as const) {
      for (const fn of [assertCanViewAllAttendance, assertCanCorrectAttendance]) {
        try {
          fn(role);
          expect.unreachable("should have thrown");
        } catch (e) {
          expect(e).toBeInstanceOf(HttpError);
          expect((e as HttpError).status).toBe(403);
        }
      }
    }
  });
});
