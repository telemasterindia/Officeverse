/**
 * Officeverse — office-network management service (Phase 23).
 *
 * HR / Admin only. Every add / edit / disable / remove is audited with the old
 * and new value. Disabling or removing the LAST active network for a process is
 * refused unless the caller passes `confirmLockout: true` (the UI shows a strong
 * impact warning first) — spec §24.
 *
 * No payroll / gamification / Office-TV imports.
 */
import { getDb, isDbConfigured } from "@/lib/db";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { nowIST } from "../time";
import { assertCanManageOfficeNetworks } from "../authz/office-networks";
import { isValidCidr, normalizeIp, parseCidr } from "./cidr";
import * as repo from "../db/repos/office-networks";
import type { OfficeNetwork, User } from "@/lib/db/schema";

type Meta = { ip?: string | null; userAgent?: string | null };
type ProcessCode = "US" | "UK" | "IN" | "AU";

export interface NetworkDTO {
  id: number;
  name: string;
  cidr: string;
  process: string | null;
  enabled: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

function toDTO(n: OfficeNetwork): NetworkDTO {
  return {
    id: n.id,
    name: n.name,
    cidr: n.cidr,
    process: n.process ?? null,
    enabled: n.enabled,
    note: n.note ?? null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    disabledAt: n.disabledAt ?? null,
  };
}

export async function listOfficeNetworks(
  actor: Pick<User, "role">,
): Promise<{ dbUnavailable?: boolean; rows: NetworkDTO[] }> {
  assertCanManageOfficeNetworks(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listNetworks();
  return { rows: rows.map(toDTO) };
}

function cleanCidr(raw: string): string {
  const p = parseCidr(raw.trim());
  if (!p) throw new HttpError(400, "Invalid IP / CIDR", "bad_cidr");
  // canonicalise a bare IP to an explicit host prefix
  if (raw.includes("/")) return raw.trim();
  return `${normalizeIp(raw)}/${p.family === 4 ? 32 : 128}`;
}

export async function addOfficeNetwork(
  actor: Pick<User, "id" | "role">,
  input: { name: string; cidr: string; process?: ProcessCode | null; note?: string },
  meta: Meta = {},
): Promise<{ ok: true; id: number }> {
  assertCanManageOfficeNetworks(actor.role);
  if (input.name.trim().length < 2) throw new HttpError(400, "A name is required", "name_required");
  if (!isValidCidr(input.cidr)) throw new HttpError(400, "Invalid IP / CIDR", "bad_cidr");
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const now = nowIST();
  const cidr = cleanCidr(input.cidr);
  const { id } = await repo.insertNetwork(
    {
      name: input.name.trim().slice(0, 80),
      cidr,
      process: input.process ?? null,
      enabled: true,
      note: input.note?.trim().slice(0, 255) || null,
      createdByUserId: actor.id,
      updatedByUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    },
    db,
  );
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "office_network.add",
    entityType: "office_network",
    entityId: id,
    metadata: { name: input.name.trim().slice(0, 80), cidr, process: input.process ?? null },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, id };
}

export async function updateOfficeNetwork(
  actor: Pick<User, "id" | "role">,
  id: number,
  patch: { name?: string; cidr?: string; process?: ProcessCode | null; note?: string },
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManageOfficeNetworks(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const before = await repo.getNetwork(id, db);
  if (!before) throw new HttpError(404, "Network not found", "not_found");

  const next: Record<string, unknown> = { updatedByUserId: actor.id, updatedAt: nowIST() };
  if (patch.name !== undefined) {
    if (patch.name.trim().length < 2)
      throw new HttpError(400, "A name is required", "name_required");
    next["name"] = patch.name.trim().slice(0, 80);
  }
  if (patch.cidr !== undefined) {
    if (!isValidCidr(patch.cidr)) throw new HttpError(400, "Invalid IP / CIDR", "bad_cidr");
    next["cidr"] = cleanCidr(patch.cidr);
  }
  if (patch.process !== undefined) next["process"] = patch.process ?? null;
  if (patch.note !== undefined) next["note"] = patch.note.trim().slice(0, 255) || null;

  await repo.updateNetwork(id, next, db);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "office_network.update",
    entityType: "office_network",
    entityId: id,
    metadata: {
      before: { name: before.name, cidr: before.cidr, process: before.process ?? null },
      after: {
        name: next["name"] ?? before.name,
        cidr: next["cidr"] ?? before.cidr,
        process: "process" in next ? next["process"] : (before.process ?? null),
      },
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

async function assertNotLastForProcess(
  process: string | null,
  id: number,
  confirmLockout: boolean,
): Promise<void> {
  if (confirmLockout) return;
  const others = await repo.countOtherActiveForProcess(process, id);
  if (others === 0) {
    throw new HttpError(
      409,
      process
        ? `This is the only active authorized network for ${process}. Disabling it may prevent attendance recording for ${process} employees.`
        : "This is the only active authorized network. Disabling it may prevent attendance recording and Agent sign-in.",
      "would_lock_out",
    );
  }
}

export async function setOfficeNetworkEnabled(
  actor: Pick<User, "id" | "role">,
  id: number,
  enabled: boolean,
  opts: { confirmLockout?: boolean; reason?: string } = {},
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManageOfficeNetworks(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const before = await repo.getNetwork(id, db);
  if (!before) throw new HttpError(404, "Network not found", "not_found");
  if (!enabled && before.enabled) {
    await assertNotLastForProcess(before.process ?? null, id, opts.confirmLockout === true);
  }
  const now = nowIST();
  await repo.updateNetwork(
    id,
    {
      enabled,
      disabledAt: enabled ? null : now,
      updatedByUserId: actor.id,
      updatedAt: now,
    },
    db,
  );
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: enabled ? "office_network.enable" : "office_network.disable",
    entityType: "office_network",
    entityId: id,
    metadata: {
      name: before.name,
      cidr: before.cidr,
      process: before.process ?? null,
      ...(opts.reason ? { reason: opts.reason.trim().slice(0, 300) } : {}),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

export async function removeOfficeNetwork(
  actor: Pick<User, "id" | "role">,
  id: number,
  opts: { confirmLockout?: boolean; reason?: string } = {},
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManageOfficeNetworks(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const before = await repo.getNetwork(id, db);
  if (!before) throw new HttpError(404, "Network not found", "not_found");
  if (before.enabled) {
    await assertNotLastForProcess(before.process ?? null, id, opts.confirmLockout === true);
  }
  await repo.deleteNetwork(id, db);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "office_network.remove",
    entityType: "office_network",
    entityId: id,
    metadata: {
      name: before.name,
      cidr: before.cidr,
      process: before.process ?? null,
      ...(opts.reason ? { reason: opts.reason.trim().slice(0, 300) } : {}),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}
