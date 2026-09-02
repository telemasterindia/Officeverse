/**
 * Officeverse — HR Policy service.
 *
 * A deliberately small policy-publishing module (Admin UAT §7):
 *   - HR / Admin: view, create, edit, publish, unpublish, DELETE — including a
 *     policy that is already PUBLISHED (status never restricts edit/delete).
 *   - Agent / Closer: view PUBLISHED policies only. No edit, no delete.
 *
 * Every create / edit / publish / unpublish / delete writes one `hr_policy.*`
 * audit row. No document storage, no versioning table — just the current row +
 * audit trail (a delete leaves its audit row in place; entity_id has no FK back
 * to hr_policies).
 */
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { getDb, isDbConfigured } from "@/lib/db";
import { hrPolicies, users, type User } from "@/lib/db/schema";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { nowIST } from "../time";
import { assertCanManageHrPolicy } from "../authz/hr-policy";

export interface PolicyDTO {
  id: number;
  title: string;
  content: string;
  effective_date: string | null;
  status: "DRAFT" | "PUBLISHED";
  created_by_name: string | null;
  updated_by_name: string | null;
  published_by_name: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function row(r: {
  id: number;
  title: string;
  content: string;
  effectiveDate: string | null;
  status: "DRAFT" | "PUBLISHED";
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  updatedByName: string | null;
  publishedByName: string | null;
}): PolicyDTO {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    effective_date: r.effectiveDate ?? null,
    status: r.status,
    created_by_name: r.createdByName ?? null,
    updated_by_name: r.updatedByName ?? null,
    published_by_name: r.publishedByName ?? null,
    published_at: r.publishedAt ?? null,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

const BASE_SELECT = {
  id: hrPolicies.id,
  title: hrPolicies.title,
  content: hrPolicies.content,
  effectiveDate: hrPolicies.effectiveDate,
  status: hrPolicies.status,
  publishedAt: hrPolicies.publishedAt,
  createdAt: hrPolicies.createdAt,
  updatedAt: hrPolicies.updatedAt,
} as const;

const cCreated = alias(users, "hp_created");
const cUpdated = alias(users, "hp_updated");
const cPublished = alias(users, "hp_published");

async function fetchOne(id: number): Promise<PolicyDTO | null> {
  const rows = await getDb()
    .select({
      ...BASE_SELECT,
      createdByName: cCreated.fullName,
      updatedByName: cUpdated.fullName,
      publishedByName: cPublished.fullName,
    })
    .from(hrPolicies)
    .leftJoin(cCreated, eq(cCreated.id, hrPolicies.createdByUserId))
    .leftJoin(cUpdated, eq(cUpdated.id, hrPolicies.updatedByUserId))
    .leftJoin(cPublished, eq(cPublished.id, hrPolicies.publishedByUserId))
    .where(eq(hrPolicies.id, id))
    .limit(1);
  return rows[0] ? row(rows[0]) : null;
}

/* -------------------------------- reads -------------------------------- */

/** List policies. Managers (HR/Admin) see everything; everyone else sees
 *  PUBLISHED only. Newest-effective first. */
export async function listPolicies(
  actor: Pick<User, "role">,
): Promise<{ dbUnavailable?: boolean; canManage: boolean; rows: PolicyDTO[] }> {
  const canManage = actor.role === "admin" || actor.role === "hr";
  if (!isDbConfigured()) return { dbUnavailable: true, canManage, rows: [] };

  const conds = canManage ? undefined : eq(hrPolicies.status, "PUBLISHED");
  const rows = await getDb()
    .select({
      ...BASE_SELECT,
      createdByName: cCreated.fullName,
      updatedByName: cUpdated.fullName,
      publishedByName: cPublished.fullName,
    })
    .from(hrPolicies)
    .leftJoin(cCreated, eq(cCreated.id, hrPolicies.createdByUserId))
    .leftJoin(cUpdated, eq(cUpdated.id, hrPolicies.updatedByUserId))
    .leftJoin(cPublished, eq(cPublished.id, hrPolicies.publishedByUserId))
    .where(conds)
    .orderBy(desc(hrPolicies.effectiveDate), desc(hrPolicies.updatedAt));

  return { canManage, rows: rows.map(row) };
}

export async function getPolicy(actor: Pick<User, "role">, id: number): Promise<PolicyDTO> {
  const p = await fetchOne(id);
  if (!p) throw new HttpError(404, "Policy not found", "not_found");
  const canManage = actor.role === "admin" || actor.role === "hr";
  if (!canManage && p.status !== "PUBLISHED") {
    throw new HttpError(403, "This policy is not published", "forbidden");
  }
  return p;
}

/* -------------------------------- writes ------------------------------- */

type Meta = { ip?: string | null; userAgent?: string | null };

export interface UpsertPolicyInput {
  id?: number | undefined;
  title: string;
  content: string;
  effective_date?: string | undefined;
}

export async function savePolicy(
  actor: Pick<User, "id" | "role">,
  input: UpsertPolicyInput,
  meta: Meta = {},
): Promise<PolicyDTO> {
  assertCanManageHrPolicy(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");

  const title = input.title.trim().slice(0, 200);
  const content = input.content.trim();
  if (!title) throw new HttpError(400, "A policy title is required", "title_required");
  if (!content) throw new HttpError(400, "Policy content is required", "content_required");
  const effectiveDate = (input.effective_date ?? "").trim() || null;
  if (effectiveDate && !YMD.test(effectiveDate)) {
    throw new HttpError(400, "Effective date must be YYYY-MM-DD", "bad_date");
  }
  const now = nowIST();

  if (input.id) {
    const existing = await fetchOne(input.id);
    if (!existing) throw new HttpError(404, "Policy not found", "not_found");
    await getDb()
      .update(hrPolicies)
      .set({ title, content, effectiveDate, updatedByUserId: actor.id, updatedAt: now })
      .where(eq(hrPolicies.id, input.id));
    await recordAudit({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: "hr_policy.updated",
      entityType: "hr_policy",
      entityId: input.id,
      metadata: { title, effective_date: effectiveDate, status: existing.status },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return (await fetchOne(input.id))!;
  }

  const inserted = await getDb()
    .insert(hrPolicies)
    .values({
      title,
      content,
      effectiveDate,
      status: "DRAFT",
      createdByUserId: actor.id,
      updatedByUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    })
    .$returningId();
  const id = Number(inserted[0]?.id ?? 0);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "hr_policy.created",
    entityType: "hr_policy",
    entityId: id,
    metadata: { title, effective_date: effectiveDate },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return (await fetchOne(id))!;
}

export async function setPolicyStatus(
  actor: Pick<User, "id" | "role">,
  id: number,
  publish: boolean,
  meta: Meta = {},
): Promise<PolicyDTO> {
  assertCanManageHrPolicy(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const existing = await fetchOne(id);
  if (!existing) throw new HttpError(404, "Policy not found", "not_found");

  const now = nowIST();
  await getDb()
    .update(hrPolicies)
    .set(
      publish
        ? { status: "PUBLISHED", publishedByUserId: actor.id, publishedAt: now, updatedAt: now }
        : { status: "DRAFT", publishedByUserId: null, publishedAt: null, updatedAt: now },
    )
    .where(and(eq(hrPolicies.id, id)));

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: publish ? "hr_policy.published" : "hr_policy.unpublished",
    entityType: "hr_policy",
    entityId: id,
    metadata: {
      title: existing.title,
      before: existing.status,
      after: publish ? "PUBLISHED" : "DRAFT",
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return (await fetchOne(id))!;
}

/**
 * Delete a policy — HR/Admin only, regardless of DRAFT/PUBLISHED status. Once
 * deleted it disappears from every list (Admin/HR included) and Agents/Closers
 * can no longer view it. The `hr_policy.deleted` audit row is kept forever
 * (audit_logs.entity_id has no FK back to hr_policies) so the audit trail
 * survives the delete. Unrelated employee/lead/attendance/payroll data is
 * never touched.
 */
export async function deletePolicy(
  actor: Pick<User, "id" | "role">,
  id: number,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManageHrPolicy(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const existing = await fetchOne(id);
  if (!existing) throw new HttpError(404, "Policy not found", "not_found");

  await getDb().delete(hrPolicies).where(eq(hrPolicies.id, id));

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "hr_policy.deleted",
    entityType: "hr_policy",
    entityId: id,
    metadata: { title: existing.title, status: existing.status },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}
