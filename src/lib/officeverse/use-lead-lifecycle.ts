/**
 * Officeverse — REAL Agent/Closer lead + follow-up lifecycle (Phase 24A).
 *
 * React Query hooks over the authoritative server functions
 * (lead-fns.ts / followup-fns.ts -> the server service layer -> MySQL). The
 * server owns identity, role, process, the canonical TMI_ / FU_ codes,
 * audit, gamification recognition and Office-TV events. Nothing here is
 * localStorage-backed; every mutation invalidates and refetches server state.
 *
 * Small adapters map the server DTOs onto the field names the existing route
 * JSX already uses (`submitted_by`, `assigned_closer`, …) so the wiring is a
 * near pass-through.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkLeadDuplicateFn,
  createLeadFn,
  deleteLeadFn,
  deleteLeadDocumentFn,
  downloadLeadDocumentFn,
  getLeadFn,
  eligibleClosersFn,
  leadDocumentsFn,
  listLeadsFn,
  transferLeadFn,
  updateLeadFn,
  uploadLeadDocumentFn,
} from "./lead-fns";
import {
  cancelFollowUpFn,
  completeFollowUpFn,
  convertFollowUpToLeadFn,
  createFollowUpFn,
  getFollowUpFn,
  listFollowUpsFn,
  rescheduleFollowUpFn,
  updateFollowUpCustomerFn,
} from "./followup-fns";
import type { LeadDTO } from "@/server/leads/dto";
import type { FollowUpDTO } from "@/server/followups/dto";
import type { LeadStatus } from "./types";

/* ------------------------------- adapters ------------------------------- */

export interface UiLead {
  lead_id: string;
  customer_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  debt_amount: number;
  credit: string;
  current_late: "Current" | "Late";
  comment: string;
  file_name: string;
  submitted_by: string;
  assigned_closer: string;
  assigned_closer_code: string | null;
  agent_code: string | null;
  /** lead's process (US / IN / …) — scopes the closer picker to eligible closers */
  process: string | null;
  status: LeadStatus;
  source: LeadDTO["source"];
  converted_from_follow_up: boolean;
  created_at: string;
  last_activity: string;
}

export function leadDtoToUi(d: LeadDTO): UiLead {
  return {
    lead_id: d.lead_id,
    customer_name: d.customer_name,
    email: d.email ?? "",
    phone: d.phone,
    address: d.address ?? "",
    city: d.city ?? "",
    state: d.state ?? "",
    zip: d.zip ?? "",
    debt_amount: d.debt_amount,
    credit: d.credit ?? "—",
    current_late: d.current_late,
    comment: d.comment ?? "",
    file_name: d.file_name ?? "",
    submitted_by: d.agent_name ?? d.agent_code ?? "—",
    assigned_closer: d.assigned_closer_name ?? d.assigned_closer_code ?? "—",
    assigned_closer_code: d.assigned_closer_code,
    agent_code: d.agent_code,
    process: d.process ?? null,
    status: d.status as LeadStatus,
    source: d.source,
    converted_from_follow_up: d.converted_from_follow_up,
    created_at: d.shift_date,
    last_activity: d.updated_at,
  };
}

/* -------------------------------- leads -------------------------------- */

export function useServerLeads(
  input: Record<string, unknown> = {},
  opts: { enabled?: boolean } = {},
) {
  const q = useQuery({
    queryKey: ["srv-leads", input],
    queryFn: () => listLeadsFn({ data: input }),
    staleTime: 5_000,
    enabled: opts.enabled ?? true,
  });
  return { ...q, leads: (q.data?.leads ?? []).map(leadDtoToUi), total: q.data?.total ?? 0 };
}

export function useServerLead(code: string | null) {
  const q = useQuery({
    queryKey: ["srv-lead", code],
    queryFn: () => getLeadFn({ data: { code: code as string } }),
    enabled: !!code && /^TMI_\d{8}$/.test(code),
    staleTime: 5_000,
  });
  return { ...q, lead: q.data ? leadDtoToUi(q.data.lead) : null };
}

