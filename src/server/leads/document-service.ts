/**
 * Officeverse — Lead supporting-document service (Admin/Lead UAT §3–§6).
 *
 * Orchestration between the client-callable server functions
 * (`lead-fns.ts`), the pure upload validator (`document-validate.ts`), the
 * private blob store (`document-storage.ts`) and the `lead_documents` repo.
 *
 * Every entry point:
 *   1. resolves the actor from the authenticated session (never the body)
 *   2. loads the lead and asserts document access SERVER-SIDE
 *      (`assertCanAccessLeadDocuments` == same surface as read access:
 *       admin / hr / originating agent / assigned closer)
 *   3. re-validates the DECODED bytes (magic-byte sniff + size), never the
 *      client-declared type or extension
 *   4. persists the row + bytes, or streams the bytes back
 *   5. audits upload / delete (security-significant: adds/removes lead PII)
 *
 * There is NO public URL. Downloads return base64 to the authenticated caller
 * only; the storage key never leaves the server.
 */
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { recordAudit } from "../audit";
import { assertCanAccessLeadDocuments } from "../authz/leads";
import { HttpError } from "../http-error";
import { nowIST } from "../time";
import * as repo from "../db/repos/leads";
import { resolveLeadActor } from "../db/repos/staff";
import {
  validateLeadDocumentUpload,
  MAX_LEAD_DOC_BYTES,
  type LeadDocMime,
} from "./document-validate";
import { getLeadDocStore, leadDocumentKey } from "./document-storage";
import type { User } from "@/lib/db/schema";

type Meta = { ip?: string | null; userAgent?: string | null };

export interface LeadDocumentDTO {
  id: number;
  lead_code: string;
  file_name: string;
  mime: LeadDocMime;
  size_bytes: number;
  uploaded_by_name: string | null;
  uploaded_by_role: string | null;
  created_at: string;
  /** true when the current caller may delete this document (admin or uploader) */
  can_delete: boolean;
}

export interface LeadDocumentDownload {
  file_name: string;
  mime: LeadDocMime;
  size_bytes: number;
  /** raw base64, NO `data:` prefix */
  base64: string;
}

/** cap the encoded payload at ~4/3 the decoded ceiling + slack */
export const MAX_LEAD_DOC_BASE64 = Math.ceil((MAX_LEAD_DOC_BYTES * 4) / 3) + 1024;

