/**
 * TeleMaster India — Lead store.
 *
 * The Lead is the single source of truth for customer identity (name / phone /
 * email / address / file). Follow-ups only ever reference `lead_id`.
 *
 * Persistence: localStorage (same mechanism as the session / avatar / follow-up
 * stores). Seeded once from the demo `LEADS`, then owns every `createLead`.
 * Swap `loadStore` / `persist` for a real API to go live — nothing else changes.
 */
import { CLOSERS, LEADS as SEED_LEADS } from "./data";
import { shiftDateIST } from "./shift";
import type { Lead, LeadStatus, ProcessCode } from "./types";

const STORE_KEY = "officeverse.leads";
const listeners = new Set<() => void>();
let cache: Lead[] | null = null;

function loadStore(): Lead[] {
  if (cache) return cache;
  if (typeof window === "undefined") {
    cache = [...SEED_LEADS];
    return cache;
  }
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        cache = parsed as Lead[];
        return cache;
      }
    }
  } catch {
    /* ignore */
  }
  cache = [...SEED_LEADS];
  persist();
  return cache;
}

function persist() {
  if (typeof window === "undefined" || !cache) return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

export function loadLeads(): Lead[] {
  return loadStore();
}

export function subscribeLeads(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getLead(leadId: string): Lead | undefined {
  return loadStore().find((l) => l.lead_id === leadId);
}

export function searchLeads(q: string, limit = 8): Lead[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const digits = s.replace(/\D/g, "");
  return loadStore()
    .filter((l) => {
      if (l.lead_id.toLowerCase().includes(s)) return true;
      if (l.customer_name.toLowerCase().includes(s)) return true;
      if (l.email.toLowerCase().includes(s)) return true;
      if (digits.length >= 3 && l.phone.replace(/\D/g, "").includes(digits)) return true;
      return false;
    })
    .slice(0, limit);
}

function nextLeadId(): string {
  const list = loadStore();
  const nums = list
    .map((l) => Number(l.lead_id.replace(/\D/g, "")))
    .filter((n) => Number.isFinite(n));
  const max = nums.length ? Math.max(...nums) : 12000;
  return `TMI_${String(max + 7).padStart(8, "0")}`;
}

export interface CreateLeadInput {
  customer_name: string;
  email: string;
  phone: string;
  /** Lead date ("YYYY-MM-DD"). Defaults to the current operational shift date. */
  date?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  debt_amount?: number;
  credit?: string;
  current_late?: "Current" | "Late";
  comment?: string;
  file_name?: string;
  submitted_by: string;
  assigned_closer?: string;
  process?: ProcessCode;
}

export function createLead(input: CreateLeadInput): Lead {
  const lead: Lead = {
    lead_id: nextLeadId(),
    customer_name: input.customer_name.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
    address: input.address?.trim() ?? "",
    city: input.city?.trim() ?? "",
    state: input.state?.trim() ?? "",
    zip: input.zip?.trim() ?? "",
    debt_amount: input.debt_amount ?? 0,
    credit: input.credit ?? "—",
    current_late: input.current_late ?? "Current",
    comment: input.comment?.trim() ?? "",
    file_name: input.file_name?.trim() ?? "",
    submitted_by: input.submitted_by,
    assigned_closer: input.assigned_closer?.trim() || CLOSERS[0]!,
    status: "NEW" as LeadStatus,
    created_at: input.date?.trim() || shiftDateIST(),
    last_activity: "Just now",
    process: input.process ?? "US",
  };
  cache = [lead, ...loadStore()]; // new array ref so subscribers re-render
  emit();
  return lead;
}
