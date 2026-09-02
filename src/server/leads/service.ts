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
  assertCanDeleteLead,
  assertCanReadLead,
  assertCanTransferLead,
  assertCanUpdateLead,
  assertLeadsModuleAccess,
  canReadLead,
  canSetLeadStatus,
  filterUpdatablePatch,
  leadScope,
  type LeadActor,
} from "../authz/leads";
import { HttpError } from "../http-error";
import { normalizeEmail, normalizePhone } from "../normalize";
import { isValidEmail, isValidUsPhone, usPhoneDigits } from "../validation/phone";
import { currentShiftDate, nowIST } from "../time";
import { DEMO_LEAD_MARKER } from "./demo";
import { purgeLeadDocumentBlobs } from "./document-service";
import { toLeadDTO, type LeadDTO } from "./dto";
import * as repo from "../db/repos/leads";
import {
  getAgentByCode,
  getAgentByUserId,
  getAgentWithUser,
  getAgentWithUserByCode,
  getCloserByCode,
  getCloserWithUser,
  getCloserWithUserByCode,
  listActiveClosers,
  loadAgentMeta,
  loadCloserMeta,
  resolveLeadActor,
} from "../db/repos/staff";
import { onLeadAccepted, onSale, recognizeSafe } from "../live/recognition";
import { emitBusinessEvent } from "../events/emit";
import { buildLeadSubmittedEvent } from "../events/adapters/lead-submitted";
import { buildLeadAcceptedEvent } from "../events/adapters/lead-accepted";
import { leads } from "@/lib/db/schema";
import type { Lead, NewLead, User } from "@/lib/db/schema";
import type { CreateLeadInput, ListLeadsInput, UpdateLeadInput } from "../validation/leads";

/** Request metadata for audit (matches context.RequestInfo; kept local to avoid a cycle). */
type Meta = { ip?: string | null; userAgent?: string | null };

/* ---------------------- process isolation (audit H-1) ------------------ *
 * A US Lead may only be assigned to a US Closer, an India Lead only to an
 * India Closer — enforced HERE at the service boundary, never by the UI. No
 * business rule authorises a cross-process operational assignment.          */

/** The process a lead belongs to: its originating agent's, else its current
 *  closer's, else null (nothing to compare against). */
async function processOfLeadRow(row: Lead): Promise<string | null> {
  if (row.agentId != null) {
    const aw = await getAgentWithUser(row.agentId);
    if (aw) return aw.user.process;
  }
  if (row.assignedCloserId != null) {
    const cw = await getCloserWithUser(row.assignedCloserId);
    if (cw) return cw.user.process;
  }
  return null;
}

/** Resolve a closer by CODE and assert it is in `leadProcess`. Returns the
 *  closer row. Throws 404 (unknown code) or 422 `cross_process` (mismatch). */
async function resolveCloserInProcess(
  closerCode: string,
  leadProcess: string | null,
): Promise<{ id: number; closerCode: string; userId: number }> {
  const found = await getCloserWithUserByCode(closerCode);
  if (!found) {
    throw new HttpError(404, `Closer ${closerCode} not found`, "closer_not_found");
  }
  // The closer must be ACTIVE — every picker already hides inactive closers, so
  // the server rejects an inactive-closer code with the SAME reasoning (no
  // silent mismatch, no assignment to a deactivated closer).
  if (found.user.status !== "active") {
    throw new HttpError(
      422,
      `Closer ${closerCode} is not active and cannot receive leads`,
      "closer_inactive",
    );
  }
  if (leadProcess != null && found.user.process !== leadProcess) {
    throw new HttpError(
      422,
      `Closer ${closerCode} is in the ${found.user.process} process — a ${leadProcess} lead can only be assigned to a ${leadProcess} closer`,
      "cross_process",
    );
  }
  return { id: found.closer.id, closerCode: found.closer.closerCode, userId: found.user.id };
}

