/**
 * Officeverse — Lead → client-safe DTO (Phase 3).
 *
 * Shape mirrors the existing `Lead` type in src/lib/officeverse/types.ts so the
 * later UI wiring is a direct pass-through. Deliberately OMITS internal columns
 * (numeric id, phone_normalized/email_normalized, agent_id/assigned_closer_id,
 * import_id, converted_from_follow_up_id) and never carries secrets.
 */
import type { Lead } from "@/lib/db/schema";

export interface LeadDTO {
  lead_id: string;
  shift_date: string;
  customer_name: string;
  phone: string;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  debt_amount: number;
  credit: string | null;
  current_late: Lead["currentDebts"];
  file_name: string | null;
  comment: string | null;
  status: Lead["status"];
  source: Lead["source"];
  agent_code: string | null;
  agent_name: string | null;
  assigned_closer_code: string | null;
  assigned_closer_name: string | null;
  converted_from_follow_up: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadDTOMeta {
  agentCode?: string | null;
  agentName?: string | null;
  closerCode?: string | null;
  closerName?: string | null;
}

export function toLeadDTO(row: Lead, meta: LeadDTOMeta = {}): LeadDTO {
  return {
    lead_id: row.leadCode,
    shift_date: row.shiftDate,
    customer_name: row.customerName,
    phone: row.phone,
    email: row.email ?? null,
    address: row.address ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    zip: row.zip ?? null,
    debt_amount: Number(row.debtAmount),
    credit: row.creditStatus ?? null,
    current_late: row.currentDebts,
    file_name: row.leadFile ?? null,
    comment: row.comments ?? null,
    status: row.status,
    source: row.source,
    agent_code: meta.agentCode ?? null,
    agent_name: meta.agentName ?? null,
    assigned_closer_code: meta.closerCode ?? null,
    assigned_closer_name: meta.closerName ?? null,
    converted_from_follow_up: row.convertedFromFollowUpId != null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