/**
 * Inline duplicate check for the New-Customer form. Pass the ALREADY-DEBOUNCED,
 * ALREADY-CLIENT-VALIDATED phone digits / lower-cased email (or null). The query
 * only fires when at least one key is present, and React Query caches per key so
 * re-focusing a field never re-hits the server.
 */
export function useLeadDuplicateCheck(keys: { phone: string | null; email: string | null }) {
  const enabled = Boolean(keys.phone || keys.email);
  return useQuery({
    queryKey: ["lead-dup", keys.phone ?? "", keys.email ?? ""],
    queryFn: () =>
      checkLeadDuplicateFn({
        data: {
          ...(keys.phone ? { phone: keys.phone } : {}),
          ...(keys.email ? { email: keys.email } : {}),
        },
      }),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useCreateServerLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => createLeadFn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["srv-leads"] }),
  });
}

export function useUpdateServerLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { code: string; patch: Record<string, unknown> }) => updateLeadFn({ data: v }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["srv-leads"] });
      qc.invalidateQueries({ queryKey: ["srv-lead", r.lead.lead_id] });
    },
  });
}

export function useTransferServerLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { code: string; to_closer_code: string; note?: string }) =>
      transferLeadFn({ data: v }),
    onSuccess: (r) => {
      // Admin UAT §2 — ownership must reflect immediately for the new closer,
      // everywhere. Refresh leads, follow-ups, the assignment roster and the
      // closer/leaderboard caches, not just this lead.
      qc.invalidateQueries({ queryKey: ["srv-leads"] });
      qc.invalidateQueries({ queryKey: ["srv-lead", r.lead.lead_id] });
      qc.invalidateQueries({ queryKey: ["srv-followups"] });
      qc.invalidateQueries({ queryKey: ["srv-closers"] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
    },
  });
}

/**
 * Eligible closers for a lead assignment / reassignment picker. Pass the lead
 * code (detail-page reassign) or the chosen originating agent code (New Lead
 * form) so the server resolves the correct process; the returned list is
 * already active + same-process + minus the current closer — the picker no
 * longer filters "all closers" itself.
 */
export function useAssignableClosers(opts: { leadCode?: string; agentCode?: string } = {}) {
  const q = useQuery({
    queryKey: ["srv-closers", opts.leadCode ?? null, opts.agentCode ?? null],
    queryFn: () =>
      eligibleClosersFn({
        data: {
          ...(opts.leadCode ? { lead_code: opts.leadCode } : {}),
          ...(opts.agentCode ? { agent_code: opts.agentCode } : {}),
        },
      }),
    staleTime: 30_000,
  });
  return {
    ...q,
    closers: q.data?.closers ?? [],
    resolvedProcess: q.data?.process ?? null,
    currentCloserCode: q.data?.currentCloserCode ?? null,
  };
}

/* --------------------- lead supporting documents -------------------- */

export type UiLeadDocument = Awaited<ReturnType<typeof leadDocumentsFn>>["documents"][number];

/** File-size ceiling mirrored from the server validator (10 MB). */
export const LEAD_DOC_MAX_BYTES = 10 * 1024 * 1024;
export const LEAD_DOC_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i] as number);
  return btoa(bin);
}

export function useLeadDocuments(leadCode: string | null) {
  const q = useQuery({
    queryKey: ["srv-lead-docs", leadCode],
    queryFn: () => leadDocumentsFn({ data: { lead_code: leadCode as string } }),
    enabled: !!leadCode && /^TMI_\d{8}$/.test(leadCode),
    staleTime: 10_000,
  });
  return { ...q, documents: q.data?.documents ?? [] };
}

export function useUploadLeadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { lead_code: string; file: File }) => {
      const data_base64 = await fileToBase64(v.file);
      return uploadLeadDocumentFn({
        data: {
          lead_code: v.lead_code,
          filename: v.file.name,
          ...(v.file.type ? { mime: v.file.type } : {}),
          data_base64,
        },
      });
    },
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ["srv-lead-docs", v.lead_code] }),
  });
}

