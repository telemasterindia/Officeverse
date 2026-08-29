import { describe, expect, it } from "vitest";
import {
  assertCanBulkImport,
  canAssignOwnershipFromFile,
  canBulkImport,
  canImportCloserOwnedFollowUps,
} from "../authz/import";
import { HttpError } from "../http-error";

describe("canBulkImport", () => {
  it("admin and agent may import; closer and hr may not", () => {
    expect(canBulkImport({ role: "admin" })).toBe(true);
    expect(canBulkImport({ role: "agent" })).toBe(true);
    expect(canBulkImport({ role: "closer" })).toBe(false);
    expect(canBulkImport({ role: "hr" })).toBe(false);
  });

  it("assertCanBulkImport throws HttpError(403) for closer/hr", () => {
    expect(() => assertCanBulkImport({ role: "agent" })).not.toThrow();
    for (const role of ["closer", "hr"] as const) {
      try {
        assertCanBulkImport({ role });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).status).toBe(403);
      }
    }
  });
});

describe("ownership capabilities", () => {
  it("only admin may set ownership from the file / import closer-owned follow-ups", () => {
    expect(canAssignOwnershipFromFile({ role: "admin" })).toBe(true);
    expect(canAssignOwnershipFromFile({ role: "agent" })).toBe(false);
    expect(canImportCloserOwnedFollowUps({ role: "admin" })).toBe(true);
    expect(canImportCloserOwnedFollowUps({ role: "agent" })).toBe(false);
  });
});
