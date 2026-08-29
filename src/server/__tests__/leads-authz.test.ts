import { describe, expect, it } from "vitest";
import {
  assertCanCreateLead,
  assertCanReadLead,
  assertCanTransferLead,
  assertCanUpdateLead,
  canCreateLead,
  canReadLead,
  canSetLeadStatus,
  canTransferLead,
  canUpdateLead,
  filterUpdatablePatch,
  leadScope,
  updatableFields,
  type LeadActor,
} from "../authz/leads";
import { HttpError } from "../http-error";

/* -------- actors -------- */
const admin: LeadActor = { user: { id: 1, role: "admin" }, agentId: null, closerId: null };
const hr: LeadActor = { user: { id: 2, role: "hr" }, agentId: null, closerId: null };
const agentA: LeadActor = { user: { id: 10, role: "agent" }, agentId: 100, closerId: null };
const agentB: LeadActor = { user: { id: 11, role: "agent" }, agentId: 101, closerId: null };
const agentNoProfile: LeadActor = {
  user: { id: 12, role: "agent" },
  agentId: null,
  closerId: null,
};
const closerX: LeadActor = { user: { id: 20, role: "closer" }, agentId: null, closerId: 200 };
const closerY: LeadActor = { user: { id: 21, role: "closer" }, agentId: null, closerId: 201 };

/* -------- lead states (only the columns the predicates read) -------- */
const leadNew = { agentId: 100, assignedCloserId: null, status: "NEW" } as const;
const leadAssignedToX = { agentId: 100, assignedCloserId: 200, status: "ASSIGNED" } as const;
const leadAcceptedByX = { agentId: 100, assignedCloserId: 200, status: "ACCEPTED" } as const;

describe("canReadLead", () => {
  it("admin & hr read any lead", () => {
    expect(canReadLead(admin, leadNew)).toBe(true);
    expect(canReadLead(admin, leadAssignedToX)).toBe(true);
    expect(canReadLead(hr, leadAssignedToX)).toBe(true);
  });
  it("agent reads only their own submissions (even after transfer)", () => {
    expect(canReadLead(agentA, leadNew)).toBe(true);
    expect(canReadLead(agentA, leadAssignedToX)).toBe(true);
    expect(canReadLead(agentB, leadNew)).toBe(false);
    expect(canReadLead(agentNoProfile, leadNew)).toBe(false);
  });
  it("closer reads only leads assigned to them", () => {
    expect(canReadLead(closerX, leadAssignedToX)).toBe(true);
    expect(canReadLead(closerY, leadAssignedToX)).toBe(false);
    expect(canReadLead(closerX, leadNew)).toBe(false);
  });
});

describe("canCreateLead", () => {
  it("admin and agent can; closer and hr cannot", () => {
    expect(canCreateLead(admin)).toBe(true);
    expect(canCreateLead(agentA)).toBe(true);
    expect(canCreateLead(closerX)).toBe(false);
    expect(canCreateLead(hr)).toBe(false);
  });
});

describe("canUpdateLead", () => {
  it("admin can update any lead", () => {
    expect(canUpdateLead(admin, leadAssignedToX)).toEqual({ ok: true });
  });
  it("agent updates only their own NEW, unassigned lead", () => {
    expect(canUpdateLead(agentA, leadNew)).toEqual({ ok: true });
    expect(canUpdateLead(agentB, leadNew)).toMatchObject({ ok: false, code: "not_owner" });
  });
  it("agent LOSES write access once the lead is transferred", () => {
    expect(canUpdateLead(agentA, leadAssignedToX)).toMatchObject({
      ok: false,
      code: "transferred_readonly",
    });
    // own + unassigned but no longer NEW → still read-only
    expect(
      canUpdateLead(agentA, { agentId: 100, assignedCloserId: null, status: "REJECTED" }),
    ).toMatchObject({ ok: false, code: "transferred_readonly" });
  });
  it("closer updates only a lead currently assigned to them", () => {
    expect(canUpdateLead(closerX, leadAssignedToX)).toEqual({ ok: true });
    expect(canUpdateLead(closerY, leadAssignedToX)).toMatchObject({
      ok: false,
      code: "not_assignee",
    });
    expect(canUpdateLead(closerX, leadNew)).toMatchObject({ ok: false, code: "not_assignee" });
  });
  it("hr cannot update leads", () => {
    expect(canUpdateLead(hr, leadNew)).toMatchObject({ ok: false, code: "role_forbidden" });
  });
});

