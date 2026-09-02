/**
 * Phase 24A — REAL Lead & Follow-up lifecycle wiring.
 *
 * The New-Lead / New-Follow-up / lead-detail / follow-up-detail screens were
 * moved off the client-side localStorage demo stores onto the authoritative
 * server functions (src/lib/officeverse/{lead,followup}-fns.ts →
 * src/server/{leads,followups}/service.ts → MySQL).
 *
 * These are the focused regressions for the 17 guarantees in the brief. They
 * are pure — they exercise the server-side authorization predicates, the Zod
 * boundary schemas, the canonical ID generators and the DTO mappers, plus
 * static wiring checks that the client never re-implements business logic or
 * writes authoritative state to localStorage. The end-to-end DB run is done
 * separately against the local dryrun database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertCanCreateLead,
  canCreateLead,
  canReadLead,
  canTransferLead,
  type LeadActor,
} from "../authz/leads";
import {
  assertCanConvertFollowUp,
  canConvertFollowUp,
  canCreateFollowUp,
  canTransition,
  type FollowUpActor,
} from "../authz/followups";
import { followUpCode, leadCode, nextFollowUpSeq, nextLeadSeq } from "../ids";
import { toLeadDTO } from "../leads/dto";
import { toFollowUpDTO } from "../followups/dto";
import { createLeadSchema, transferLeadSchema } from "../validation/leads";
import { convertSchema, createFollowUpSchema } from "../validation/followups";

const root = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
/** Source with block + line comments removed — so prose in a header doc-comment
 *  (which legitimately says "not localStorage-backed") never trips a code scan. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const leadFns = read("lib", "officeverse", "lead-fns.ts");
const followUpFns = read("lib", "officeverse", "followup-fns.ts");
const leadService = read("server", "leads", "service.ts");
const followUpService = read("server", "followups", "service.ts");
const hooks = read("lib", "officeverse", "use-lead-lifecycle.ts");
const routeFiles = [
  "_shell.leads.new.tsx",
  "_shell.leads.index.tsx",
  "_shell.leads.$leadId.tsx",
  "_shell.followups.index.tsx",
  "_shell.followups.$followUpId.tsx",
].map((f) => ({ f, src: read("routes", f) }));

const agent = (agentId: number): LeadActor => ({
  user: { id: agentId * 10, role: "agent" },
  agentId,
  closerId: null,
});
const closer = (closerId: number): LeadActor => ({
  user: { id: closerId * 10, role: "closer" },
  agentId: null,
  closerId,
});
const fuActor = (id: number, role: FollowUpActor["user"]["role"] = "agent"): FollowUpActor => ({
  user: { id, role },
});

const validLead = {
  customer_name: "Jane Doe",
  phone: "(305) 555-2001",
  email: "jane@example.com",
  debt_amount: 12345,
  current_late: "Late" as const,
  comment: "captured from dialer",
  assigned_closer_code: "CL-90001",
};
const validFollowUp = {
  full_name: "Jane Doe",
  phone: "(305) 555-3001",
  email: "jane@example.com",
  debt_amount: 4000,
  current_late: "Current" as const,
  comment: "call back",
  scheduled_date: "2026-09-15",
  scheduled_time: "10:30",
};

/* 1 ---------------------------------------------------------------- */
describe("1. an authenticated Agent can create a Lead through the real server path", () => {
  it("the Agent role is authorised by the pure predicate", () => {
    expect(canCreateLead(agent(1))).toBe(true);
    expect(() => assertCanCreateLead(agent(1))).not.toThrow();
  });
  it("createLeadFn delegates to the Lead service after requireRole", () => {
    expect(leadFns).toMatch(/createLeadFn\s*=\s*createServerFn\(\{\s*method:\s*"POST"\s*\}\)/);
    expect(leadFns).toMatch(/requireRole\("admin",\s*"agent"\)/);
    expect(leadFns).toMatch(/svc\.createLead\(user,\s*data/);
  });
});

/* 2 ---------------------------------------------------------------- */
describe("2. an unauthorized user cannot create a Lead", () => {
  it("a Closer / unknown role is denied by the predicate", () => {
    expect(canCreateLead(closer(1))).toBe(false);
    expect(() => assertCanCreateLead(closer(1))).toThrow(/Not authorized to create leads/);
  });
  it("the client cannot widen the role — the server function re-checks", () => {
    // no createLead endpoint is reachable without requireRole
    expect(leadFns).not.toMatch(/createLeadFn[\s\S]{0,200}requireUser\(\)/);
  });
});

/* 3 ---------------------------------------------------------------- */
describe("3. a Lead persists in the real database (not localStorage)", () => {
  it("the service writes through the leads repository / Drizzle, never a browser store", () => {
    expect(leadService).toMatch(/from "\.\.\/db\/repos\/leads"/);
    expect(leadService).toMatch(/repo\.(insert|createLead|create)\w*/);
    expect(leadService).not.toMatch(/localStorage/);
  });
});

/* 4 ---------------------------------------------------------------- */
describe("4. the Lead ID is server-generated (TMI_########)", () => {
  it("the generator preserves the canonical format + start/step", () => {
    expect(leadCode(nextLeadSeq(12056))).toBe("TMI_00012063");
    expect(leadCode(1)).toMatch(/^TMI_\d{8}$/);
  });
  it("the create schema has no lead_id / lead_code field for a client to supply", () => {
    const parsed = createLeadSchema.parse({
      ...validLead,
      lead_id: "TMI_00000001",
      lead_code: "TMI_00000001",
      leadCode: "TMI_00000001",
    });
    expect(parsed).not.toHaveProperty("lead_id");
    expect(parsed).not.toHaveProperty("lead_code");
    expect(parsed).not.toHaveProperty("leadCode");
  });
});

/* 5 ---------------------------------------------------------------- */
describe("5. duplicate creation behaviour is controlled by the server", () => {
  it("the New-Lead screen no longer ships the client-side duplicate table", () => {
    const newLead = routeFiles.find((r) => r.f === "_shell.leads.new.tsx")!.src;
    expect(newLead).not.toMatch(/DUPLICATE_PHONES/);
    expect(newLead).toMatch(/useCreateServerLead/);
    // inline duplicate feedback comes from the authoritative DB check, and the
    // server still re-validates + re-checks on submit (never a bypass)
    expect(newLead).toMatch(/useLeadDuplicateCheck/);
    expect(newLead).toMatch(/server ALSO re-validates \+ re-checks/i);
  });
});

/* 6 ---------------------------------------------------------------- */
describe("6. an authenticated Agent can create a Follow-up", () => {
  it("agent + closer roles are authorised; admin/hr are not", () => {
    expect(canCreateFollowUp(fuActor(1, "agent"))).toBe(true);
    expect(canCreateFollowUp(fuActor(1, "closer"))).toBe(true);
    expect(canCreateFollowUp(fuActor(1, "admin"))).toBe(false);
  });
  it("a well-formed payload passes the boundary schema", () => {
    expect(() => createFollowUpSchema.parse(validFollowUp)).not.toThrow();
  });
  it("createFollowUpFn delegates to the service after requireUser", () => {
    expect(followUpFns).toMatch(
      /createFollowUpFn\s*=\s*createServerFn\(\{\s*method:\s*"POST"\s*\}\)/,
    );
    expect(followUpFns).toMatch(/svc\.createFollowUp\(user,\s*data/);
  });
});

/* 7 ---------------------------------------------------------------- */
describe("7. a Follow-up persists in the real database", () => {
  it("the service writes through the follow-ups repository, never localStorage", () => {
    expect(followUpService).toMatch(/repos\/followups/);
    expect(followUpService).not.toMatch(/localStorage/);
  });
});

/* 8 ---------------------------------------------------------------- */
describe("8. the Follow-up ID is server-generated (FU_########)", () => {
  it("the generator preserves the canonical format + start/step", () => {
    expect(followUpCode(nextFollowUpSeq(94430))).toBe("FU_00094433");
    expect(followUpCode(1)).toMatch(/^FU_\d{8}$/);
  });
  it("the create schema has no follow_up_id field", () => {
    const parsed = createFollowUpSchema.parse({
      ...validFollowUp,
      follow_up_id: "FU_00000001",
      followUpCode: "FU_00000001",
    });
    expect(parsed).not.toHaveProperty("follow_up_id");
    expect(parsed).not.toHaveProperty("followUpCode");
  });
});

/* 9 ---------------------------------------------------------------- */
describe("9. assignment permissions remain enforced", () => {
  it("only the originating agent (or admin) may transfer, and only before it is assigned", () => {
    const unassigned = { agentId: 1, assignedCloserId: null, status: "NEW" as const };
    expect(canTransferLead(agent(1), unassigned)).toEqual({ ok: true });
    expect(canTransferLead(agent(2), unassigned)).toMatchObject({ ok: false, code: "not_owner" });
    expect(canTransferLead(closer(1), unassigned)).toMatchObject({
      ok: false,
      code: "role_forbidden",
    });
    expect(
      canTransferLead(agent(1), { agentId: 1, assignedCloserId: 9, status: "ASSIGNED" }),
    ).toMatchObject({ ok: false, code: "already_transferred" });
  });
  it("the transfer target must be a canonical closer code", () => {
    expect(() =>
      transferLeadSchema.parse({ code: "TMI_00012000", to_closer_code: "CL-90002" }),
    ).not.toThrow();
    expect(() =>
      transferLeadSchema.parse({ code: "TMI_00012000", to_closer_code: "bob" }),
    ).toThrow();
  });
});

/* 10 --------------------------------------------------------------- */
describe("10. US / India process separation remains enforced", () => {
  it("an agent cannot read another agent's lead; a closer cannot read another closer's", () => {
    // A US lead belongs to agentId 1 / closerId 5; an India agent (agentId 2)
    // and India closer (closerId 9) resolve to different ids and are refused —
    // this is exactly the '"Not authorized to view this lead"' seen live.
    expect(canReadLead(agent(2), { agentId: 1, assignedCloserId: 5 })).toBe(false);
    expect(canReadLead(closer(9), { agentId: 1, assignedCloserId: 5 })).toBe(false);
    expect(canReadLead(agent(1), { agentId: 1, assignedCloserId: 5 })).toBe(true);
  });
  it("the server derives process from the session, never the request body", () => {
    expect(leadService).toMatch(/user\.process/);
    expect(createLeadSchema.parse({ ...validLead, process: "IN" })).not.toHaveProperty("process");
  });
});

/* 11 --------------------------------------------------------------- */
describe("11. Follow-up → Lead conversion is atomic", () => {
  it("convertFollowUpToLead runs inside a single DB transaction", () => {
    const body = followUpService.slice(followUpService.indexOf("function convertFollowUpToLead"));
    expect(body).toMatch(/getDb\(\)\.transaction\(async \(tx\) =>/);
  });
});

/* 12 --------------------------------------------------------------- */
describe("12. conversion is idempotent", () => {
  it("a second convert of an already-CONVERTED follow-up is refused (no new lead)", () => {
    const converted = { ownerUserId: 10, status: "CONVERTED" as const };
    expect(canConvertFollowUp(fuActor(10), converted)).toMatchObject({ ok: false });
    expect(() => assertCanConvertFollowUp(fuActor(10), converted)).toThrow();
    expect(canTransition("CONVERTED", "convert")).toMatchObject({
      ok: false,
      code: "already_converted",
    });
  });
});

/* 13 --------------------------------------------------------------- */
describe("13. converted Follow-up and Lead stay bidirectionally traceable", () => {
  it("the Lead DTO flags its follow-up origin and the Follow-up DTO carries the lead code", () => {
    const leadRow = {
      leadCode: "TMI_00012070",
      shiftDate: "2026-08-30",
      customerName: "Jane Doe",
      phone: "555",
      email: null,
      address: null,
      city: null,
      state: null,
      zip: null,
      debtAmount: "4000.00",
      creditStatus: null,
      currentDebts: "Current",
      leadFile: null,
      comments: null,
      status: "ASSIGNED",
      source: "conversion",
      convertedFromFollowUpId: 11,
    } as unknown as Parameters<typeof toLeadDTO>[0];
    const leadDto = toLeadDTO(leadRow);
    expect(leadDto.converted_from_follow_up).toBe(true);
    expect(leadDto.source).toBe("conversion");

    const fuRow = {
      followUpCode: "FU_00094433",
      ownerRole: "agent",
      customerName: "Jane Doe",
      phone: "555",
      email: null,
      address: null,
      city: null,
      state: null,
      zip: null,
      debtAmount: "4000.00",
      creditStatus: null,
      currentDebts: "Current",
      comment: null,
      captureDate: "2026-08-30",
      scheduledAt: "2026-09-15 10:30:00",
      status: "CONVERTED",
      convertedLeadCode: "TMI_00012070",
      convertedAt: "2026-08-30 12:00:00",
      completedAt: null,
      cancelledAt: null,
      createdAt: "2026-08-30 09:00:00",
      updatedAt: "2026-08-30 12:00:00",
    } as unknown as Parameters<typeof toFollowUpDTO>[0];
    const fuDto = toFollowUpDTO(fuRow, []);
    expect(fuDto.status).toBe("CONVERTED");
    expect(fuDto.converted_lead_id).toBe("TMI_00012070");
    expect(fuDto.lead_id).toBe("TMI_00012070");
  });
});

/* 14 --------------------------------------------------------------- */
describe("14. gamification remains server-authoritative", () => {
  it("recognition + scoring fire server-side from the Lead service (Phase 5: one canonical BusinessEvent)", () => {
    // LEAD_SUBMITTED now flows through the event layer; LEAD_ACCEPTED / SALE
    // recognition is still the direct call (not migrated).
    expect(leadService).toMatch(/emitBusinessEvent\(\s*\n?\s*buildLeadSubmittedEvent\(/);
    expect(leadService).toMatch(/from "\.\.\/live\/recognition"/);
    expect(leadService).toMatch(/recognizeSafe\(onLeadAccepted\(/);
  });
  it("the client hooks contain no points / ledger / recognition logic", () => {
    expect(code(hooks)).not.toMatch(/points|ledger|recognize|gamification/i);
  });
});

/* 15 --------------------------------------------------------------- */
describe("15. Office TV events remain server-authoritative", () => {
  it("no client file emits Office-TV events; they come from server recognition", () => {
    expect(code(hooks)).not.toMatch(/officeTv|office_tv|tv[_-]?event/i);
    for (const { src } of routeFiles) {
      expect(code(src)).not.toMatch(/officeTvEvents|office_tv_events|emitTv|pushTvEvent/);
    }
  });
});

/* 16 --------------------------------------------------------------- */
describe("16. the client cannot inject user / role / process / points / assignment authority", () => {
  it("createLeadSchema strips every non-whitelisted key", () => {
    const parsed = createLeadSchema.parse({
      ...validLead,
      agent_id: 99,
      assigned_closer_id: 5,
      user_id: 1,
      role: "admin",
      process: "IN",
      points: 999,
      rank: 1,
      audit_actor: "someone",
      source: "conversion",
    }) as Record<string, unknown>;
    for (const k of [
      "agent_id",
      "assigned_closer_id",
      "user_id",
      "role",
      "process",
      "points",
      "rank",
      "audit_actor",
      "source",
    ]) {
      expect(parsed).not.toHaveProperty(k);
    }
  });
  it("createFollowUpSchema strips every non-whitelisted key", () => {
    const parsed = createFollowUpSchema.parse({
      ...validFollowUp,
      owner_id: 42,
      owner_role: "closer",
      user_id: 1,
      role: "admin",
      process: "US",
      points: 5,
    }) as Record<string, unknown>;
    for (const k of ["owner_id", "owner_role", "user_id", "role", "process", "points"]) {
      expect(parsed).not.toHaveProperty(k);
    }
  });
  it("convertSchema only accepts a target closer code + note", () => {
    const parsed = convertSchema.parse({
      code: "FU_00094433",
      to_closer_code: "CL-90002",
      note: "x",
      actor: "hacker",
      process: "IN",
      closer: "CL-99999",
    }) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("actor");
    expect(parsed).not.toHaveProperty("process");
    expect(parsed).not.toHaveProperty("closer");
  });
});

/* 17 --------------------------------------------------------------- */
describe("17. localStorage is not authoritative for real mutations", () => {
  it("the rewired route screens import the server hooks, not the demo stores", () => {
    for (const { f, src } of routeFiles) {
      expect(src, f).toMatch(/@\/lib\/officeverse\/use-lead-lifecycle/);
      expect(code(src), f).not.toMatch(/use-crm/);
      expect(code(src), f).not.toMatch(/from "@\/lib\/officeverse\/(leads|data)"/);
      expect(code(src), f).not.toMatch(/\blocalStorage\b/);
    }
  });
  it("the server hooks module is purely React-Query over the server functions", () => {
    expect(code(hooks)).not.toMatch(/\blocalStorage\b/);
    expect(hooks).toMatch(/from "\.\/lead-fns"/);
    expect(hooks).toMatch(/from "\.\/followup-fns"/);
  });
});
