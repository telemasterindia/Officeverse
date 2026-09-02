import { describe, expect, it } from "vitest";
import { assertCanExport, assertCanSelfExport, canExport, canSelfExport } from "../authz/export";
import { HttpError } from "../http-error";

describe("canExport — Data Export centre: ADMIN ONLY (HR role separation)", () => {
  it("admin allowed; hr / agent / closer denied", () => {
    expect(canExport("admin")).toBe(true);
    expect(canExport("hr")).toBe(false);
    expect(canExport("agent")).toBe(false);
    expect(canExport("closer")).toBe(false);
  });

  it("assertCanExport throws HttpError(403) for hr / agent / closer", () => {
    expect(() => assertCanExport("admin")).not.toThrow();
    for (const role of ["hr", "agent", "closer"] as const) {
      try {
        assertCanExport(role);
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).status).toBe(403);
      }
    }
  });
});

describe("canSelfExport — own leads / follow-ups: Admin + Closer; NOT Agent / HR", () => {
  it("admin / closer allowed; agent / hr denied", () => {
    expect(canSelfExport("admin")).toBe(true);
    expect(canSelfExport("closer")).toBe(true);
    expect(canSelfExport("agent")).toBe(false);
    expect(canSelfExport("hr")).toBe(false);
  });

  it("assertCanSelfExport throws HttpError(403) for agent / hr", () => {
    expect(() => assertCanSelfExport("closer")).not.toThrow();
    for (const role of ["agent", "hr"] as const) {
      try {
        assertCanSelfExport(role);
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).status).toBe(403);
      }
    }
  });
});
