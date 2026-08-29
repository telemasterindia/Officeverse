/**
 * Officeverse — bulk-import PLANNING (Phase 7). PURE. No DB.
 *
 * Given normalised rows + an injected lookup context (existing leads, staff
 * codes), classify every row and resolve ownership WITHOUT trusting the
 * spreadsheet. The service layer gathers the context from repos, calls this,
 * shows the preview, then executes the same plan on commit.
 *
 * Guarantees encoded here:
 *   - Lead identity = normalised phone (the project's established key). An
 *     existing Lead is NEVER overwritten — it is reported "existing".
 *   - A repeated phone inside one file is "duplicate", not a second Lead.
 *   - Every follow-up links to a NEW lead in this file (via groupKey) or an
 *     EXISTING lead (resolved id) — otherwise it is rejected. No orphans.
 *   - Agent importers cannot assign to another agent or create closer-owned
 *     follow-ups. Admin importers assign only where the schema allows.
 *   - Closer-owned rows keep their closer; no fake agent is invented.
 */
import type { ImportMode } from "@/lib/officeverse/import/fields";
import type { ImportCounts, RowIssue, RowPlanSummary } from "@/lib/officeverse/import/types";
import type { NormalizedFollowUp, NormalizedLead, NormalizedRow } from "./normalize-row";

export interface ExistingLeadRef {
  id: number;
  code: string;
  agentId: number | null;
  agentUserId: number | null;
}
export interface StaffRef {
  id: number;
  userId: number;
  code: string;
}

export interface PlanActor {
  role: "admin" | "agent" | "closer" | "hr";
  userId: number;
  /** the importing agent's agents.id + code (role === "agent") */
  agentId: number | null;
  agentCode: string | null;
}

export interface PlanContext {
  actor: PlanActor;
  mode: ImportMode;
  existingLeadByPhone: Map<string, ExistingLeadRef>;
  existingLeadByCode: Map<string, ExistingLeadRef>;
  agentByCode: Map<string, StaffRef>;
  closerByCode: Map<string, StaffRef>;
}

export interface LeadPlan {
  groupKey: string;
  decision: "new" | "existing" | "duplicate" | "error";
  sourceRowNumber: number;
  existingLeadId: number | null;
  existingLeadCode: string | null;
  draft: NormalizedLead | null;
  resolvedAgentId: number | null;
  resolvedAgentUserId: number | null;
  resolvedCloserId: number | null;
  issues: RowIssue[];
}

export interface FollowUpPlan {
  rowNumber: number;
  groupKey: string | null;
  decision: "new" | "error";
  draft: NormalizedFollowUp | null;
  ownerRole: "agent" | "closer";
  resolvedOwnerUserId: number | null;
  resolvedCloserId: number | null;
  linkExistingLeadId: number | null;
  captureDate: string | null;
  issues: RowIssue[];
}

export interface ImportPlan {
  leads: LeadPlan[];
  followUps: FollowUpPlan[];
  rowSummaries: RowPlanSummary[];
  counts: ImportCounts;
  issues: RowIssue[];
  canCommit: boolean;
}

const err = (rowNumber: number, field: string | null, code: string, message: string): RowIssue => ({
  rowNumber,
  field,
  code,
  message,
  severity: "error",
});

function groupKeyFor(row: NormalizedRow, mode: ImportMode): string | null {
  if (row.importRef) return `ref:${row.importRef}`;
  if ((mode === "leads" || mode === "leads_followups") && row.lead?.phoneNormalized) {
    return `phone:${row.lead.phoneNormalized}`;
  }
  if (mode === "followups") {
    if (row.linkLeadCode) return `code:${row.linkLeadCode}`;
    if (row.linkPhoneNormalized) return `phone:${row.linkPhoneNormalized}`;
  }
  return null;
}

