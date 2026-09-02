/**
 * Officeverse — client-callable Lead server functions (Phase 3 / 17 · relocated
 * here in Phase 24A so routes can import them — everything under `src/server/**`
 * is import-protected from the client bundle).
 *
 * Every function: authenticates (requireUser / requireRole — the security
 * boundary) → validates input with Zod → delegates to the Lead service
 * (authorization + repo + audit + downstream recognition) → returns client-safe
 * DTOs only. The client never chooses the acting user, role, process, agent id,
 * status (except a Closer's own legal transitions), the canonical `TMI_` code,
 * or any audit actor.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRole, requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/leads/service";
import * as docSvc from "@/server/leads/document-service";
import { listActiveClosers } from "@/server/db/repos/staff";
import {
  createLeadSchema,
  getLeadSchema,
  listLeadsSchema,
  transferLeadSchema,
  updateLeadArgsSchema,
} from "@/server/validation/leads";
import type { LeadDTO } from "@/server/leads/dto";
import type { ListLeadsResult } from "@/server/leads/service";

export const listLeadsFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listLeadsSchema.parse(d ?? {}))
  .handler(async ({ data }): Promise<ListLeadsResult> => {
    const user = await requireUser();
    return svc.listLeads(user, data);
  });

export const getLeadFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => getLeadSchema.parse(d))
  .handler(async ({ data }): Promise<{ lead: LeadDTO }> => {
    const user = await requireUser();
    return { lead: await svc.getLead(user, data.code) };
  });

export const createLeadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createLeadSchema.parse(d))
  .handler(async ({ data }): Promise<{ lead: LeadDTO }> => {
    const user = await requireRole("admin", "agent");
    return { lead: await svc.createLead(user, data, requestInfo()) };
  });

/**
 * Inline (pre-submit) duplicate check for the New-Customer form. Read-only, no
 * side effects. The result is DB-authoritative and read-scoped — a duplicate on
 * a lead the caller may not read is reported as `{ visible: false }` with no id.
 * `createLead` still re-checks on submit, so this can never be a bypass.
 */
export const checkLeadDuplicateFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({
        phone: z.string().trim().max(40).optional(),
        email: z.string().trim().max(191).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<svc.LeadDuplicateCheck> => {
    const user = await requireUser();
    return svc.checkLeadDuplicate(user, data);
  });

export const updateLeadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateLeadArgsSchema.parse(d))
  .handler(async ({ data }): Promise<{ lead: LeadDTO }> => {
    const user = await requireUser();
    return { lead: await svc.updateLead(user, data.code, data.patch, requestInfo()) };
  });

export const transferLeadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => transferLeadSchema.parse(d))
  .handler(async ({ data }): Promise<{ lead: LeadDTO }> => {
    const user = await requireUser();
    return {
      lead: await svc.transferLead(
        user,
        data.code,
        data.to_closer_code,
        data.note ?? null,
        requestInfo(),
      ),
    };
  });

/**
 * Admin/Lead UAT §2 — TRUE hard delete. ADMIN ONLY (enforced again in the
 * service via `assertCanDeleteLead`). The lead row and its duplicate-detection
 * identity are permanently removed; this is not a soft delete. The client
 * confirms destructively in the UI, but the server is the authority.
 */
export const deleteLeadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        code: z
          .string()
          .trim()
          .regex(/^TMI_\d{8}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<svc.DeleteLeadResult> => {
    const user = await requireRole("admin");
    return svc.deleteLead(user, data.code, requestInfo());
  });

/* ------------------- supporting documents (§3–§6) ------------------- */

const leadDocCode = z
  .string()
  .trim()
  .regex(/^TMI_\d{8}$/);
const documentId = z.coerce.number().int().positive();

/** List a lead's supporting documents — metadata only, access-checked. */
export const leadDocumentsFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ lead_code: leadDocCode }).parse(d))
  .handler(async ({ data }): Promise<{ documents: docSvc.LeadDocumentDTO[] }> => {
    const user = await requireUser();
    return { documents: await docSvc.listLeadDocuments(user, data.lead_code) };
  });

/**
 * Upload one optional supporting document. `data_base64` is the raw file bytes
 * (no `data:` prefix); the server re-validates the DECODED bytes by magic-byte
 * sniff + size — the declared `mime` / filename extension are advisory only.
 */
export const uploadLeadDocumentFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        lead_code: leadDocCode,
        filename: z.string().trim().max(255).optional(),
        mime: z.string().trim().max(120).optional(),
        data_base64: z.string().min(16).max(docSvc.MAX_LEAD_DOC_BASE64),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ document: docSvc.LeadDocumentDTO }> => {
    const user = await requireUser();
    const bytes = new Uint8Array(Buffer.from(data.data_base64, "base64"));
    return {
      document: await docSvc.uploadLeadDocument(
        user,
        data.lead_code,
        {
          bytes,
          filename: data.filename ?? null,
          declaredMime: data.mime ?? null,
        },
        requestInfo(),
      ),
    };
  });

/** Download one document — base64 to the authenticated, authorized caller only.
 *  There is no public URL and no static route for these bytes. */
export const downloadLeadDocumentFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ document_id: documentId }).parse(d))
  .handler(async ({ data }): Promise<docSvc.LeadDocumentDownload> => {
    const user = await requireUser();
    return docSvc.downloadLeadDocument(user, data.document_id);
  });

/** Delete one document — admin or the original uploader. */
export const deleteLeadDocumentFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ document_id: documentId }).parse(d))
  .handler(async ({ data }): Promise<{ deleted: true; id: number }> => {
    const user = await requireUser();
    return docSvc.deleteLeadDocument(user, data.document_id, requestInfo());
  });

/** Active closers for the "assign to closer" picker — scoped to the caller's
 *  own process (a US Agent only sees US Closers, etc.). Admin sees all. */
export const listClosersFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async (): Promise<{ closers: { code: string; name: string; process: string }[] }> => {
    const user = await requireUser();
    const rows = await listActiveClosers(user.role === "admin" ? undefined : user.process);
    return { closers: rows };
  });

/**
 * The AUTHORITATIVE eligible-closer list for a lead assignment / reassignment
 * picker. The lead's process is resolved SERVER-SIDE (from the lead, else the
 * chosen originating agent, else the caller's process for a non-admin) so the
 * picker can never offer a closer the server's same-process + active rule would
 * reject. Every picker calls this instead of filtering "all closers" client-side.
 */
export const eligibleClosersFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({
        lead_code: z.string().trim().max(32).optional(),
        agent_code: z.string().trim().max(32).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.eligibleClosers(user, {
      ...(data.lead_code ? { leadCode: data.lead_code } : {}),
      ...(data.agent_code ? { agentCode: data.agent_code } : {}),
    });
  });
