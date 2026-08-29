import { describe, expect, it } from "vitest";
import {
  assertCanConvertFollowUp,
  assertCanCreateFollowUp,
  assertCanReadFollowUp,
  assertCanRescheduleFollowUp,
  canCancelFollowUp,
  canCompleteFollowUp,
  canConvertFollowUp,
  canCreateFollowUp,
  canReadFollowUp,
  canReadFollowUpHistory,
  canRescheduleFollowUp,
  canTransition,
  canUpdateFollowUpCustomer,
  filterCustomerPatch,
  followUpScope,
  isTerminal,
  nextStatus,
  type FollowUpActor,
} from "../authz/followups";
import { HttpError } from "../http-error";

const agentOwner: FollowUpActor = { user: { id: 10, role: "agent" } };
const otherAgent: FollowUpActor = { user: { id: 11, role: "agent" } };
const closerOwner: FollowUpActor = { user: { id: 20, role: "closer" } };
const admin: FollowUpActor = { user: { id: 1, role: "admin" } };
const hr: FollowUpActor = { user: { id: 2, role: "hr" } };

const fuScheduled = { ownerUserId: 10, status: "SCHEDULED" } as const;
const fuCompleted = { ownerUserId: 10, status: "COMPLETED" } as const;
const fuCancelled = { ownerUserId: 10, status: "CANCELLED" } as const;
const fuConverted = { ownerUserId: 10, status: "CONVERTED" } as const;
const fuCloserScheduled = { ownerUserId: 20, status: "SCHEDULED" } as const;

describe("read", () => {
  it("owner and admin/hr can read; another agent cannot", () => {
    expect(canReadFollowUp(agentOwner, fuScheduled)).toBe(true);
    expect(canReadFollowUp(admin, fuScheduled)).toBe(true);
    expect(canReadFollowUp(hr, fuScheduled)).toBe(true);
    expect(canReadFollowUp(otherAgent, fuScheduled)).toBe(false);
  });
  it("history visibility mirrors follow-up visibility", () => {
    expect(canReadFollowUpHistory).toBe(canReadFollowUp);
  });
});

describe("create", () => {
  it("agent and closer can; admin/hr cannot", () => {
    expect(canCreateFollowUp(agentOwner)).toBe(true);
    expect(canCreateFollowUp(closerOwner)).toBe(true);
    expect(canCreateFollowUp(admin)).toBe(false);
    expect(canCreateFollowUp(hr)).toBe(false);
  });
});

describe("owner-only active actions", () => {
  it("owner + SCHEDULED → allowed", () => {
    expect(canUpdateFollowUpCustomer(agentOwner, fuScheduled)).toEqual({ ok: true });
    expect(canRescheduleFollowUp(agentOwner, fuScheduled)).toEqual({ ok: true });
    expect(canCompleteFollowUp(agentOwner, fuScheduled)).toEqual({ ok: true });
    expect(canCancelFollowUp(agentOwner, fuScheduled)).toEqual({ ok: true });
  });
  it("non-owner (incl. admin) → not_owner", () => {
    expect(canUpdateFollowUpCustomer(otherAgent, fuScheduled)).toMatchObject({
      ok: false,
      code: "not_owner",
    });
    expect(canRescheduleFollowUp(admin, fuScheduled)).toMatchObject({
      ok: false,
      code: "not_owner",
    });
  });
  it("terminal follow-up → cannot act (code 'terminal')", () => {
    for (const fu of [fuCompleted, fuCancelled, fuConverted]) {
      expect(canRescheduleFollowUp(agentOwner, fu)).toMatchObject({ ok: false, code: "terminal" });
      expect(canCompleteFollowUp(agentOwner, fu)).toMatchObject({ ok: false, code: "terminal" });
      expect(canUpdateFollowUpCustomer(agentOwner, fu)).toMatchObject({
        ok: false,
        code: "terminal",
      });
    }
  });
});