export function planImport(rows: NormalizedRow[], ctx: PlanContext): ImportPlan {
  const { actor, mode } = ctx;
  const leadByGroup = new Map<string, LeadPlan>();
  const leads: LeadPlan[] = [];
  const followUps: FollowUpPlan[] = [];
  const rowSummaries: RowPlanSummary[] = [];
  const allIssues: RowIssue[] = [];

  for (const row of rows) {
    const issues: RowIssue[] = [...row.errors];
    const warnings: RowIssue[] = [...row.warnings];
    const groupKey = groupKeyFor(row, mode);

    /* ----------------------------- lead ---------------------------- */
    let leadPlan: LeadPlan | null = null;
    if (row.lead && (mode === "leads" || mode === "leads_followups")) {
      const draft = row.lead;
      const leadUnusable = row.errors.some(
        (e) => e.field === "customer_name" || e.field === "phone",
      );

      if (leadUnusable) {
        leadPlan = mkLeadPlan(groupKey ?? `row:${row.rowNumber}`, "error", row.rowNumber, draft);
        leadPlan.issues.push(
          ...row.errors.filter((e) => e.field === "customer_name" || e.field === "phone"),
        );
      } else if (groupKey && leadByGroup.has(groupKey)) {
        // second row for the same Lead → duplicate (its follow-up still links)
        leadPlan = mkLeadPlan(groupKey, "duplicate", row.rowNumber, draft);
      } else {
        leadPlan = classifyNewLead(groupKey ?? `row:${row.rowNumber}`, row.rowNumber, draft, ctx);
        if (groupKey) leadByGroup.set(groupKey, leadPlan);
      }
      leads.push(leadPlan);
      issues.push(...leadPlan.issues);
    }

    /* --------------------------- follow-up ------------------------- */
    let fuPlan: FollowUpPlan | null = null;
    if (row.followUp) {
      fuPlan = classifyFollowUp(row, groupKey, leadByGroup.get(groupKey ?? ""), ctx);
      followUps.push(fuPlan);
      issues.push(...fuPlan.issues);
    }

    const rowErrors = issues.filter((i) => i.severity === "error");
    const decision: RowPlanSummary["decision"] = rowErrors.length
      ? "error"
      : leadPlan
        ? leadPlan.decision
        : fuPlan
          ? "new"
          : "skip";

    rowSummaries.push({
      rowNumber: row.rowNumber,
      decision,
      leadCode: leadPlan?.existingLeadCode ?? null,
      leadName: row.lead?.customerName ?? null,
      createsFollowUp: Boolean(fuPlan && fuPlan.decision === "new"),
      issues: [...rowErrors, ...warnings],
    });
    allIssues.push(...rowErrors, ...warnings);
  }

  /* ----------------------------- counts --------------------------- */
  const distinctNew = new Set(leads.filter((l) => l.decision === "new").map((l) => l.groupKey));
  const distinctExisting = new Set(
    leads.filter((l) => l.decision === "existing").map((l) => l.groupKey),
  );
  const validFu = followUps.filter((f) => f.decision === "new");
  const invalidFu = followUps.filter((f) => f.decision === "error");
  const ownershipIssues = allIssues.filter((i) =>
    /ownership|owner_required|forbidden|no_agent_owner/.test(i.code),
  ).length;

  const counts: ImportCounts = {
    totalRows: rows.length,
    validRows: rowSummaries.filter((r) => r.decision !== "error").length,
    invalidRows: rowSummaries.filter((r) => r.decision === "error").length,
    newLeads: distinctNew.size,
    existingLeads: distinctExisting.size,
    duplicateRows: rowSummaries.filter((r) => r.decision === "duplicate").length,
    followUpsToCreate: validFu.length,
    invalidFollowUps: invalidFu.length,
    ownershipIssues,
  };

  return {
    leads,
    followUps,
    rowSummaries,
    counts,
    issues: allIssues,
    canCommit: distinctNew.size > 0 || validFu.length > 0,
  };
}

/* ---------------------------- internals ---------------------------- */

function mkLeadPlan(
  groupKey: string,
  decision: LeadPlan["decision"],
  rowNumber: number,
  draft: NormalizedLead | null,
): LeadPlan {
  return {
    groupKey,
    decision,
    sourceRowNumber: rowNumber,
    existingLeadId: null,
    existingLeadCode: null,
    draft,
    resolvedAgentId: null,
    resolvedAgentUserId: null,
    resolvedCloserId: null,
    issues: [],
  };
}