async function nameOf(userId: number | null): Promise<string | null> {
  if (userId == null) return null;
  const rows = await getDb()
    .select({ name: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.name ?? null;
}

async function namesOf(ids: number[]): Promise<Map<number, string>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const rows = await getDb()
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .where(inArray(users.id, uniq));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/* -------------------------------- list -------------------------------- */

export async function listLeadDocuments(user: User, leadCode: string): Promise<LeadDocumentDTO[]> {
  const lead = await repo.getLeadByCode(leadCode);
  if (!lead) throw new HttpError(404, "Lead not found", "not_found");
  const actor = await resolveLeadActor(user);
  assertCanAccessLeadDocuments(actor, lead);

  const rows = await repo.listLeadDocuments(lead.id);
  const names = await namesOf(
    rows.map((r) => r.uploadedByUserId).filter((x): x is number => x != null),
  );
  const isAdmin = user.role === "admin";
  return rows.map((r) => ({
    id: r.id,
    lead_code: lead.leadCode,
    file_name: r.fileName,
    mime: r.mime as LeadDocMime,
    size_bytes: r.sizeBytes,
    uploaded_by_name: r.uploadedByUserId != null ? (names.get(r.uploadedByUserId) ?? null) : null,
    uploaded_by_role: r.uploadedByRole,
    created_at: r.createdAt,
    can_delete: isAdmin || (r.uploadedByUserId != null && r.uploadedByUserId === user.id),
  }));
}

/* ------------------------------- upload ------------------------------- */

export interface UploadLeadDocumentInput {
  bytes: Uint8Array;
  filename?: string | null;
  declaredMime?: string | null;
}

export async function uploadLeadDocument(
  user: User,
  leadCode: string,
  input: UploadLeadDocumentInput,
  meta: Meta = {},
): Promise<LeadDocumentDTO> {
  const lead = await repo.getLeadByCode(leadCode);
  if (!lead) throw new HttpError(404, "Lead not found", "not_found");
  const actor = await resolveLeadActor(user);
  assertCanAccessLeadDocuments(actor, lead);

  const check = validateLeadDocumentUpload({
    bytes: input.bytes,
    filename: input.filename ?? null,
    declaredMime: input.declaredMime ?? null,
  });
  if (!check.ok) {
    const msg =
      check.reason === "file_too_large"
        ? "File is larger than the 10 MB limit"
        : check.reason === "file_too_small"
          ? "File is empty or corrupt"
          : "Only PDF, PNG, JPEG or WebP files are accepted";
    throw new HttpError(422, msg, check.reason);
  }

  const store = getLeadDocStore();
  const storageKey = leadDocumentKey(lead.leadCode, check.mime);
  await store.put(storageKey, input.bytes);

  let row;
  try {
    row = await repo.insertLeadDocument({
      leadId: lead.id,
      fileName: check.safeName,
      mime: check.mime,
      sizeBytes: input.bytes.length,
      storageKey,
      uploadedByUserId: user.id,
      uploadedByRole: user.role,
      createdAt: nowIST(),
    });
  } catch (err) {
    // roll the blob back so we never leak an orphan file
    await store.deleteKey(storageKey).catch(() => {});
    throw err;
  }

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "lead.document.upload",
    entityType: "lead",
    entityId: lead.id,
    entityCode: lead.leadCode,
    metadata: {
      document_id: row.id,
      file_name: check.safeName,
      mime: check.mime,
      size_bytes: input.bytes.length,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return {
    id: row.id,
    lead_code: lead.leadCode,
    file_name: row.fileName,
    mime: row.mime as LeadDocMime,
    size_bytes: row.sizeBytes,
    uploaded_by_name: await nameOf(row.uploadedByUserId),
    uploaded_by_role: row.uploadedByRole,
    created_at: row.createdAt,
    can_delete: true,
  };
}

/* ------------------------------ download ----------------------------- */

export async function downloadLeadDocument(
  user: User,
  documentId: number,
): Promise<LeadDocumentDownload> {
  const doc = await repo.getLeadDocumentById(documentId);
  if (!doc) throw new HttpError(404, "Document not found", "not_found");
  const lead = await repo.getLeadById(doc.leadId);
  if (!lead) throw new HttpError(404, "Lead not found", "not_found");
  const actor = await resolveLeadActor(user);
  assertCanAccessLeadDocuments(actor, lead);

  const bytes = await getLeadDocStore().get(doc.storageKey);
  if (!bytes) throw new HttpError(404, "Document file is missing", "blob_missing");

  return {
    file_name: doc.fileName,
    mime: doc.mime as LeadDocMime,
    size_bytes: doc.sizeBytes,
    base64: Buffer.from(bytes).toString("base64"),
  };
}

/* ------------------------------- delete ------------------------------ */

/** Single-document delete. Admin, or the user who uploaded it. */
export async function deleteLeadDocument(
  user: User,
  documentId: number,
  meta: Meta = {},
): Promise<{ deleted: true; id: number }> {
  const doc = await repo.getLeadDocumentById(documentId);
  if (!doc) throw new HttpError(404, "Document not found", "not_found");
  const lead = await repo.getLeadById(doc.leadId);
  if (!lead) throw new HttpError(404, "Lead not found", "not_found");
  const actor = await resolveLeadActor(user);
  assertCanAccessLeadDocuments(actor, lead);

  const isUploader = doc.uploadedByUserId != null && doc.uploadedByUserId === user.id;
  if (user.role !== "admin" && !isUploader) {
    throw new HttpError(403, "Only an admin or the uploader can delete this document", "forbidden");
  }

  await repo.deleteLeadDocumentRow(doc.id);
  await getLeadDocStore()
    .deleteKey(doc.storageKey)
    .catch(() => {});

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "lead.document.delete",
    entityType: "lead",
    entityId: lead.id,
    entityCode: lead.leadCode,
    metadata: { document_id: doc.id, file_name: doc.fileName },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { deleted: true, id: doc.id };
}

/**
 * Unlink every stored blob for a lead. Called by `deleteLead` (hard delete)
 * BEFORE the DB transaction removes the `lead_documents` rows (FK CASCADE), so
 * no file is left orphaned on disk. DB rows are handled by the transaction.
 */
export async function purgeLeadDocumentBlobs(leadId: number): Promise<number> {
  const keys = await repo.listLeadDocumentKeys(leadId);
  const store = getLeadDocStore();
  let removed = 0;
  for (const key of keys) {
    try {
      await store.deleteKey(key);
      removed += 1;
    } catch {
      /* best-effort — a missing file is not fatal to the hard delete */
    }
  }
  return removed;
}