describe("canTransferLead", () => {
  it("admin transfers/reassigns any lead", () => {
    expect(canTransferLead(admin, leadAssignedToX)).toEqual({ ok: true });
  });
  it("submitting agent transfers only their own still-unassigned lead", () => {
    expect(canTransferLead(agentA, leadNew)).toEqual({ ok: true });
    expect(canTransferLead(agentA, leadAssignedToX)).toMatchObject({
      ok: false,
      code: "already_transferred",
    });
    expect(canTransferLead(agentB, leadNew)).toMatchObject({ ok: false, code: "not_owner" });
  });
  it("closer cannot transfer", () => {
    expect(canTransferLead(closerX, leadNew)).toMatchObject({ ok: false, code: "role_forbidden" });
  });
});

describe("filterUpdatablePatch + updatableFields", () => {
  it("agent may change customer fields but not status", () => {
    const { allowed, rejected } = filterUpdatablePatch(agentA, {
      customer_name: "x",
      debt_amount: 5,
      status: "ACCEPTED",
    });
    expect(allowed).toEqual({ customer_name: "x", debt_amount: 5 });
    expect(rejected).toEqual(["status"]);
  });
  it("closer may change status + comment but not customer PII", () => {
    const { allowed, rejected } = filterUpdatablePatch(closerX, {
      status: "ACCEPTED",
      comment: "spoke to customer",
      customer_name: "hacked",
    });
    expect(allowed).toEqual({ status: "ACCEPTED", comment: "spoke to customer" });
    expect(rejected).toEqual(["customer_name"]);
  });
  it("admin may change everything; undefined values are skipped", () => {
    const { allowed, rejected } = filterUpdatablePatch(admin, {
      status: "COMPLETED",
      city: "Austin",
      phone: undefined,
    });
    expect(allowed).toEqual({ status: "COMPLETED", city: "Austin" });
    expect(rejected).toEqual([]);
  });
  it("hr may change nothing", () => {
    expect(updatableFields(hr).size).toBe(0);
    const { allowed } = filterUpdatablePatch(hr, { comment: "x" });
    expect(Object.keys(allowed)).toHaveLength(0);
  });
});

describe("canSetLeadStatus (transition rules)", () => {
  it("admin may make any transition", () => {
    expect(canSetLeadStatus(admin, { status: "NEW" }, "COMPLETED")).toEqual({ ok: true });
  });
  it("closer: ASSIGNED → ACCEPTED / REJECTED only", () => {
    expect(canSetLeadStatus(closerX, leadAssignedToX, "ACCEPTED")).toEqual({ ok: true });
    expect(canSetLeadStatus(closerX, leadAssignedToX, "REJECTED")).toEqual({ ok: true });
    expect(canSetLeadStatus(closerX, leadAssignedToX, "COMPLETED")).toMatchObject({
      ok: false,
      code: "bad_transition",
    });
  });
  it("closer: ACCEPTED → COMPLETED / FOLLOW-UP only", () => {
    expect(canSetLeadStatus(closerX, leadAcceptedByX, "COMPLETED")).toEqual({ ok: true });
    expect(canSetLeadStatus(closerX, leadAcceptedByX, "REJECTED")).toMatchObject({
      ok: false,
      code: "bad_transition",
    });
  });
  it("agent cannot change status", () => {
    expect(canSetLeadStatus(agentA, leadNew, "ACCEPTED")).toMatchObject({
      ok: false,
      code: "role_forbidden",
    });
  });
});

describe("leadScope (role-aware list restriction)", () => {
  it("admin & hr → all", () => {
    expect(leadScope(admin)).toEqual({ kind: "all" });
    expect(leadScope(hr)).toEqual({ kind: "all" });
  });
  it("agent → own agentId; closer → own closerId", () => {
    expect(leadScope(agentA)).toEqual({ kind: "agent", agentId: 100 });
    expect(leadScope(closerX)).toEqual({ kind: "closer", closerId: 200 });
  });
  it("missing profile → none (returns no rows, never 'all')", () => {
    expect(leadScope(agentNoProfile)).toEqual({ kind: "none" });
    expect(leadScope({ user: { id: 9, role: "closer" }, agentId: null, closerId: null })).toEqual({
      kind: "none",
    });
  });
});

describe("assert* wrappers throw HttpError(403)", () => {
  it("read", () => {
    expect(() => assertCanReadLead(admin, leadNew)).not.toThrow();
    try {
      assertCanReadLead(agentB, leadNew);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(403);
    }
  });
  it("create / update / transfer", () => {
    expect(() => assertCanCreateLead(closerX)).toThrow(HttpError);
    try {
      assertCanUpdateLead(agentA, leadAssignedToX);
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).code).toBe("transferred_readonly");
    }
    try {
      assertCanTransferLead(agentA, leadAssignedToX);
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).code).toBe("already_transferred");
    }
  });
});