function classifyNewLead(
  groupKey: string,
  rowNumber: number,
  draft: NormalizedLead,
  ctx: PlanContext,
): LeadPlan {
  const plan = mkLeadPlan(groupKey, "new", rowNumber, draft);
  const { actor } = ctx;

  // ---- ownership ----
  if (actor.role === "agent") {
    if (draft.agentCode && draft.agentCode !== actor.agentCode) {
      plan.decision = "error";
      plan.issues.push(
        err(
          rowNumber,
          "agent_code",
          "ownership_forbidden",
          "Agents may only import their own Leads",
        ),
      );
    }
    plan.resolvedAgentId = actor.agentId;
    plan.resolvedAgentUserId = actor.userId;
  } else if (actor.role === "admin") {
    if (draft.agentCode) {
      const a = ctx.agentByCode.get(draft.agentCode);
      if (!a) {
        plan.decision = "error";
        plan.issues.push(
          err(rowNumber, "agent_code", "agent_not_found", `Agent "${draft.agentCode}" not found`),
        );
      } else {
        plan.resolvedAgentId = a.id;
        plan.resolvedAgentUserId = a.userId;
      }
    } else if (!draft.closerCode) {
      plan.decision = "error";
      plan.issues.push(
        err(
          rowNumber,
          "agent_code",
          "owner_required",
          "Admin imports need agent_code (or closer_code for a closer-owned Lead)",
        ),
      );
    }
    // agent_code absent + closer_code present → closer-originated Lead (agent_id NULL)
  } else {
    plan.decision = "error";
    plan.issues.push(err(rowNumber, null, "ownership_forbidden", "Your role cannot bulk import"));
  }

  // ---- closer on the lead ----
  if (draft.closerCode) {
    const c = ctx.closerByCode.get(draft.closerCode);
    if (!c) {
      plan.decision = "error";
      plan.issues.push(
        err(rowNumber, "closer_code", "closer_not_found", `Closer "${draft.closerCode}" not found`),
      );
    } else {
      plan.resolvedCloserId = c.id;
    }
  }

  // ---- duplicate detection (identity = normalised phone) ----
  if (plan.decision === "new" && draft.phoneNormalized) {
    const existing = ctx.existingLeadByPhone.get(draft.phoneNormalized);
    if (existing) {
      plan.decision = "existing";
      plan.existingLeadId = existing.id;
      plan.existingLeadCode = existing.code;
    }
  }

  return plan;
}

function classifyFollowUp(
  row: NormalizedRow,
  groupKey: string | null,
  groupLead: LeadPlan | undefined,
  ctx: PlanContext,
): FollowUpPlan {
  const { actor, mode } = ctx;
  const draft = row.followUp!;
  const plan: FollowUpPlan = {
    rowNumber: row.rowNumber,
    groupKey,
    decision: "new",
    draft,
    ownerRole: draft.ownerRole,
    resolvedOwnerUserId: null,
    resolvedCloserId: null,
    linkExistingLeadId: null,
    captureDate: draft.captureDate,
    issues: [],
  };

  const fail = (field: string | null, code: string, message: string) => {
    plan.decision = "error";
    plan.issues.push(err(row.rowNumber, field, code, message));
  };

  if (row.errors.some((e) => /^followup_/.test(e.field ?? ""))) {
    plan.decision = "error";
    return plan;
  }

  // ---- agent importers may not create closer-owned follow-ups ----
  if (actor.role === "agent" && draft.ownerRole === "closer") {
    fail(
      "followup_owner_role",
      "ownership_forbidden",
      "Agents cannot import closer-owned follow-ups",
    );
  }

  // ---- resolve the owner ----
  if (draft.ownerRole === "closer") {
    const c = draft.closerCode ? ctx.closerByCode.get(draft.closerCode) : undefined;
    if (!c)
      fail(
        "followup_closer_code",
        "closer_not_found",
        `Closer "${draft.closerCode ?? ""}" not found`,
      );
    else {
      plan.resolvedCloserId = c.id;
      plan.resolvedOwnerUserId = c.userId;
    }
  } else {
    // agent-owned follow-up
    if (actor.role === "agent") {
      plan.resolvedOwnerUserId = actor.userId;
    } else if (mode === "followups") {
      const link = resolveLink(row, ctx);
      if (link?.agentUserId) plan.resolvedOwnerUserId = link.agentUserId;
      else fail(null, "no_agent_owner", "Cannot determine an agent owner for this follow-up");
    } else if (groupLead) {
      if (groupLead.resolvedAgentUserId) plan.resolvedOwnerUserId = groupLead.resolvedAgentUserId;
      else
        fail(null, "no_agent_owner", "This Lead has no agent — the follow-up must be closer-owned");
    }
  }

  // ---- link to a Lead (never orphan) ----
  if (mode === "followups") {
    const link = resolveLink(row, ctx);
    if (!link) fail("lead_code", "lead_not_found", "No existing Lead matches this reference");
    else plan.linkExistingLeadId = link.id;
  } else {
    // leads_followups: link to this row's Lead group
    if (!groupLead) {
      fail(null, "orphan_follow_up", "Follow-up has no Lead on this row");
    } else if (groupLead.decision === "error") {
      fail(null, "orphan_follow_up", "The Lead on this row is invalid");
    } else if (groupLead.decision === "existing") {
      plan.linkExistingLeadId = groupLead.existingLeadId;
    }
    // NEW lead → linked at commit time via groupKey
  }

  return plan;
}

function resolveLink(row: NormalizedRow, ctx: PlanContext): ExistingLeadRef | null {
  if (row.linkLeadCode) {
    const byCode = ctx.existingLeadByCode.get(row.linkLeadCode);
    if (byCode) return byCode;
  }
  if (row.linkPhoneNormalized) {
    const byPhone = ctx.existingLeadByPhone.get(row.linkPhoneNormalized);
    if (byPhone) return byPhone;
  }
  return null;
}
