/**
 * Officeverse — client (customer organisation) directory repository.
 *
 * Data access only. The `clients` table is the AUTHORITATIVE store — this
 * replaces the old client-side localStorage `officeverse.clients` demo store.
 * Authorization (Admin / HR) is enforced one layer up in `clients/service.ts`.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import { clients, type Client } from "@/lib/db/schema";
import { clientCode as fmtClientCode, nextStaffSeq } from "../../ids";

export type ClientStatus = "active" | "prospect" | "inactive" | "closed";

export interface NewClientRow {
  clientCode: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: ClientStatus;
  registeredOn: string;
}

/** Next `CLT-#####` code, computed from the current max (mirrors staff codes). */
export async function nextClientCode(ex: DBX = getDb()): Promise<string> {
  const rows = await ex
    .select({
      max: sql<number | null>`max(cast(substring(${clients.clientCode}, 5) as unsigned))`,
    })
    .from(clients);
  return fmtClientCode(nextStaffSeq(rows[0]?.max ?? 0));
}

export async function getClientByCode(code: string): Promise<Client | undefined> {
  const rows = await getDb().select().from(clients).where(eq(clients.clientCode, code)).limit(1);
  return rows[0];
}

/** Insert one client row and return it. */
export async function insertClient(input: NewClientRow, now: string): Promise<Client> {
  const inserted = await getDb()
    .insert(clients)
    .values({
      clientCode: input.clientCode,
      name: input.name,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      address: input.address,
      status: input.status,
      registeredOn: input.registeredOn,
      createdAt: now,
      updatedAt: now,
    })
    .$returningId();
  const id = Number(inserted[0]?.id ?? 0);
  if (!id) throw new Error("client_insert_failed");
  const row = await getDb().select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!row[0]) throw new Error("client_insert_failed");
  return row[0];
}

export interface ListClientsOpts {
  q?: string;
  status?: ClientStatus;
}

/** The full client directory, newest first, with optional search + status filter. */
export async function listClientRows(opts: ListClientsOpts = {}): Promise<Client[]> {
  const conds = [];
  if (opts.status) conds.push(eq(clients.status, opts.status));
  if (opts.q && opts.q.trim()) {
    const term = `%${opts.q.trim()}%`;
    conds.push(
      sql`(${clients.name} like ${term} or ${clients.email} like ${term} or ${clients.contactName} like ${term} or ${clients.clientCode} like ${term})`,
    );
  }
  return getDb()
    .select()
    .from(clients)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(clients.id), asc(clients.name));
}

export interface UpdateClientPatch {
  contactName?: string | null;
  phone?: string | null;
  address?: string | null;
  status?: ClientStatus;
}

/** Patch a client row (Admin / HR only — asserted in the service). */
export async function updateClientRow(
  id: number,
  patch: UpdateClientPatch,
  now: string,
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.contactName !== undefined) set["contactName"] = patch.contactName;
  if (patch.phone !== undefined) set["phone"] = patch.phone;
  if (patch.address !== undefined) set["address"] = patch.address;
  if (patch.status !== undefined) set["status"] = patch.status;
  await getDb().update(clients).set(set).where(eq(clients.id, id));
}