describe("convert (agent-only)", () => {
  it("agent owner + SCHEDULED → allowed", () => {
    expect(canConvertFollowUp(agentOwner, fuScheduled)).toEqual({ ok: true });
  });
  it("closer owner → closer_cannot_convert", () => {
    expect(canConvertFollowUp(closerOwner, fuCloserScheduled)).toMatchObject({
      ok: false,
      code: "closer_cannot_convert",
    });
  });
  it("already-terminal follow-up → rejected", () => {
    expect(canConvertFollowUp(agentOwner, fuConverted).ok).toBe(false);
    expect(canConvertFollowUp(agentOwner, fuCompleted).ok).toBe(false);
  });
});

describe("state machine", () => {
  it("isTerminal", () => {
    expect(isTerminal("SCHEDULED")).toBe(false);
    expect(isTerminal("COMPLETED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("CONVERTED")).toBe(true);
  });
  it("SCHEDULED → every action is legal", () => {
    for (const act of ["reschedule", "complete", "cancel", "convert"] as const) {
      expect(canTransition("SCHEDULED", act)).toEqual({ ok: true });
    }
  });
  it("COMPLETED / CANCELLED are fully terminal", () => {
    expect(canTransition("COMPLETED", "reschedule")).toMatchObject({ ok: false, code: "terminal" });
    expect(canTransition("COMPLETED", "convert")).toMatchObject({ ok: false, code: "terminal" });
    expect(canTransition("CANCELLED", "reschedule")).toMatchObject({ ok: false, code: "terminal" });
    expect(canTransition("CANCELLED", "convert")).toMatchObject({ ok: false, code: "terminal" });
  });
  it("CONVERTED → reschedule terminal, convert = already_converted", () => {
    expect(canTransition("CONVERTED", "reschedule")).toMatchObject({ ok: false, code: "terminal" });
    expect(canTransition("CONVERTED", "convert")).toMatchObject({
      ok: false,
      code: "already_converted",
    });
  });
  it("nextStatus: reschedule stays SCHEDULED; others go terminal", () => {
    expect(nextStatus("reschedule")).toBe("SCHEDULED");
    expect(nextStatus("complete")).toBe("COMPLETED");
    expect(nextStatus("cancel")).toBe("CANCELLED");
    expect(nextStatus("convert")).toBe("CONVERTED");
  });
});

describe("filterCustomerPatch", () => {
  it("keeps customer fields, rejects owner/schedule/status", () => {
    const { allowed, rejected } = filterCustomerPatch({
      full_name: "Jane",
      phone: "5551234567",
      status: "COMPLETED",
      scheduled_at: "2026-09-14 10:00:00",
      owner_user_id: 999,
      city: undefined,
    });
    expect(allowed).toEqual({ full_name: "Jane", phone: "5551234567" });
    expect(rejected.sort()).toEqual(["owner_user_id", "scheduled_at", "status"]);
  });
});

describe("followUpScope", () => {
  it("admin/hr → all; owner → own user id", () => {
    expect(followUpScope(admin)).toEqual({ kind: "all" });
    expect(followUpScope(hr)).toEqual({ kind: "all" });
    expect(followUpScope(agentOwner)).toEqual({ kind: "owner", ownerUserId: 10 });
    expect(followUpScope(closerOwner)).toEqual({ kind: "owner", ownerUserId: 20 });
  });
});

describe("assert wrappers → HttpError", () => {
  it("read denial → 403", () => {
    try {
      assertCanReadFollowUp(otherAgent, fuScheduled);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(403);
    }
  });
  it("terminal reschedule → 422", () => {
    try {
      assertCanRescheduleFollowUp(agentOwner, fuCompleted);
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(422);
      expect((e as HttpError).code).toBe("terminal");
    }
  });
  it("admin create → 403", () => {
    expect(() => assertCanCreateFollowUp(admin)).toThrow(HttpError);
  });
  it("closer convert → 403 closer_cannot_convert", () => {
    try {
      assertCanConvertFollowUp(closerOwner, fuCloserScheduled);
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).code).toBe("closer_cannot_convert");
    }
  });
});
