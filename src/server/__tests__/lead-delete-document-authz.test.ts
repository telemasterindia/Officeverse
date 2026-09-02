/**
 * Admin/Lead UAT §2 + §3–§6 — authorization predicates for the new lead
 * surfaces (PURE, no DB):
 *   - hard delete  → ADMIN ONLY (not HR, not the owning agent, not the closer)
 *   - documents    → same surface as READ access (admin / hr / owner agent /
 *                    assigned closer), everyone else denied
 */
import { describe, expect, it } from "vitest";
import { canAccessLeadDocuments, canDeleteLead, canReadLead, type LeadActor } from "../authz/leads";

const admin: LeadActor = { user: { id: 1, role: "admin" }, agentId: null, closerId: null };
const hr: LeadActor = { user: { id: 2, role: "hr" }, agentId: null, closerId: null };
const ownerAgent: LeadActor = { user: { id: 3, role: "agent" }, agentId: 10, closerId: null };
const otherAgent: LeadActor = { user: { id: 4, role: "agent" }, agentId: 11, closerId: null };
const assignedCloser: LeadActor = { user: { id: 5, role: "closer" }, agentId: null, closerId: 20 };
const otherCloser: LeadActor = { user: { id: 6, role: "closer" }, agentId: null, closerId: 21 };

const lead = { agentId: 10, assignedCloserId: 20 };

describe("canDeleteLead — ADMIN ONLY", () => {
  it("grants admin", () => expect(canDeleteLead(admin)).toBe(true));
  it("denies HR", () => expect(canDeleteLead(hr)).toBe(false));
  it("denies the originating agent", () => expect(canDeleteLead(ownerAgent)).toBe(false));
  it("denies the assigned closer", () => expect(canDeleteLead(assignedCloser)).toBe(false));
});

describe("canAccessLeadDocuments — mirrors read access", () => {
  it("matches canReadLead for every actor", () => {
    for (const a of [admin, hr, ownerAgent, otherAgent, assignedCloser, otherCloser]) {
      expect(canAccessLeadDocuments(a, lead)).toBe(canReadLead(a, lead));
    }
  });

  it("grants admin, the owning agent and the assigned closer; HR has no lead access", () => {
    expect(canAccessLeadDocuments(admin, lead)).toBe(true);
    expect(canAccessLeadDocuments(hr, lead)).toBe(false);
    expect(canAccessLeadDocuments(ownerAgent, lead)).toBe(true);
    expect(canAccessLeadDocuments(assignedCloser, lead)).toBe(true);
  });

  it("denies an unrelated agent and an unrelated closer", () => {
    expect(canAccessLeadDocuments(otherAgent, lead)).toBe(false);
    expect(canAccessLeadDocuments(otherCloser, lead)).toBe(false);
  });
});
