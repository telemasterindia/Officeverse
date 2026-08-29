/**
 * Officeverse — Lead service (Phase 3).
 *
 * Orchestration between the API server functions, the pure authorization
 * predicates (../authz/leads.ts) and the repositories. Every mutation:
 *   1. resolves the actor from the authenticated session (never trusts the body)
 *   2. asserts authorization SERVER-SIDE
 *   3. validates was already done by Zod at the API boundary
 *   4. persists via the repo
 *   5. records an audit event for security/business-significant changes
 *   6. returns a client-safe DTO
 */
import { eq } from "drizzle-orm";
import { recordAudit } from "../audit";
import {
  assertCanCreateLead,
  assertCanReadLead,
  assertCanTransferLead,
  assertCanUpdateLead,
  canSetLeadStatus,
  filterUpdatablePatch,
  leadScope,
  type LeadActor,
} from "../authz/leads";
import { HttpError } from "../http-error";
import { normalizeEmail, normalizePhone } from "../normalize";
import { currentShiftDate, nowIST } from "../time";
import { toLeadDTO, type LeadDTO } from "./dto";
import * as repo from "../db/repos/leads";
import {
  getAgentByCode,
  getAgentByUserId,
  getAgentWithUser,
  getCloserByCode,
  getCloserWithUser,
  loadAgentMeta,
  loadCloserMeta,
  resolveLeadActor,
} from "../db/repos/staff";
import { onLeadAccepted, onLeadSubmitted, onSale, recognizeSafe } from "../live/recognition";
import { leads } from "@/lib/db/schema";
import type { Lead, NewLead, User } from "@/lib/db/schema";
import type { CreateLeadInput, ListLeadsInput, UpdateLeadInput } from "../validation/leads";

/** Request metadata for audit (matches context.RequestInfo; kept local to avoid a cycle). */
type Meta = { ip?: string | null; userAgent?: string | null };

/* ------------------------------- hydrate ------------------------------- */

async function hydrate(rows: Lead[]): Promise<LeadDTO[]> {
  if (!rows.length) return [];
  // agentId is nullable (a closer-owned follow-up converts with no originating agent).
  const agentIds = [...new Set(rows.map((r) => r.agentId).filter((x): x is number => x != null))];
  const closerIds = [
    ...new Set(rows.map((r) => r.assignedCloserId).filter((x): x is number => x != null)),
  ];
  const [agentMeta, closerMeta] = await Promise.all([
    loadAgentMeta(agentIds),
    loadCloserMeta(closerIds),
  ]);
  return rows.map((r) =>
    toLeadDTO(r, {
      agentCode: r.agentId != null ? (agentMeta.get(r.agentId)?.code ?? null) : null,
      agentName: r.agentId != null ? (agentMeta.get(r.agentId)?.name ?? null) : null,
      closerCode:
        r.assignedCloserId != null ? (closerMeta.get(r.assignedCloserId)?.code ?? null) : null,
      closerName:
        r.assignedCloserId != null ? (closerMeta.get(r.assignedCloserId)?.name ?? null) : null,
    }),
  );
}

async function hydrateOne(row: Lead): Promise<LeadDTO> {
  return (await hydrate([row]))[0]!;
}

/* --------------------------------- list ------------------------------- */

