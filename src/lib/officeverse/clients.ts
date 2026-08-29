/**
 * TeleMaster India — Clients store.
 *
 * A Client is a separate entity from Agents and Closers — the customer-facing
 * organisation (or individual) a debt-relief file belongs to. Same
 * localStorage-backed pattern as the other stores; seeded once with a small
 * demo roster, then owns every `createClient` / `updateClient`.
 */
import { shiftDateIST } from "./shift";

export type ClientStatus = "Active" | "Prospect" | "Inactive" | "Closed";

export const CLIENT_STATUSES: ClientStatus[] = ["Active", "Prospect", "Inactive", "Closed"];

export interface ClientRecord {
  id: string; // "CLT-00001"
  /** Full name or company name. */
  name: string;
  /** Primary contact person (optional). */
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  status: ClientStatus;
  /** Date of Registration ("YYYY-MM-DD"). */
  registered_on: string;
  created_at: string;
}

const STORE_KEY = "officeverse.clients";
const listeners = new Set<() => void>();
let cache: ClientRecord[] | null = null;

function pad(n: number): string {
  return String(n).padStart(5, "0");
}

function seed(): ClientRecord[] {
  const rows: Omit<ClientRecord, "id" | "created_at">[] = [
    {
      name: "Northwind Debt Relief",
      contact_name: "Dana Whitfield",
      email: "dana@northwinddr.example",
      phone: "+1 415 555 0182",
      address: "500 Market St, San Francisco, CA",
      status: "Active",
      registered_on: "2026-06-14",
    },
    {
      name: "Acme Financial Group",
      contact_name: "Marcus Reed",
      email: "m.reed@acmefin.example",
      phone: "+1 312 555 0147",
      address: "88 Wacker Dr, Chicago, IL",
      status: "Active",
      registered_on: "2026-07-02",
    },
    {
      name: "Summit Credit Partners",
      contact_name: "Priya Anand",
      email: "priya@summitcp.example",
      phone: "+1 512 555 0111",
      address: "1200 Congress Ave, Austin, TX",
      status: "Prospect",
      registered_on: "2026-08-09",
    },
  ];
  return rows.map((r, i) => ({
    ...r,
    id: `CLT-${pad(i + 1)}`,
    created_at: `${r.registered_on}T09:00:00+05:30`,
  }));
}

function loadStore(): ClientRecord[] {
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
        cache = parsed as ClientRecord[];
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

export function loadClients(): ClientRecord[] {
  return loadStore();
}

export function subscribeClients(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getClient(id: string): ClientRecord | undefined {
  return loadStore().find((c) => c.id === id);
}

function nextId(): string {
  const max = loadStore().reduce((m, c) => Math.max(m, Number(c.id.slice(4)) || 0), 0);
  return `CLT-${pad(max + 1)}`;
}

export interface CreateClientInput {
  name: string;
  contact_name?: string;
  email: string;
  phone?: string;
  address?: string;
  status?: ClientStatus;
  registered_on?: string;
}

export function createClient(input: CreateClientInput): ClientRecord {
  const rec: ClientRecord = {
    id: nextId(),
    name: input.name.trim(),
    contact_name: input.contact_name?.trim() ?? "",
    email: input.email.trim(),
    phone: input.phone?.trim() ?? "",
    address: input.address?.trim() ?? "",
    status: input.status ?? "Prospect",
    registered_on: input.registered_on?.trim() || shiftDateIST(),
    created_at: new Date().toISOString(),
  };
  cache = [rec, ...loadStore()];
  emit();
  return rec;
}

export function updateClient(
  id: string,
  patch: Partial<Omit<ClientRecord, "id" | "created_at">>,
): ClientRecord | null {
  const list = loadStore();
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const next = { ...list[i]!, ...patch };
  cache = list.map((c, idx) => (idx === i ? next : c));
  emit();
  return next;
}
