import { describe, expect, it } from "vitest";
import { fieldsForMode, type ImportMode } from "@/lib/officeverse/import/fields";
import { normalizeRow, type NormalizedRow } from "../import/normalize-row";
import { planImport, type ExistingLeadRef, type PlanContext, type StaffRef } from "../import/plan";

function idMapping(mode: ImportMode): Record<string, string> {
  const m: Record<string, string> = {};
  for (const f of fieldsForMode(mode)) m[f.key] = f.key;
  return m;
}
function rows(mode: ImportMode, raws: Array<Record<string, string>>): NormalizedRow[] {
  const m = idMapping(mode);
  return raws.map((raw, i) => normalizeRow(raw, m, mode, i + 2));
}

const AGENTS = new Map<string, StaffRef>([
  ["AG-00001", { id: 100, userId: 10, code: "AG-00001" }],
  ["AG-00002", { id: 101, userId: 11, code: "AG-00002" }],
]);
const CLOSERS = new Map<string, StaffRef>([
  ["CL-00001", { id: 200, userId: 20, code: "CL-00001" }],
]);

function ctx(over: Partial<PlanContext> = {}): PlanContext {
  return {
    actor: { role: "agent", userId: 10, agentId: 100, agentCode: "AG-00001" },
    mode: "leads_followups",
    existingLeadByPhone: new Map<string, ExistingLeadRef>(),
    existingLeadByCode: new Map<string, ExistingLeadRef>(),
    agentByCode: AGENTS,
    closerByCode: CLOSERS,
    ...over,
  };
}

const LEAD = { customer_name: "Jane", phone: "512-555-0142" };
const FU = { followup_date: "2026-09-15", followup_time: "10:00" };

describe("Lead classification", () => {
  it("creates a NEW lead owned by the importing agent", () => {
    const plan = planImport(rows("leads_followups", [{ ...LEAD, ...FU }]), ctx());
    expect(plan.leads[0]).toMatchObject({
      decision: "new",
      resolvedAgentId: 100,
      resolvedAgentUserId: 10,
    });
    expect(plan.counts.newLeads).toBe(1);
  });

  it("detects an EXISTING lead by normalised phone — never overwrites", () => {
    const c = ctx({
      existingLeadByPhone: new Map([
        ["5125550142", { id: 900, code: "TMI_00012007", agentId: 100, agentUserId: 10 }],
      ]),
    });
    const plan = planImport(rows("leads_followups", [{ ...LEAD, ...FU }]), c);
    expect(plan.leads[0]).toMatchObject({
      decision: "existing",
      existingLeadId: 900,
      existingLeadCode: "TMI_00012007",
    });
    expect(plan.counts).toMatchObject({ newLeads: 0, existingLeads: 1 });
  });

  it("a repeated phone in the same file is a DUPLICATE row, not a second Lead", () => {
    const plan = planImport(
      rows("leads_followups", [
        { ...LEAD, ...FU },
        { customer_name: "Jane again", phone: "(512) 555 0142", ...FU },
      ]),
      ctx(),
    );
    expect(plan.leads.map((l) => l.decision)).toEqual(["new", "duplicate"]);
    expect(plan.counts).toMatchObject({ newLeads: 1, duplicateRows: 1 });
  });

  it("an invalid lead row is rejected", () => {
    const plan = planImport(
      rows("leads_followups", [{ customer_name: "", phone: "nope", ...FU }]),
      ctx(),
    );
    expect(plan.rowSummaries[0]!.decision).toBe("error");
    expect(plan.counts.invalidRows).toBe(1);
  });
});

describe("ownership security", () => {
  it("an AGENT cannot assign a Lead to another agent via the spreadsheet", () => {
    const plan = planImport(
      rows("leads_followups", [{ ...LEAD, ...FU, agent_code: "AG-00002" }]),
      ctx(),
    );
    expect(plan.leads[0]!.decision).toBe("error");
    expect(plan.leads[0]!.issues.map((i) => i.code)).toContain("ownership_forbidden");
    expect(plan.counts.ownershipIssues).toBeGreaterThan(0);
  });

  it("an AGENT naming their OWN agent code is fine", () => {
    const plan = planImport(
      rows("leads_followups", [{ ...LEAD, ...FU, agent_code: "AG-00001" }]),
      ctx(),
    );
    expect(plan.leads[0]!.decision).toBe("new");
  });

  it("ADMIN import requires an owner (agent_code or closer_code)", () => {
    const admin = ctx({ actor: { role: "admin", userId: 1, agentId: null, agentCode: null } });
    const plan = planImport(rows("leads", [{ ...LEAD }]), { ...admin, mode: "leads" });
    expect(plan.leads[0]!.issues.map((i) => i.code)).toContain("owner_required");
  });

  it("ADMIN can assign to a named agent", () => {
    const admin = ctx({ actor: { role: "admin", userId: 1, agentId: null, agentCode: null } });
    const plan = planImport(rows("leads", [{ ...LEAD, agent_code: "AG-00002" }]), {
      ...admin,
      mode: "leads",
    });
    expect(plan.leads[0]).toMatchObject({
      decision: "new",
      resolvedAgentId: 101,
      resolvedAgentUserId: 11,
    });
  });

  it("ADMIN closer-only Lead → agent_id NULL, closer set, NO fake agent", () => {
    const admin = ctx({ actor: { role: "admin", userId: 1, agentId: null, agentCode: null } });
    const plan = planImport(rows("leads", [{ ...LEAD, closer_code: "CL-00001" }]), {
      ...admin,
      mode: "leads",
    });
    expect(plan.leads[0]).toMatchObject({
      decision: "new",
      resolvedAgentId: null,
      resolvedCloserId: 200,
    });
  });
});

