import { describe, expect, it } from "vitest";
import { assertCanExport, canExport } from "../authz/export";
import { HttpError } from "../http-error";

describe("canExport — Admin only", () => {
  it("admin allowed; agent / closer / hr denied", () => {
    expect(canExport("admin")).toBe(true);
    expect(canExport("agent")).toBe(false);
    expect(canExport("closer")).toBe(false);
    expect(canExport("hr")).toBe(false);
  });

  it("assertCanExport throws HttpError(403) for every non-admin role", () => {
    expect(() => assertCanExport("admin")).not.toThrow();
    for (const role of ["agent", "closer", "hr"] as const) {
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
