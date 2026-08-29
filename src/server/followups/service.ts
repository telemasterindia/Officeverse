/**
 * Officeverse — Follow-up service (Phase 4).
 *
 * Orchestrates API ↔ pure authz/state-machine (../authz/followups.ts) ↔ repos.
 * Every mutation: resolve actor from session → assert authorization + legal
 * transition → persist (transaction for reschedule/complete/cancel/convert) →
 * audit → return a client-safe DTO. Owner is ALWAYS the session user.
 */
import { recordAudit } from "../audit";
import {
  assertCanCancelFollowUp,
  assertCanCompleteFollowUp,
  assertCanConvertFollowUp,
  assertCanCreateFollowUp,
  assertCanReadFollowUp,
  assertCanRescheduleFollowUp,
  assertCanUpdateFollowUpCustomer,
  canTransition,
  filterCustomerPatch,
  followUpScope,
  type FollowUpActor,
} from "../authz/followups";
import { HttpError } from "../http-error";
import { normalizeEmail, normalizePhone } from "../normalize";
import {
  addDaysYMD,
  calendarTodayIST,
  currentShiftDate,
  nowIST,
  toScheduledWallClock,
} from "../time";
import { toFollowUpDTO, type FollowUpDTO } from "./dto";
import { toLeadDTO, type LeadDTO } from "../leads/dto";
import * as repo from "../db/repos/followups";
import * as leadsRepo from "../db/repos/leads";
import {
  getAgentByUserId,
  getCloserByCode,
  loadAgentMeta,
  loadCloserMeta,
} from "../db/repos/staff";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import type { FollowUp, NewFollowUp, User } from "@/lib/db/schema";
import type {
  CreateFollowUpInput,
  CustomerPatchInput,
  ListFollowUpsInput,
  RescheduleInput,
} from "../validation/followups";

type Meta = { ip?: string | null; userAgent?: string | null };

function actorOf(user: User): FollowUpActor {
  return { user: { id: user.id, role: user.role } };
}

/* ------------------------------- hydrate ----------------------------- */

async function ownerNameMap(ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const unique = [...new Set(ids)];
  if (!unique.length) return map;
  const rows = await getDb()
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .where(inArray(users.id, unique));
  for (const r of rows) map.set(r.id, r.name);
  return map;
}

async function hydrateOne(row: FollowUp, withAttempts = true): Promise<FollowUpDTO> {
  const [attempts, names] = await Promise.all([
    withAttempts ? repo.listAttempts(row.id) : Promise.resolve([]),
    ownerNameMap([row.ownerUserId, row.createdByUserId]),
  ]);
  return toFollowUpDTO(row, attempts, {
    ownerName: names.get(row.ownerUserId) ?? null,
    createdByName: names.get(row.createdByUserId) ?? null,
  });
}

async function hydrateList(rows: FollowUp[]): Promise<FollowUpDTO[]> {
  if (!rows.length) return [];
  const names = await ownerNameMap(rows.flatMap((r) => [r.ownerUserId, r.createdByUserId]));
  return rows.map((r) =>
    toFollowUpDTO(r, [], {
      ownerName: names.get(r.ownerUserId) ?? null,
      createdByName: names.get(r.createdByUserId) ?? null,
    }),
  );
}

/* --------------------------------- list ----------------------------- */