export function useDeleteLeadDocument(leadCode: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { document_id: number }) => deleteLeadDocumentFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["srv-lead-docs", leadCode] }),
  });
}

/** Fetch a document's bytes and hand the browser a save dialog. No public URL. */
export function useDownloadLeadDocument() {
  return useMutation({
    mutationFn: async (v: { document_id: number }) => {
      const res = await downloadLeadDocumentFn({ data: v });
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: res.mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.file_name;
      a.click();
      URL.revokeObjectURL(url);
      return res;
    },
  });
}

/* --------------------------- hard delete ---------------------------- */

export function useDeleteServerLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { code: string }) => deleteLeadFn({ data: v }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["srv-leads"] });
      qc.removeQueries({ queryKey: ["srv-lead", v.code] });
      qc.removeQueries({ queryKey: ["srv-lead-docs", v.code] });
      qc.invalidateQueries({ queryKey: ["srv-followups"] });
      qc.invalidateQueries({ queryKey: ["lead-dup"] });
    },
  });
}

/* ------------------------------ follow-ups ---------------------------- */

export interface UiFollowUp extends Omit<FollowUpDTO, "converted_lead_id" | "lead_id"> {
  lead_id: string | null;
  converted_lead_id: string | null;
  owner_id: string;
}

export function fuDtoToUi(d: FollowUpDTO): UiFollowUp {
  return {
    ...d,
    lead_id: d.lead_id ?? null,
    converted_lead_id: d.converted_lead_id ?? null,
    owner_name: d.owner_name ?? "—",
    created_by: d.created_by ?? "—",
    owner_id: "", // internal id is deliberately not exposed by the DTO
  };
}

export function useServerFollowUps(input: Record<string, unknown> = {}) {
  const q = useQuery({
    queryKey: ["srv-followups", input],
    queryFn: () => listFollowUpsFn({ data: input }),
    staleTime: 5_000,
  });
  return { ...q, followUps: (q.data?.followUps ?? []).map(fuDtoToUi), total: q.data?.total ?? 0 };
}

export function useServerFollowUp(code: string | null) {
  const q = useQuery({
    queryKey: ["srv-followup", code],
    queryFn: () => getFollowUpFn({ data: { code: code as string } }),
    enabled: !!code && /^FU_\d{8}$/.test(code),
    staleTime: 5_000,
  });
  return { ...q, followUp: q.data ? fuDtoToUi(q.data.followUp) : null };
}

export function useCreateServerFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => createFollowUpFn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["srv-followups"] }),
  });
}

function invalidateFu(qc: ReturnType<typeof useQueryClient>, code: string) {
  qc.invalidateQueries({ queryKey: ["srv-followups"] });
  qc.invalidateQueries({ queryKey: ["srv-followup", code] });
  qc.invalidateQueries({ queryKey: ["srv-leads"] });
}

export function useUpdateServerFollowUpCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { code: string; patch: Record<string, unknown> }) =>
      updateFollowUpCustomerFn({ data: v }),
    onSuccess: (r) => invalidateFu(qc, r.followUp.follow_up_id),
  });
}

export function useRescheduleServerFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      code: string;
      scheduled_date: string;
      scheduled_time: string;
      reason?: string;
      expected_scheduled_at?: string;
    }) => rescheduleFollowUpFn({ data: v }),
    onSuccess: (r) => invalidateFu(qc, r.followUp.follow_up_id),
  });
}

export function useCompleteServerFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { code: string; note?: string }) => completeFollowUpFn({ data: v }),
    onSuccess: (r) => invalidateFu(qc, r.followUp.follow_up_id),
  });
}

export function useCancelServerFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { code: string; reason?: string }) => cancelFollowUpFn({ data: v }),
    onSuccess: (r) => invalidateFu(qc, r.followUp.follow_up_id),
  });
}

export function useConvertServerFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { code: string; to_closer_code?: string; note?: string }) =>
      convertFollowUpToLeadFn({ data: v }),
    onSuccess: (r) => {
      invalidateFu(qc, r.followUp.follow_up_id);
    },
  });
}
