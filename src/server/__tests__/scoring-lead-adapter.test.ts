import { describe, expect, it } from "vitest";
import {
  buildLeadSubmittedEvent,
  type LeadSubmittedContext,
} from "../events/adapters/lead-submitted";
import { normalizeBusinessEvent } from "../events/business-event";

const LEAD = {
  leadCode: "TMI_00099001",
  debtAmount: "25000.00",
  state: "CA",
  zip: "90001",
  creditStatus: "GOOD",
  currentDebts: "Late" as const,
  source: "app" as const,
  status: "NEW" as const,
};

const CTX = (over: Partial<LeadSubmittedContext> = {}): LeadSubmittedContext => ({
  lead: LEAD,
  subjectUserId: 41,
  actorUserId: 41,
  subjectRole: "agent",
  process: "US",
  shiftDate: "2026-08-31",
  agentUserId: 41,
  closerUserId: null,
  atMs: 1_788_000_000_000,
  ...over,
});

describe("LEAD_SUBMITTED adapter — envelope", () => {
  it("builds a canonical event with server-controlled timing", () => {
    const e = buildLeadSubmittedEvent(CTX());
    expect(e.type).toBe("LEAD_SUBMITTED");
    expect(e.source).toEqual({ type: "lead", id: "TMI_00099001" });
    expect(e.subjectUserId).toBe(41);
    expect(e.actorUserId).toBe(41);
    expect(e.occurredAtMs).toBe(1_788_000_000_000);
    expect(e.operationalDate).toBe("2026-08-31"); // pinned to the lead's shift date
  });

  it("uses the canonical lead_code as the source id (not a numeric / temp id)", () => {
    expect(buildLeadSubmittedEvent(CTX()).source.id).toBe("TMI_00099001");
  });

  it("keeps subject and actor distinct for an admin-on-behalf submission", () => {
    const e = buildLeadSubmittedEvent(CTX({ subjectUserId: 41, actorUserId: 9 }));
    expect(e.subjectUserId).toBe(41);
    expect(e.actorUserId).toBe(9);
  });
});

describe("LEAD_SUBMITTED adapter — payload hydration", () => {
  it("maps every legitimately available registered field", () => {
    const e = buildLeadSubmittedEvent(CTX());
    expect(e.payload).toMatchObject({
      debt_amount: 25000,
      state: "CA",
      zip: "90001",
      credit_status: "GOOD",
      current_debts: "Late",
      lead_source: "app",
      from_status: null,
      to_status: "NEW",
      agent_id: 41,
      closer_id: null,
      role: "agent",
      process: "US",
      team: null,
      shift_date: "2026-08-31",
    });
  });

  it("carries the closer USER id when a closer is assigned at submission", () => {
    expect(buildLeadSubmittedEvent(CTX({ closerUserId: 88 })).payload["closer_id"]).toBe(88);
  });

  it("to_status reflects a transfer-on-create (ASSIGNED)", () => {
    const e = buildLeadSubmittedEvent(CTX({ lead: { ...LEAD, status: "ASSIGNED" } }));
    expect(e.payload["to_status"]).toBe("ASSIGNED");
  });

  it("a non-numeric / missing debt amount becomes null, never a fabricated value", () => {
    expect(
      buildLeadSubmittedEvent(CTX({ lead: { ...LEAD, debtAmount: "" } })).payload["debt_amount"],
    ).toBeNull();
  });

  it("null CRM columns pass through as null (no invented values)", () => {
    const e = buildLeadSubmittedEvent(
      CTX({ lead: { ...LEAD, state: null, zip: null, creditStatus: null } }),
    );
    expect(e.payload["state"]).toBeNull();
    expect(e.payload["zip"]).toBeNull();
    expect(e.payload["credit_status"]).toBeNull();
  });

  it("invents no future registry fields", () => {
    const keys = Object.keys(buildLeadSubmittedEvent(CTX()).payload);
    for (const k of ["lead_type", "lead_grade", "qualified", "sale_amount", "closer_tenure_days"]) {
      expect(keys).not.toContain(k);
    }
  });
});

describe("LEAD_SUBMITTED adapter — passes normalization cleanly", () => {
  it("no payload key is dropped or nulled by the field registry", () => {
    const built = buildLeadSubmittedEvent(CTX());
    const n = normalizeBusinessEvent(built);
    expect(n.ok).toBe(true);
    if (n.ok) {
      expect(n.droppedKeys).toEqual([]);
      expect(n.nulledKeys).toEqual([]);
      expect(n.event.type).toBe("LEAD_SUBMITTED");
    }
  });
});
