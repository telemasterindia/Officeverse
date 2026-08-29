import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCanDecideLeave,
  assertCanManageLeave,
  canCancelLeave,
  canDecideLeave,
  canManageLeave,
  canRequestLeaveFor,
} from "../authz/hr";
import { HttpError } from "../http-error";

describe("HR authorization", () => {
  it("Admin + HR manage leave; Agent + Closer do not", () => {
    expect(canManageLeave("admin")).toBe(true);
    expect(canManageLeave("hr")).toBe(true);
    expect(canManageLeave("agent")).toBe(false);
    expect(canManageLeave("closer")).toBe(false);
  });

  it("an employee may only request leave for THEMSELVES", () => {
    expect(canRequestLeaveFor(10, 10)).toBe(true);
    expect(canRequestLeaveFor(10, 11)).toBe(false);
  });

  it("a manager cannot approve / reject their OWN leave", () => {
    expect(canDecideLeave("hr", 5, 6)).toBe(true); // someone else's
    expect(canDecideLeave("hr", 5, 5)).toBe(false); // own
    expect(canDecideLeave("agent", 5, 6)).toBe(false); // not a manager
  });

  it("cancel: the owner or a manager", () => {
    expect(canCancelLeave("agent", 10, 10)).toBe(true); // own
    expect(canCancelLeave("agent", 10, 11)).toBe(false); // someone else's
    expect(canCancelLeave("hr", 5, 11)).toBe(true); // manager
  });

  it("assert* throws HttpError(403); self-approval is a distinct 403 code", () => {
    expect(() => assertCanManageLeave("admin")).not.toThrow();
    try {
      assertCanManageLeave("agent");
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(403);
    }
    try {
      assertCanDecideLeave("hr", 5, 5);
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(403);
      expect((e as HttpError).code).toBe("self_approval");
    }
  });
});

describe("HR endpoint placement + identity", () => {
  const root = join(__dirname, "..", "..");
  const fns = readFileSync(join(root, "lib", "officeverse", "leave-fns.ts"), "utf8");
  const service = readFileSync(join(root, "server", "hr", "service.ts"), "utf8");

  it("no HR module under src/server/api (client import-protection)", () => {
    expect(readdirSync(join(root, "server", "api")).some((f) => /leave|hr/i.test(f))).toBe(false);
  });

  it("every leave fn authenticates from the session; no client owner/approver id", () => {
    const names = [...fns.matchAll(/export const (\w+Fn)\b/g)].map((m) => m[1]).sort();
    expect(names).toEqual([
      "adminLeaveFn",
      "adminOffFn",
      "decideLeaveFn",
      "myHrFn",
      "recalcHrFn",
      "requestLeaveFn",
    ]);
    expect((fns.match(/requireUser\(\)/g) ?? []).length).toBe(6);
    expect(fns).not.toMatch(/ownerId|approverId|employeeId:\s*z\./);
  });

  it("requestLeave forces userId + createdByUserId to the session user", () => {
    expect(service).toMatch(/userId:\s*user\.id.*self only/s);
    expect(service).toMatch(/createdByUserId:\s*user\.id/);
  });

  it("off records + sandwich days have no client create path (derived only)", () => {
    // the service only writes off_records / leave_days via recompute*, never from input
    expect(fns).not.toMatch(/offRecord|leaveDay|sandwich/i);
  });
});
