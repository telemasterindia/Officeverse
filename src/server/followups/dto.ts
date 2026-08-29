/**
 * Officeverse — Follow-up → client-safe DTO (Phase 4).
 *
 * Mirrors the existing `FollowUpRecord` / `FollowUpCustomer` / `FollowUpAttempt`
 * shapes in src/lib/officeverse/followups.ts so later UI wiring is a
 * pass-through. Timestamps are surfaced as IST ISO strings (`…+05:30`), matching
 * the existing client convention; the DB stores bare wall-clock strings.
 *
 * OMITS internal columns (numeric ids, *_normalized, import_id, created_by id).
 */
import { wallToIstIso } from "../time";
import type { FollowUp, FollowUpAttempt } from "@/lib/db/schema";

export interface FollowUpCustomerDTO {
  date: string;
  full_name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  debt_amount: number;
  credit: string;
  current_late: FollowUp["currentDebts"] | "";
  comment: string;
}

export interface FollowUpAttemptDTO {
  attempt_no: number;
  scheduled_at: string;
  outcome: FollowUpAttempt["outcome"];
  note: string | null;
  related_lead_id: string | null;
  recorded_at: string;
}

export interface FollowUpDTO {
  follow_up_id: string;
  owner_role: FollowUp["ownerRole"];
  owner_name: string | null;
  customer: FollowUpCustomerDTO;
  customer_name: string;
  phone: string;
  scheduled_at: string;
  capture_date: string;
  comment: string | null;
  status: FollowUp["status"];
  attempts: FollowUpAttemptDTO[];
  lead_id: string | null;
  converted_lead_id: string | null;
  converted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FollowUpDTOMeta {
  ownerName?: string | null;
  createdByName?: string | null;
}

export function toFollowUpCustomerDTO(row: FollowUp): FollowUpCustomerDTO {
  return {
    date: row.captureDate,
    full_name: row.customerName,
    phone: row.phone,
    email: row.email ?? "",
    address: row.address ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    zip: row.zip ?? "",
    debt_amount: Number(row.debtAmount),
    credit: row.creditStatus ?? "",
    current_late: row.currentDebts ?? "",
    comment: row.comment ?? "",
  };
}

export function toAttemptDTO(a: FollowUpAttempt): FollowUpAttemptDTO {
  return {
    attempt_no: a.attemptNo,
    scheduled_at: wallToIstIso(a.scheduledAt),
    outcome: a.outcome,
    note: a.note ?? null,
    related_lead_id: a.relatedLeadCode ?? null,
    recorded_at: wallToIstIso(a.recordedAt),
  };
}

export function toFollowUpDTO(
  row: FollowUp,
  attempts: FollowUpAttempt[] = [],
  meta: FollowUpDTOMeta = {},
): FollowUpDTO {
  return {
    follow_up_id: row.followUpCode,
    owner_role: row.ownerRole,
    owner_name: meta.ownerName ?? null,
    customer: toFollowUpCustomerDTO(row),
    customer_name: row.customerName,
    phone: row.phone,
    scheduled_at: wallToIstIso(row.scheduledAt),
    capture_date: row.captureDate,
    comment: row.comment ?? null,
    status: row.status,
    attempts: attempts.map(toAttemptDTO),
    lead_id: row.convertedLeadCode ?? null,
    converted_lead_id: row.convertedLeadCode ?? null,
    converted_at: row.convertedAt ? wallToIstIso(row.convertedAt) : null,
    completed_at: row.completedAt ? wallToIstIso(row.completedAt) : null,
    cancelled_at: row.cancelledAt ? wallToIstIso(row.cancelledAt) : null,
    created_by: meta.createdByName ?? null,
    created_at: wallToIstIso(row.createdAt),
    updated_at: wallToIstIso(row.updatedAt),
  };
}