export interface ListFollowUpsResult {
  followUps: FollowUpDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listFollowUps(
  user: User,
  input: ListFollowUpsInput,
): Promise<ListFollowUpsResult> {
  const scope = followUpScope(actorOf(user));
  const now = nowIST();
  const todayEnd = `${addDaysYMD(calendarTodayIST(), 1)} 00:00:00`;

  const ownerUserId = scope.kind === "owner" ? scope.ownerUserId : (input.ownerUserId ?? undefined);

  const { rows, total } = await repo.listFollowUps({
    ownerUserId,
    status: input.status as FollowUp["status"] | undefined,
    bucket: input.bucket,
    nowWall: now,
    todayEndWall: todayEnd,
    scheduledFrom: input.scheduledFrom ? `${input.scheduledFrom} 00:00:00` : undefined,
    scheduledTo: input.scheduledTo ? `${input.scheduledTo} 23:59:59` : undefined,
    q: input.q,
    qDigits: input.q ? input.q.replace(/\D/g, "") : undefined,
    sort: input.sort,
    limit: input.pageSize,
    offset: (input.page - 1) * input.pageSize,
  });

  return {
    followUps: await hydrateList(rows),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

/* ------------------------------ get / history ---------------------- */

async function loadForRead(user: User, code: string): Promise<FollowUp> {
  const row = await repo.getFollowUpByCode(code);
  if (!row) throw new HttpError(404, "Follow-up not found", "not_found");
  assertCanReadFollowUp(actorOf(user), row);
  return row;
}

export async function getFollowUp(user: User, code: string): Promise<FollowUpDTO> {
  return hydrateOne(await loadForRead(user, code));
}

export async function getFollowUpHistory(user: User, code: string) {
  const row = await loadForRead(user, code);
  const attempts = await repo.listAttempts(row.id);
  return {
    follow_up_id: row.followUpCode,
    status: row.status,
    attempts: (await hydrateOne(row)).attempts,
    count: attempts.length,
  };
}

/* ------------------------------- create --------------------------- */

const CUSTOMER_COLS: Record<string, keyof NewFollowUp> = {
  full_name: "customerName",
  customer_name: "customerName",
  phone: "phone",
  email: "email",
  address: "address",
  city: "city",
  state: "state",
  zip: "zip",
  debt_amount: "debtAmount",
  credit: "creditStatus",
  credit_status: "creditStatus",
  current_late: "currentDebts",
  current_debts: "currentDebts",
  comment: "comment",
};

export async function createFollowUp(
  user: User,
  input: CreateFollowUpInput,
  meta: Meta = {},
): Promise<FollowUpDTO> {
  const actor = actorOf(user);
  assertCanCreateFollowUp(actor);

  const ownerRole: FollowUp["ownerRole"] = user.role === "closer" ? "closer" : "agent";
  const captureDate = input.date ?? currentShiftDate(user.process);
  const scheduledAt = toScheduledWallClock(input.scheduled_date, input.scheduled_time);
  const now = nowIST();

  const base: Omit<NewFollowUp, "followUpCode"> = {
    ownerUserId: user.id,
    ownerRole,
    customerName: input.full_name.trim(),
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
    currentDebts: input.current_late ?? null,
    captureDate,
    scheduledAt,
    comment: input.comment ?? null,
    status: "SCHEDULED",
    createdByUserId: user.id,
    source: "app",
    createdAt: now,
    updatedAt: now,
  };

  let row: FollowUp | undefined;
  for (let attempt = 0; attempt < 3 && !row; attempt++) {
    const followUpCode = await repo.nextFollowUpCode();
    try {
      row = await repo.insertFollowUp({ ...base, followUpCode });
    } catch (err) {
      if (attempt === 2 || !isDuplicateKey(err)) throw err;
    }
  }
  if (!row) throw new HttpError(500, "Could not allocate a Follow-up ID", "id_alloc_failed");

  await repo.insertAttempt({
    followUpId: row.id,
    attemptNo: 1,
    scheduledAt,
    outcome: "SCHEDULED",
    note: null,
    recordedAt: now,
    recordedByUserId: user.id,
  });

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "followup.create",
    entityType: "follow_up",
    entityId: row.id,
    entityCode: row.followUpCode,
    metadata: { owner_role: ownerRole, capture_date: captureDate, scheduled_at: scheduledAt },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return hydrateOne(row);
}

/* -------------------------- customer update --------------------- */

export async function updateFollowUpCustomer(
  user: User,
  code: string,
  patch: CustomerPatchInput,
  meta: Meta = {},
): Promise<FollowUpDTO> {
  const row = await repo.getFollowUpByCode(code);
  if (!row) throw new HttpError(404, "Follow-up not found", "not_found");
  assertCanUpdateFollowUpCustomer(actorOf(user), row);

  const { allowed, rejected } = filterCustomerPatch(patch as Record<string, unknown>);
  if (Object.keys(allowed).length === 0) {
    throw new HttpError(400, "No editable customer fields supplied", "no_fields");
  }

  const dbPatch: Partial<NewFollowUp> = { updatedAt: nowIST() };
  for (const [k, v] of Object.entries(allowed)) {
    const col = CUSTOMER_COLS[k];
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
    } else if (k === "full_name" || k === "customer_name") {
      dbPatch.customerName = String(v).trim();
    } else {
      (dbPatch as Record<string, unknown>)[col] = v;
    }
  }

  const updated = await repo.updateFollowUpCustomer(row.id, dbPatch);
  if (!updated) throw new HttpError(500, "Update failed", "update_failed");

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "followup.customer_update",
    entityType: "follow_up",
    entityId: row.id,
    entityCode: row.followUpCode,
    metadata: { fields: Object.keys(allowed), ...(rejected.length ? { rejected } : {}) },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return hydrateOne(updated);
}

/* ----------------------------- reschedule ---------------------- */

export async function rescheduleFollowUp(
  user: User,
  code: string,
  input: RescheduleInput,
  meta: Meta = {},
): Promise<FollowUpDTO> {
  const newScheduledAt = toScheduledWallClock(input.scheduled_date, input.scheduled_time);
  const now = nowIST();
  const reason = input.reason ?? null;
  const expected = input.expected_scheduled_at
    ? input.expected_scheduled_at.replace("T", " ").replace("+05:30", "").trim()
    : undefined;

  const updatedRow = await getDb().transaction(async (tx) => {
    const row = await repo.getFollowUpByCodeForUpdate(code, tx);
    if (!row) throw new HttpError(404, "Follow-up not found", "not_found");
    assertCanRescheduleFollowUp(actorOf(user), row);
    const legal = canTransition(row.status, "reschedule");
    if (!legal.ok) throw new HttpError(422, legal.reason, legal.code);

    if (expected && row.scheduledAt.replace(/:\d{2}$/, "") !== expected.replace(/:\d{2}$/, "")) {
      throw new HttpError(409, "The follow-up schedule changed since you loaded it", "stale");
    }

    const curNo = await repo.maxAttemptNo(row.id, tx);
    const flipped = await repo.transitionCurrentAttempt(row.id, curNo, "RESCHEDULED", reason, tx);
    if (flipped !== 1) {
      throw new HttpError(409, "The follow-up was changed concurrently", "concurrent");
    }
    await repo.insertAttempt(
      {
        followUpId: row.id,
        attemptNo: curNo + 1,
        scheduledAt: newScheduledAt,
        outcome: "SCHEDULED",
        note: null,
        recordedAt: now,
        recordedByUserId: user.id,
      },
      tx,
    );
    const moved = await repo.updateFollowUpSchedule(row.id, newScheduledAt, now, tx);
    if (moved !== 1) {
      throw new HttpError(409, "The follow-up was changed concurrently", "concurrent");
    }

    const fresh = await repo.getFollowUpById(row.id, tx);
    await recordAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: "followup.reschedule",
      entityType: "follow_up",
      entityId: row.id,
      entityCode: row.followUpCode,
      metadata: {
        from: row.scheduledAt,
        to: newScheduledAt,
        attempt_no: curNo + 1,
        ...(reason ? { reason } : {}),
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return fresh!;
  });

  return hydrateOne(updatedRow);
}

/* --------------------------- complete / cancel ---------------- */

async function terminate(
  user: User,
  code: string,
  action: "complete" | "cancel",
  note: string | null,
  meta: Meta,
): Promise<FollowUpDTO> {
  const now = nowIST();
  const targetStatus = action === "complete" ? "COMPLETED" : "CANCELLED";
  const targetOutcome = action === "complete" ? "COMPLETED" : "CANCELLED";

  const updatedRow = await getDb().transaction(async (tx) => {
    const row = await repo.getFollowUpByCodeForUpdate(code, tx);
    if (!row) throw new HttpError(404, "Follow-up not found", "not_found");
    if (action === "complete") assertCanCompleteFollowUp(actorOf(user), row);
    else assertCanCancelFollowUp(actorOf(user), row);
    const legal = canTransition(row.status, action);
    if (!legal.ok) throw new HttpError(422, legal.reason, legal.code);

    const curNo = await repo.maxAttemptNo(row.id, tx);
    const flipped = await repo.transitionCurrentAttempt(row.id, curNo, targetOutcome, note, tx);
    if (flipped !== 1) throw new HttpError(409, `Follow-up already ${action}d`, "concurrent");
    const done = await repo.setFollowUpTerminal(row.id, targetStatus, now, tx);
    if (done !== 1) throw new HttpError(409, `Follow-up already ${action}d`, "concurrent");

    await recordAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: action === "complete" ? "followup.complete" : "followup.cancel",
      entityType: "follow_up",
      entityId: row.id,
      entityCode: row.followUpCode,
      metadata: { scheduled_at: row.scheduledAt, ...(note ? { note } : {}) },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return (await repo.getFollowUpById(row.id, tx))!;
  });

  return hydrateOne(updatedRow);
}

export const completeFollowUp = (user: User, code: string, note: string | null, meta: Meta = {}) =>
  terminate(user, code, "complete", note, meta);
export const cancelFollowUp = (user: User, code: string, reason: string | null, meta: Meta = {}) =>
  terminate(user, code, "cancel", reason, meta);

/* --------------------------- convert to lead ------------------- */

export interface ConvertResult {
  followUp: FollowUpDTO;
  lead: LeadDTO;
}

export async function convertFollowUpToLead(
  user: User,
  code: string,
  toCloserCode: string,
  note: string | null,
  meta: Meta = {},
): Promise<ConvertResult> {
  // Pre-transaction reads (no race): the converting user must be an agent with
  // a profile (leads.agent_id is NOT NULL); the target closer must exist.
  const preRow = await repo.getFollowUpByCode(code);
  if (!preRow) throw new HttpError(404, "Follow-up not found", "not_found");
  assertCanConvertFollowUp(actorOf(user), preRow);

  const agent = await getAgentByUserId(user.id);
  if (!agent) {
    throw new HttpError(409, "Your user has no agent profile", "no_agent_profile");
  }
  const closer = await getCloserByCode(toCloserCode);
  if (!closer) {
    throw new HttpError(404, `Closer ${toCloserCode} not found`, "closer_not_found");
  }

  const now = nowIST();

  const result = await getDb().transaction(async (tx) => {
    const row = await repo.getFollowUpByCodeForUpdate(code, tx);
    if (!row) throw new HttpError(404, "Follow-up not found", "not_found");
    // Re-check inside the lock — blocks a simultaneous second conversion.
    assertCanConvertFollowUp(actorOf(user), row);
    const legal = canTransition(row.status, "convert");
    if (!legal.ok) throw new HttpError(422, legal.reason, legal.code);

    // 1) create the Lead from the follow-up's existing customer snapshot
    let lead;
    for (let a = 0; a < 3 && !lead; a++) {
      const leadCode = await leadsRepo.nextLeadCode(tx);
      try {
        lead = await leadsRepo.insertLead(
          {
            leadCode,
            shiftDate: currentShiftDate(user.process),
            customerName: row.customerName,
            phone: row.phone,
            phoneNormalized: row.phoneNormalized ?? normalizePhone(row.phone),
            email: row.email,
            emailNormalized: row.emailNormalized ?? normalizeEmail(row.email),
            address: row.address,
            city: row.city,
            state: row.state,
            zip: row.zip,
            debtAmount: row.debtAmount,
            creditStatus: row.creditStatus,
            currentDebts: row.currentDebts ?? "Current",
            leadFile: null,
            comments: row.comment,
            agentId: agent.id,
            assignedCloserId: closer.id,
            status: "ASSIGNED",
            source: "conversion",
            convertedFromFollowUpId: row.id,
            createdAt: now,
            updatedAt: now,
          },
          tx,
        );
      } catch (err) {
        if (a === 2 || !isDuplicateKey(err)) throw err;
      }
    }
    if (!lead) throw new HttpError(500, "Could not allocate a Lead ID", "id_alloc_failed");

    // 2) Lead assignment history (Phase-3 mechanism)
    await leadsRepo.insertAssignment(
      {
        leadId: lead.id,
        fromCloserId: null,
        toCloserId: closer.id,
        action: "assign",
        byUserId: user.id,
        note: null,
        createdAt: now,
      },
      tx,
    );

    // 3) mark the follow-up CONVERTED (conditional — 0 rows ⇒ raced ⇒ rollback)
    const done = await repo.setFollowUpTerminal(row.id, "CONVERTED", now, tx, {
      leadId: lead.id,
      convertedLeadCode: lead.leadCode,
    });
    if (done !== 1) throw new HttpError(409, "Follow-up already converted", "already_converted");

    // 4) conversion history entry (flip the active attempt)
    const curNo = await repo.maxAttemptNo(row.id, tx);
    const flipped = await repo.transitionCurrentAttempt(row.id, curNo, "CONVERTED", note, tx, {
      relatedLeadId: lead.id,
      relatedLeadCode: lead.leadCode,
    });
    if (flipped !== 1) throw new HttpError(409, "Follow-up already converted", "already_converted");

    const freshFu = (await repo.getFollowUpById(row.id, tx))!;
    return { lead, freshFu };
  });

  // Audit AFTER commit (audit failure must not roll back the conversion).
  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "followup.convert",
    entityType: "follow_up",
    entityId: result.freshFu.id,
    entityCode: result.freshFu.followUpCode,
    metadata: {
      lead_id: result.lead.leadCode,
      to_closer_code: toCloserCode,
      ...(note ? { note } : {}),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "lead.create",
    entityType: "lead",
    entityId: result.lead.id,
    entityCode: result.lead.leadCode,
    metadata: {
      source: "conversion",
      from_follow_up: result.freshFu.followUpCode,
      to_closer_code: toCloserCode,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  const [agentMeta, closerMeta] = await Promise.all([
    loadAgentMeta([agent.id]),
    loadCloserMeta([closer.id]),
  ]);
  return {
    followUp: await hydrateOne(result.freshFu),
    lead: toLeadDTO(result.lead, {
      agentCode: agentMeta.get(agent.id)?.code ?? null,
      agentName: agentMeta.get(agent.id)?.name ?? null,
      closerCode: closerMeta.get(closer.id)?.code ?? null,
      closerName: closerMeta.get(closer.id)?.name ?? null,
    }),
  };
}

/* ------------------------------ internals -------------------- */

function isDuplicateKey(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /duplicate entry|er_dup_entry|_code_uq/i.test(m);
}
