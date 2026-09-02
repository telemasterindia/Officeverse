/**
 * Officeverse — client (customer organisation) directory service.
 *
 * The AUTHORITATIVE client records live in the `clients` MySQL table. This
 * replaces the old client-side localStorage `officeverse.clients` demo store —
 * nothing about the client roster is kept in the browser any more.
 *
 *   - create → Admin / HR only; server-generated CLT-##### code; audited.
 *   - list   → Admin / HR only (a client organisation is a back-office record;
 *              Agents / Closers work leads, not the client roster).
 *   - update → Admin / HR only; audited.
 *
 * Clients are not process-scoped in the schema, so there is no US/India split
 * here — process separation is enforced on leads / follow-ups / staff, which is
 * where it is meaningful.
 */
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { assertCanManageClients } from "../authz/clients";
import { nowIST } from "../time";
import * as repo from "../db/repos/clients";
import type { Client } from "@/lib/db/schema";
import type { User } from "@/lib/db/schema";

type Meta = { ip?: string | null; userAgent?: string | null };

export type ClientStatus = repo.ClientStatus;
export const CLIENT_STATUS_VALUES: ClientStatus[] = ["active", "prospect", "inactive", "closed"];

/** The shape sent to the client — no internal row id, no timestamps beyond the
 *  business-meaningful registration date. */
export interface ClientDTO {
  code: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  status: ClientStatus;
  registered_on: string;
}

function toDTO(r: Client): ClientDTO {
  return {
    code: r.clientCode,
    name: r.name,
    contact_name: r.contactName ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    address: r.address ?? "",
    status: r.status as ClientStatus,
    registered_on: r.registeredOn,
  };
}

export interface CreateClientInput {
  name: string;
  contact_name?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  address?: string | undefined;
  status?: ClientStatus | undefined;
  registered_on?: string | undefined;
}

export async function createClient(
  actor: User,
  input: CreateClientInput,
  meta: Meta = {},
): Promise<ClientDTO> {
  assertCanManageClients(actor.role);

  const now = nowIST();
  const code = await repo.nextClientCode();
  const row = await repo.insertClient(
    {
      clientCode: code,
      name: input.name.trim(),
      contactName: input.contact_name?.trim() ? input.contact_name.trim() : null,
      email: input.email?.trim() ? input.email.trim().toLowerCase() : null,
      phone: input.phone?.trim() ? input.phone.trim() : null,
      address: input.address?.trim() ? input.address.trim() : null,
      status: input.status ?? "prospect",
      registeredOn: input.registered_on?.trim() ? input.registered_on.trim() : now.slice(0, 10),
    },
    now,
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "client.created",
    entityType: "client",
    entityId: row.id,
    entityCode: code,
    metadata: { name: row.name, status: row.status },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return toDTO(row);
}

export interface ListClientsResult {
  clients: ClientDTO[];
}

export async function listClients(
  actor: Pick<User, "role">,
  input: { q?: string | undefined; status?: ClientStatus | undefined } = {},
): Promise<ListClientsResult> {
  assertCanManageClients(actor.role);
  const rows = await repo.listClientRows({
    ...(input.q ? { q: input.q } : {}),
    ...(input.status ? { status: input.status } : {}),
  });
  return { clients: rows.map(toDTO) };
}

export interface UpdateClientInput {
  code: string;
  contact_name?: string | undefined;
  phone?: string | undefined;
  address?: string | undefined;
  status?: ClientStatus | undefined;
}

export async function updateClient(
  actor: User,
  input: UpdateClientInput,
  meta: Meta = {},
): Promise<ClientDTO> {
  assertCanManageClients(actor.role);

  const existing = await repo.getClientByCode(input.code);
  if (!existing) throw new HttpError(404, `Client ${input.code} not found`, "not_found");

  await repo.updateClientRow(
    existing.id,
    {
      ...(input.contact_name !== undefined
        ? { contactName: input.contact_name.trim() || null }
        : {}),
      ...(input.phone !== undefined ? { phone: input.phone.trim() || null } : {}),
      ...(input.address !== undefined ? { address: input.address.trim() || null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
    nowIST(),
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "client.updated",
    entityType: "client",
    entityId: existing.id,
    entityCode: input.code,
    metadata: {
      ...(input.status !== undefined ? { from: existing.status, to: input.status } : {}),
      fields: Object.keys(input).filter((k) => k !== "code"),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  const updated = await repo.getClientByCode(input.code);
  return toDTO(updated ?? existing);
}