export interface ListLeadsResult {
  leads: LeadDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listLeads(user: User, input: ListLeadsInput): Promise<ListLeadsResult> {
  const actor = await resolveLeadActor(user);
  const scope = leadScope(actor);

  const page = input.page;
  const pageSize = input.pageSize;
  const empty: ListLeadsResult = { leads: [], page, pageSize, total: 0, totalPages: 0 };
  if (scope.kind === "none") return empty;

  let scopeSql;
  if (scope.kind === "agent") scopeSql = eq(leads.agentId, scope.agentId);
  else if (scope.kind === "closer") scopeSql = eq(leads.assignedCloserId, scope.closerId);
  else scopeSql = undefined; // "all"

  // Admin-only filters — silently ignored for non-admin callers.
  let closerId: number | undefined;
  let agentId: number | undefined;
  if (actor.user.role === "admin") {
    if (input.closerCode) closerId = (await getCloserByCode(input.closerCode))?.id;
    if (input.agentCode) agentId = (await getAgentByCode(input.agentCode))?.id;
    if (input.closerCode && closerId == null) return empty;
    if (input.agentCode && agentId == null) return empty;
  }

  const { rows, total } = await repo.listLeads({
    scope: scopeSql,
    status: input.status as Lead["status"] | undefined,
    q: input.q,
    qDigits: input.q ? input.q.replace(/\D/g, "") : undefined,
    shiftDateFrom: input.shiftDateFrom,
    shiftDateTo: input.shiftDateTo,
    closerId,
    agentId,
    sort: input.sort,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return {
    leads: await hydrate(rows),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/* --------------------------------- get ------------------------------- */

export async function getLead(user: User, code: string): Promise<LeadDTO> {
  const row = await repo.getLeadByCode(code);
  if (!row) throw new HttpError(404, "Lead not found", "not_found");
  const actor = await resolveLeadActor(user);
  assertCanReadLead(actor, row);
  return hydrateOne(row);
}

/* ------------------------------- create ------------------------------ */

export async function createLead(
  user: User,
  input: CreateLeadInput,
  meta: Meta = {},
): Promise<LeadDTO> {
  const actor = await resolveLeadActor(user);
  assertCanCreateLead(actor);

  // Resolve the submitting agent (identity is derived, not trusted from body).
  let agentId: number;
  if (user.role === "agent") {
    const a = await getAgentByUserId(user.id);
    if (!a) throw new HttpError(409, "Your user has no agent profile", "no_agent_profile");
    agentId = a.id;
  } else {
    if (!input.agent_code) {
      throw new HttpError(
        400,
        "agent_code is required when an admin creates a lead",
        "agent_code_required",
      );
    }
    const a = await getAgentByCode(input.agent_code);
    if (!a) throw new HttpError(404, `Agent ${input.agent_code} not found`, "agent_not_found");
    agentId = a.id;
  }

  const agentWithUser = await getAgentWithUser(agentId);
  const process = agentWithUser?.user.process ?? user.process;
  const shiftDate = input.date ?? currentShiftDate(process);

  // Optional: create already-transferred to a closer.
  let assignedCloserId: number | null = null;
  if (input.assigned_closer_code) {
    const c = await getCloserByCode(input.assigned_closer_code);
    if (!c) {
      throw new HttpError(
        404,
        `Closer ${input.assigned_closer_code} not found`,
        "closer_not_found",
      );
    }
    assignedCloserId = c.id;
  }

  const now = nowIST();
  const base: Omit<NewLead, "leadCode"> = {
    shiftDate,
    customerName: input.customer_name.trim(),
    phone: input.phone.trim(),
    phoneNormalized: normalizePhone(input.phone),
    email: input.email ? input.email.trim() : null,
    emailNormalized: normalizeEmail(input.email),
    address: input.address ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    zip: input.zip ?? null,
    debtAmount: input.debt_amount != null ? String(input.debt_amount) : "0.00",
    creditStatus: input.credit ?? null,
    currentDebts: input.current_late ?? "Current",
    leadFile: input.file_name ?? null,
    comments: input.comment ?? null,
    agentId,
    assignedCloserId,
    status: assignedCloserId != null ? "ASSIGNED" : "NEW",
    source: "app",
    createdAt: now,
    updatedAt: now,
  };

  // Insert with a single retry on the lead_code unique race.
  let row: Lead | undefined;
  for (let attempt = 0; attempt < 2 && !row; attempt++) {
    const leadCode = await repo.nextLeadCode();
    try {
      row = await repo.insertLead({ ...base, leadCode });
    } catch (err) {
      if (attempt === 1 || !isDuplicateKey(err)) throw err;
    }
  }
  if (!row) throw new HttpError(500, "Could not allocate a Lead ID", "id_alloc_failed");

  if (assignedCloserId != null) {
    await repo.insertAssignment({
      leadId: row.id,
      fromCloserId: null,
      toCloserId: assignedCloserId,
      action: "assign",
      byUserId: user.id,
      note: null,
      createdAt: now,
    });
  }

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "lead.create",
    entityType: "lead",
    entityId: row.id,
    entityCode: row.leadCode,
    metadata: {
      shift_date: shiftDate,
      agent_id: agentId,
      transferred_on_create: assignedCloserId != null,
      ...(assignedCloserId != null ? { to_closer_code: input.assigned_closer_code } : {}),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  // Phase 21: server-confirmed lead submission → Office TV recognition.
  // Best-effort; never blocks or fails lead creation. Follow-up activity does
  // NOT go through here.
  const submitterUserId = user.role === "agent" ? user.id : (agentWithUser?.user.id ?? null);
  if (submitterUserId != null) {
    recognizeSafe(onLeadSubmitted({ agentUserId: submitterUserId, leadCode: row.leadCode }));
  }

  return hydrateOne(row);
}

/* ------------------------------- update ----------------------------- */

const FIELD_TO_COLUMN: Record<string, keyof NewLead> = {
  customer_name: "customerName",
  phone: "phone",
  email: "email",
  address: "address",
  city: "city",
  state: "state",
  zip: "zip",
  debt_amount: "debtAmount",
  credit: "creditStatus",
  current_late: "currentDebts",
  file_name: "leadFile",
  comment: "comments",
  status: "status",
};

export async function updateLead(
  user: User,
  code: string,
  patch: UpdateLeadInput,
  meta: Meta = {},
): Promise<LeadDTO> {
  const row = await repo.getLeadByCode(code);
  if (!row) throw new HttpError(404, "Lead not found", "not_found");
  const actor = await resolveLeadActor(user);
  assertCanUpdateLead(actor, row);

  const { allowed, rejected } = filterUpdatablePatch(actor, patch as Record<string, unknown>);
  if (Object.keys(allowed).length === 0) {
    throw new HttpError(
      403,
      "None of the supplied fields may be changed by your role",
      "no_writable_fields",
    );
  }

  // Status change is a guarded transition (admin: any; closer: limited set).
  if ("status" in allowed && allowed["status"] !== undefined && allowed["status"] !== row.status) {
    const d = canSetLeadStatus(actor, row, allowed["status"] as Lead["status"]);
    if (!d.ok) throw new HttpError(422, d.reason, d.code);
  }

  const dbPatch: Partial<NewLead> = { updatedAt: nowIST() };
  for (const [k, v] of Object.entries(allowed)) {
    const col = FIELD_TO_COLUMN[k];
    if (!col) continue;
    if (k === "phone") {
      dbPatch.phone = String(v).trim();
      dbPatch.phoneNormalized = normalizePhone(String(v));
    } else if (k === "email") {
      const e = v ? String(v).trim() : null;
      dbPatch.email = e;
      dbPatch.emailNormalized = normalizeEmail(e);
    } else if (k === "debt_amount") {
      dbPatch.debtAmount = String(v);
    } else if (k === "customer_name") {
      dbPatch.customerName = String(v).trim();
    } else {
      (dbPatch as Record<string, unknown>)[col] = v;
    }
  }

  const updated = await repo.updateLead(row.id, dbPatch);
  if (!updated) throw new HttpError(500, "Update failed", "update_failed");

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "lead.update",
    entityType: "lead",
    entityId: row.id,
    entityCode: row.leadCode,
    // field NAMES only — no PII values in the audit log
    metadata: {
      fields: Object.keys(allowed),
      ...(rejected.length ? { rejected } : {}),
      ...("status" in allowed ? { status_from: row.status, status_to: allowed["status"] } : {}),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  // Phase 21: a SERVER-VALIDATED status transition → Office TV recognition.
  // Best-effort; never blocks the update. Only the guarded transitions below
  // celebrate — nothing here trusts a client "this was a sale" claim.
  if ("status" in allowed && allowed["status"] && allowed["status"] !== row.status) {
    const to = allowed["status"] as Lead["status"];
    if (row.status === "ASSIGNED" && to === "ACCEPTED" && row.agentId != null) {
      const aw = await getAgentWithUser(row.agentId).catch(() => undefined);
      if (aw) recognizeSafe(onLeadAccepted({ agentUserId: aw.user.id, leadCode: row.leadCode }));
    } else if (to === "COMPLETED") {
      let subjectUserId: number | null = null;
      if (row.assignedCloserId != null) {
        subjectUserId =
          (await getCloserWithUser(row.assignedCloserId).catch(() => undefined))?.user.id ?? null;
      }
      if (subjectUserId == null && row.agentId != null) {
        subjectUserId =
          (await getAgentWithUser(row.agentId).catch(() => undefined))?.user.id ?? null;
      }
      if (subjectUserId != null) {
        recognizeSafe(onSale({ userId: subjectUserId, leadCode: row.leadCode }));
      }
    }
  }

  return hydrateOne(updated);
}

/* ------------------------------ transfer ---------------------------- */

export async function transferLead(
  user: User,
  code: string,
  toCloserCode: string,
  note: string | null,
  meta: Meta = {},
): Promise<LeadDTO> {
  const row = await repo.getLeadByCode(code);
  if (!row) throw new HttpError(404, "Lead not found", "not_found");
  const actor = await resolveLeadActor(user);
  assertCanTransferLead(actor, row);

  const target = await getCloserByCode(toCloserCode);
  if (!target) throw new HttpError(404, `Closer ${toCloserCode} not found`, "closer_not_found");
  if (target.id === row.assignedCloserId) {
    throw new HttpError(422, "Lead is already assigned to that closer", "noop_transfer");
  }

  const now = nowIST();
  const nextStatus: Lead["status"] = row.status === "NEW" ? "ASSIGNED" : row.status;
  await repo.setAssignedCloser(row.id, target.id, nextStatus, now);
  await repo.insertAssignment({
    leadId: row.id,
    fromCloserId: row.assignedCloserId,
    toCloserId: target.id,
    action: row.assignedCloserId != null ? "reassign" : "assign",
    byUserId: user.id,
    note: note ?? null,
    createdAt: now,
  });

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "lead.transfer",
    entityType: "lead",
    entityId: row.id,
    entityCode: row.leadCode,
    metadata: {
      from_closer_id: row.assignedCloserId,
      to_closer_code: toCloserCode,
      status_from: row.status,
      status_to: nextStatus,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  const updated = await repo.getLeadById(row.id);
  return hydrateOne(updated!);
}

/* -------------------------- helper: dup check ---------------------- */

/**
 * Surface possible duplicates for a would-be new lead. Does NOT block creation
 * — the business rule for "duplicate" is undefined (see report O).
 */
export async function possibleDuplicates(user: User, phone: string, email?: string) {
  await resolveLeadActor(user); // authn only
  const rows = await repo.findPossibleDuplicates({
    phoneNormalized: normalizePhone(phone),
    emailNormalized: normalizeEmail(email),
  });
  return hydrate(rows);
}

/* ------------------------------ internals -------------------------- */

function isDuplicateKey(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /duplicate entry|er_dup_entry|leads_code_uq/i.test(m);
}