describe("Follow-up linking", () => {
  it("links a follow-up to the NEW lead created on the same row", () => {
    const plan = planImport(rows("leads_followups", [{ ...LEAD, ...FU }]), ctx());
    expect(plan.followUps[0]).toMatchObject({
      decision: "new",
      groupKey: "phone:5125550142",
      linkExistingLeadId: null,
    });
    expect(plan.counts.followUpsToCreate).toBe(1);
  });

  it("links a follow-up to an EXISTING lead", () => {
    const c = ctx({
      existingLeadByPhone: new Map([
        ["5125550142", { id: 900, code: "TMI_00012007", agentId: 100, agentUserId: 10 }],
      ]),
    });
    const plan = planImport(rows("leads_followups", [{ ...LEAD, ...FU }]), c);
    expect(plan.followUps[0]).toMatchObject({ decision: "new", linkExistingLeadId: 900 });
  });

  it("rejects an orphan follow-up whose Lead row is invalid", () => {
    const plan = planImport(
      rows("leads_followups", [{ customer_name: "", phone: "bad", ...FU }]),
      ctx(),
    );
    expect(plan.followUps[0]!.decision).toBe("error");
    expect(plan.followUps[0]!.issues.map((i) => i.code)).toContain("orphan_follow_up");
    expect(plan.counts.invalidFollowUps).toBe(1);
  });

  it("follow-ups mode: links by existing Lead code and inherits the agent owner", () => {
    const admin = ctx({
      actor: { role: "admin", userId: 1, agentId: null, agentCode: null },
      mode: "followups",
      existingLeadByCode: new Map([
        ["TMI_00012007", { id: 900, code: "TMI_00012007", agentId: 100, agentUserId: 10 }],
      ]),
    });
    const plan = planImport(rows("followups", [{ lead_code: "TMI_00012007", ...FU }]), admin);
    expect(plan.followUps[0]).toMatchObject({
      decision: "new",
      linkExistingLeadId: 900,
      resolvedOwnerUserId: 10,
    });
  });

  it("follow-ups mode: an unmatched Lead reference is rejected (never orphaned)", () => {
    const c = ctx({
      actor: { role: "agent", userId: 10, agentId: 100, agentCode: "AG-00001" },
      mode: "followups",
    });
    const plan = planImport(rows("followups", [{ lead_code: "TMI_99999999", ...FU }]), c);
    expect(plan.followUps[0]!.decision).toBe("error");
    expect(plan.followUps[0]!.issues.map((i) => i.code)).toContain("lead_not_found");
  });
});

describe("Closer ownership (Phase-4 correction preserved)", () => {
  it("ADMIN can import a closer-owned follow-up — closer kept, no fake agent", () => {
    const admin = ctx({ actor: { role: "admin", userId: 1, agentId: null, agentCode: null } });
    const plan = planImport(
      rows("leads_followups", [
        {
          ...LEAD,
          ...FU,
          agent_code: "AG-00001",
          followup_owner_role: "closer",
          followup_closer_code: "CL-00001",
        },
      ]),
      admin,
    );
    expect(plan.followUps[0]).toMatchObject({
      decision: "new",
      ownerRole: "closer",
      resolvedCloserId: 200,
      resolvedOwnerUserId: 20,
    });
  });

  it("an AGENT cannot import a closer-owned follow-up", () => {
    const plan = planImport(
      rows("leads_followups", [
        { ...LEAD, ...FU, followup_owner_role: "closer", followup_closer_code: "CL-00001" },
      ]),
      ctx(),
    );
    expect(plan.followUps[0]!.decision).toBe("error");
    expect(plan.followUps[0]!.issues.map((i) => i.code)).toContain("ownership_forbidden");
  });
});

describe("mixed batch", () => {
  it("counts new / existing / duplicate / invalid across many rows", () => {
    const c = ctx({
      existingLeadByPhone: new Map([
        ["9990001111", { id: 900, code: "TMI_00012007", agentId: 100, agentUserId: 10 }],
      ]),
    });
    const plan = planImport(
      rows("leads_followups", [
        { customer_name: "New One", phone: "111-222-3333", ...FU },
        { customer_name: "Existing", phone: "999-000-1111", ...FU },
        { customer_name: "Dup", phone: "111 222 3333", ...FU },
        { customer_name: "", phone: "bad", ...FU },
      ]),
      c,
    );
    expect(plan.counts).toMatchObject({
      totalRows: 4,
      newLeads: 1,
      existingLeads: 1,
      duplicateRows: 1,
      invalidRows: 1,
    });
    expect(plan.canCommit).toBe(true);
  });
});