/**
 * The AUTHORITATIVE eligible-closer list for a "assign / reassign closer" picker.
 * The process is resolved SERVER-SIDE (from the lead, else the chosen originating
 * agent, else — for a non-admin caller — the caller's own process). Only ACTIVE,
 * same-process closers are returned, minus the lead's current closer. Every
 * picker uses this instead of building the list client-side from an unscoped
 * "all closers" query.
 */
export async function eligibleClosers(
  user: User,
  opts: { leadCode?: string; agentCode?: string } = {},
): Promise<{
  process: string | null;
  currentCloserCode: string | null;
  closers: { code: string; name: string; process: string }[];
}> {
  const actor = await resolveLeadActor(user);
  let process: string | null = null;
  let currentCloserCode: string | null = null;

  if (opts.leadCode) {
    const row = await repo.getLeadByCode(opts.leadCode);
    if (!row) throw new HttpError(404, "Lead not found", "not_found");
    if (!canReadLead(actor, row)) {
      throw new HttpError(403, "Not authorized for this lead", "forbidden");
    }
    process = await processOfLeadRow(row);
    if (row.assignedCloserId != null) {
      const cw = await getCloserWithUser(row.assignedCloserId);
      currentCloserCode = cw?.closer.closerCode ?? null;
    }
  }
  if (process == null && opts.agentCode) {
    const aw = await getAgentWithUserByCode(opts.agentCode);
    process = aw?.user.process ?? null;
  }
  // Fallback = the caller's own process — this is EXACTLY what `createLead`
  // uses to stamp a new lead's process, so the New Lead picker matches what
  // the server will actually accept (an admin's new lead takes the admin's
  // process). A detail-page reassign passes `leadCode`, so the lead's own
  // process is used there and this fallback rarely applies.
  if (process == null) {
    process = user.process;
  }

  const rows = await listActiveClosers(process ?? undefined);
  return {
    process,
    currentCloserCode,
    closers: rows.filter((c) => c.code !== currentCloserCode),
  };
}

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
  return rows.map((r) => {
    const aMeta = r.agentId != null ? agentMeta.get(r.agentId) : undefined;
    const cMeta = r.assignedCloserId != null ? closerMeta.get(r.assignedCloserId) : undefined;
    return toLeadDTO(r, {
      agentCode: aMeta?.code ?? null,
      agentName: aMeta?.name ?? null,
      closerCode: cMeta?.code ?? null,
      closerName: cMeta?.name ?? null,
      // the lead's process: its agent's, else its assigned closer's
      process: aMeta?.process ?? cMeta?.process ?? null,
    });
  });
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
  assertLeadsModuleAccess(user.role);
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

  // Admin-only filters — silently ignored for non-admin callers (Admin UAT §3/§4).
  let closerId: number | undefined;
  let agentId: number | undefined;
  let process: "US" | "UK" | "IN" | "AU" | undefined;
  if (actor.user.role === "admin") {
    if (input.closerCode) closerId = (await getCloserByCode(input.closerCode))?.id;
    if (input.agentCode) agentId = (await getAgentByCode(input.agentCode))?.id;
    if (input.closerCode && closerId == null) return empty;
    if (input.agentCode && agentId == null) return empty;
    process = input.process;
  }

  // UAT #9: Agents & Closers never see the seeded/demo leads in their normal
  // lists. Admin / HR ("all" scope) still see everything.
  const hideLeadFile =
    scope.kind === "agent" || scope.kind === "closer" ? DEMO_LEAD_MARKER : undefined;

  const { rows, total } = await repo.listLeads({
    scope: scopeSql,
    status: input.status as Lead["status"] | undefined,
    q: input.q,
    qDigits: input.q ? input.q.replace(/\D/g, "") : undefined,
    shiftDateFrom: input.shiftDateFrom,
    shiftDateTo: input.shiftDateTo,
    closerId,
    agentId,
    process,
    hideLeadFile,
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
  assertLeadsModuleAccess(user.role);
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
  // UAT #5: an Agent NEVER chooses the capture date — it is the agent's own
  // operational shift date, derived server-side. Any client `date` is ignored.
  // Admin/HR may back-date (e.g. correcting a missed entry).
  const shiftDate =
    user.role === "agent" ? currentShiftDate(process) : (input.date ?? currentShiftDate(process));

  // Canonical last-10 NANP digits — used for storage AND the duplicate check so
  // "(212) 555-0142", "212-555-0142" and "1 212 555 0142" all collide.
  const phoneLast10 = usPhoneDigits(input.phone) ?? normalizePhone(input.phone);

  // UAT #7: duplicate-phone protection is enforced SERVER-SIDE and an Agent
  // cannot bypass it. A US phone that already backs a non-rejected lead is
  // rejected on submit.
  if (user.role === "agent" && phoneLast10) {
    const existing = await repo.findPossibleDuplicates({ phoneLast10 });
    const active = existing.filter((l) => l.status !== "REJECTED");
    if (active.length > 0) {
      throw new HttpError(
        409,
        `A lead with this phone number already exists (${active[0]!.leadCode}). Duplicate leads are not allowed.`,
        "duplicate_phone",
      );
    }
  }

  // Optional: create already-transferred to a closer — MUST be the same process
  // as the originating agent (audit H-1).
  let assignedCloserId: number | null = null;
  let assignedCloserUserId: number | null = null;
  if (input.assigned_closer_code) {
    const c = await resolveCloserInProcess(input.assigned_closer_code, process);
    assignedCloserId = c.id;
    assignedCloserUserId = c.userId;
  }

  const now = nowIST();
  const base: Omit<NewLead, "leadCode"> = {
    shiftDate,
    customerName: input.customer_name.trim(),
    phone: input.phone.trim(),
    phoneNormalized: phoneLast10,
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

  // Phase 5: server-confirmed lead submission → ONE canonical LEAD_SUBMITTED
  // BusinessEvent. This runs AFTER the lead row + assignment + audit are
  // persisted. `emitBusinessEvent` is fire-and-forget and NEVER throws into this
  // function — a scoring / recognition failure cannot roll back, delay, error or
  // alter the lead.
  //
  // The dispatcher fans this one event to BOTH consumers:
  //   • Scoring    → points (awardScored), OR the dispatcher's legacy-points
  //                  bridge (the pre-engine awardEvent) when there is no rule
  //   • Recognition → the Office TV recognition moment (celebration decision) —
  //                   no points
  // Phase 5 retired the old direct recognition call here so recognition is
  // never emitted from a second location — the dispatcher's recognition bridge
  // now drives the Office TV moment off this one event.
  const submitterUserId = user.role === "agent" ? user.id : (agentWithUser?.user.id ?? null);
  if (submitterUserId != null) {
    emitBusinessEvent(
      buildLeadSubmittedEvent({
        lead: row,
        subjectUserId: submitterUserId,
        actorUserId: user.id,
        subjectRole: agentWithUser?.user.role ?? "agent",
        process,
        shiftDate,
        agentUserId: agentWithUser?.user.id ?? null,
        closerUserId: assignedCloserUserId,
      }),
    );
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
      if (aw) {
        // Phase 7 — ONE canonical LEAD_ACCEPTED BusinessEvent. Runs AFTER the
        // status transition + audit are persisted. Fire-and-forget; it can never
        // roll back, delay, error or alter the lead. The dispatcher fans it to
        // Scoring (points from Admin/Operations rules, or the gated legacy
        // fallback) and Recognition (the LEVEL_2 Office TV moment). No points
        // here, no visual logic here.
        const closerUser =
          row.assignedCloserId != null
            ? ((await getCloserWithUser(row.assignedCloserId).catch(() => undefined))?.user ?? null)
            : null;
        emitBusinessEvent(
          buildLeadAcceptedEvent({
            lead: updated,
            subjectUserId: aw.user.id,
            actorUserId: user.id,
            subjectRole: aw.user.role,
            process: aw.user.process,
            shiftDate: row.shiftDate,
            agentUserId: aw.user.id,
            closerUserId: closerUser?.id ?? null,
          }),
        );
        // Side effects the BusinessEvent path does not cover (agent
        // notification, THIRD_ACCEPTED_LEAD / TEAM_MILESTONE escalation).
        recognizeSafe(onLeadAccepted({ agentUserId: aw.user.id, leadCode: row.leadCode }));
      }
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

  // Process isolation (audit H-1): the target closer must be in the lead's
  // own process. Resolved by CODE + user join, never trusted from the client.
  const leadProcess = await processOfLeadRow(row);
  const target = await resolveCloserInProcess(toCloserCode, leadProcess);
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

/* ----------------------------- hard delete ------------------------- *
 *
 * Admin/Lead UAT §2 — TRUE hard delete. ADMIN ONLY. The lead row and, with it,
 * `leads.phone_normalized` (the duplicate-detection identity) are permanently
 * removed from the database. This is NOT a soft delete and NOT an archive:
 * after this call the lead cannot be read, listed, searched, or found by the
 * duplicate check, and its phone number is free to be submitted as a brand-new
 * lead.
 *
 * Dependency handling (all inside `repo.hardDeleteLead`'s transaction):
 *   - lead_assignments        rows deleted (FK CASCADE + explicit)
 *   - lead_documents          rows deleted (FK CASCADE + explicit); the BLOBS
 *                             are unlinked here first via `purgeLeadDocumentBlobs`
 *   - follow_ups              lead_id + converted_lead_code cleared (detached)
 *   - follow_up_attempts      related_lead_id + related_lead_code cleared
 *
 * AUDIT CONFLICT NOTE (reported to the Owner): `audit_logs` has no foreign key
 * to `leads` and is the system's immutable security log. We write ONE
 * `lead.hard_delete` event. It records the lead code, the customer name, the
 * final status and only the LAST 4 DIGITS of the phone (masked) — never the
 * full phone and never `phone_normalized`. So the deleted lead's
 * duplicate-detection identity does not survive anywhere; only a masked,
 * non-reversible fragment remains, in the append-only audit log, because the
 * existing architecture requires a deletion event.
 */
export interface DeleteLeadResult {
  deleted: true;
  lead_code: string;
  customer_name: string;
  status: Lead["status"];
  phone_last4: string;
  documents_removed: number;
  document_blobs_removed: number;
  follow_ups_detached: number;
  follow_up_attempts_detached: number;
  assignments_removed: number;
}

export async function deleteLead(
  user: User,
  code: string,
  meta: Meta = {},
): Promise<DeleteLeadResult> {
  const row = await repo.getLeadByCode(code);
  if (!row) throw new HttpError(404, "Lead not found", "not_found");
  const actor = await resolveLeadActor(user);
  assertCanDeleteLead(actor);

  const digits = (row.phone ?? "").replace(/\D/g, "");
  const phoneLast4 = digits.length >= 4 ? digits.slice(-4) : digits;

  // 1) unlink the physical document blobs BEFORE the DB rows go (FK CASCADE)
  const blobsRemoved = await purgeLeadDocumentBlobs(row.id);

  // 2) one transaction: detach follow-up refs, delete assignments + doc rows,
  //    delete the lead itself (takes phone_normalized with it)
  const res = await repo.hardDeleteLead(row.id, row.leadCode);

  // 3) the required deletion event — masked identity only
  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "lead.hard_delete",
    entityType: "lead",
    entityId: row.id,
    entityCode: row.leadCode,
    metadata: {
      customer_name: row.customerName,
      status: row.status,
      phone_last4: phoneLast4,
      documents_removed: res.documentsRemoved,
      document_blobs_removed: blobsRemoved,
      follow_ups_detached: res.followUpsDetached,
      follow_up_attempts_detached: res.followUpAttemptsDetached,
      assignments_removed: res.assignmentsRemoved,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return {
    deleted: true,
    lead_code: row.leadCode,
    customer_name: row.customerName,
    status: row.status,
    phone_last4: phoneLast4,
    documents_removed: res.documentsRemoved,
    document_blobs_removed: blobsRemoved,
    follow_ups_detached: res.followUpsDetached,
    follow_up_attempts_detached: res.followUpAttemptsDetached,
    assignments_removed: res.assignmentsRemoved,
  };
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

/* ---------------- inline duplicate check for the New-Customer form -------- *
 * Authoritative (DB), read-scoped, no side effects. The form calls this as the
 * agent types a COMPLETE phone / email so a duplicate is surfaced before the
 * whole form is filled. `createLead` still re-checks on submit (safety net).  */

export interface FieldCheckResult {
  /** the field carried a value we could check */
  checked: boolean;
  /** the value passed format validation (US phone / email shape) */
  valid: boolean;
  /** the canonical duplicate hit, or null */
  duplicate: null | {
    /** true when the caller is allowed to READ this lead */
    visible: boolean;
    lead_id: string | null;
    status: string | null;
  };
}

export interface LeadDuplicateCheck {
  phone: FieldCheckResult;
  email: FieldCheckResult;
}

const EMPTY_FIELD: FieldCheckResult = { checked: false, valid: false, duplicate: null };

/** Pick the most relevant duplicate row: a non-REJECTED one first, newest id. */
function pickDuplicate(rows: Lead[]): Lead | null {
  if (rows.length === 0) return null;
  const active = rows.filter((r) => r.status !== "REJECTED");
  const pool = active.length ? active : rows;
  return pool.reduce((a, b) => (b.id > a.id ? b : a));
}

async function describeDuplicate(
  actor: LeadActor,
  row: Lead | null,
): Promise<FieldCheckResult["duplicate"]> {
  if (!row) return null;
  let visible = false;
  try {
    assertCanReadLead(actor, row);
    visible = true;
  } catch {
    visible = false;
  }
  return {
    visible,
    lead_id: visible ? row.leadCode : null,
    status: visible ? row.status : null,
  };
}

export async function checkLeadDuplicate(
  user: User,
  input: { phone?: string | null | undefined; email?: string | null | undefined },
): Promise<LeadDuplicateCheck> {
  const actor = await resolveLeadActor(user);

  const phoneRaw = (input.phone ?? "").trim();
  const emailRaw = (input.email ?? "").trim();

  let phone: FieldCheckResult = EMPTY_FIELD;
  if (phoneRaw) {
    const valid = isValidUsPhone(phoneRaw);
    if (!valid) {
      phone = { checked: true, valid: false, duplicate: null };
    } else {
      const rows = await repo.findPossibleDuplicates({ phoneLast10: usPhoneDigits(phoneRaw) });
      phone = {
        checked: true,
        valid: true,
        duplicate: await describeDuplicate(actor, pickDuplicate(rows)),
      };
    }
  }

  let email: FieldCheckResult = EMPTY_FIELD;
  if (emailRaw) {
    const valid = isValidEmail(emailRaw);
    if (!valid) {
      email = { checked: true, valid: false, duplicate: null };
    } else {
      const rows = await repo.findPossibleDuplicates({ emailNormalized: normalizeEmail(emailRaw) });
      email = {
        checked: true,
        valid: true,
        duplicate: await describeDuplicate(actor, pickDuplicate(rows)),
      };
    }
  }

  return { phone, email };
}

/* ------------------------------ internals -------------------------- */

function isDuplicateKey(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /duplicate entry|er_dup_entry|leads_code_uq/i.test(m);
}
