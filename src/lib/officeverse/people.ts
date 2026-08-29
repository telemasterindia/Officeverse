/**
 * TeleMaster India — Agents & Closers store.
 *
 * Agents and Closers are SEPARATE entities (distinct `kind`, distinct create
 * forms, distinct list pages) that share one persistence mechanism — the same
 * localStorage-backed pattern as the Lead / Follow-up stores. Seeded once from
 * the demo `EMPLOYEES` roster, then owns every `createPerson` / `updatePerson`.
 * Swap `loadStore` / `persist` for a real API to go live.
 *
 * Agents run the operational shift; their "Date of Registration" is the
 * canonical SHIFT DATE (see ./shift — `shiftDateIST`), never a post-midnight
 * calendar roll.
 */
import { EMPLOYEES } from "./data";
import { shiftDateIST } from "./shift";
import type { ProcessCode } from "./types";

export type PersonKind = "agent" | "closer";
export type PersonStatus = "Active" | "Inactive" | "Suspended" | "On Leave";

export const PERSON_STATUSES: PersonStatus[] = ["Active", "Inactive", "Suspended", "On Leave"];

export interface PersonRecord {
  id: string; // "AG-00001" / "CL-00001"
  kind: PersonKind;
  full_name: string;
  email: string;
  phone: string;
  /** Date of birth ("YYYY-MM-DD"). */
  dob: string;
  /** Date of Registration — for agents this is the operational SHIFT DATE. */
  registered_on: string;
  /** Monthly salary (agents). 0 when not captured. */
  monthly_salary: number;
  status: PersonStatus;
  process: ProcessCode;
  /**
   * Captured on the Create form. NEVER rendered in any list or detail view.
   * Plain-text here only because this build has no backend — see the report.
   */
  password: string;
  created_at: string; // ISO
}

const STORE_KEY = "officeverse.people";
const listeners = new Set<() => void>();
let cache: PersonRecord[] | null = null;

function pad(n: number): string {
  return String(n).padStart(5, "0");
}

function emailFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "");
  return `${slug || "user"}@exclusiveverifiedleads.com`;
}

function seed(): PersonRecord[] {
  let ag = 0;
  let cl = 0;
  return EMPLOYEES.filter((e) => e.department === "Sales" || e.department === "Closing").map(
    (e) => {
      const kind: PersonKind = e.department === "Sales" ? "agent" : "closer";
      const n = kind === "agent" ? ++ag : ++cl;
      return {
        id: `${kind === "agent" ? "AG" : "CL"}-${pad(n)}`,
        kind,
        full_name: e.name,
        email: emailFromName(e.name),
        phone: "",
        dob: "",
        registered_on: e.joining_date,
        monthly_salary: kind === "agent" ? 45000 : 65000,
        status: e.status === "On Leave" ? "On Leave" : "Active",
        process: e.process,
        password: "",
        created_at: `${e.joining_date}T09:00:00+05:30`,
      } satisfies PersonRecord;
    },
  );
}

function loadStore(): PersonRecord[] {
  if (cache) return cache;
  if (typeof window === "undefined") {
    cache = seed();
    return cache;
  }
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        cache = parsed as PersonRecord[];
        return cache;
      }
    }
  } catch {
    /* ignore */
  }
  cache = seed();
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

export function loadPeople(): PersonRecord[] {
  return loadStore();
}

export function subscribePeople(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getPerson(id: string): PersonRecord | undefined {
  return loadStore().find((p) => p.id === id);
}

function nextId(kind: PersonKind): string {
  const prefix = kind === "agent" ? "AG" : "CL";
  const max = loadStore()
    .filter((p) => p.id.startsWith(prefix))
    .reduce((m, p) => Math.max(m, Number(p.id.slice(3)) || 0), 0);
  return `${prefix}-${pad(max + 1)}`;
}

export interface CreatePersonInput {
  kind: PersonKind;
  full_name: string;
  email: string;
  password: string;
  phone?: string;
  dob?: string;
  /** Defaults to the current operational shift date. */
  registered_on?: string;
  monthly_salary?: number;
  status?: PersonStatus;
  process?: ProcessCode;
}

export function createPerson(input: CreatePersonInput): PersonRecord {
  const rec: PersonRecord = {
    id: nextId(input.kind),
    kind: input.kind,
    full_name: input.full_name.trim(),
    email: input.email.trim(),
    phone: input.phone?.trim() ?? "",
    dob: input.dob?.trim() ?? "",
    registered_on: input.registered_on?.trim() || shiftDateIST(),
    monthly_salary: input.monthly_salary ?? 0,
    status: input.status ?? "Active",
    process: input.process ?? "US",
    password: input.password,
    created_at: new Date().toISOString(),
  };
  cache = [rec, ...loadStore()]; // new array ref so subscribers re-render
  emit();
  return rec;
}

export function updatePerson(
  id: string,
  patch: Partial<Omit<PersonRecord, "id" | "kind" | "created_at">>,
): PersonRecord | null {
  const list = loadStore();
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const next = { ...list[i]!, ...patch };
  cache = list.map((p, idx) => (idx === i ? next : p));
  emit();
  return next;
}
