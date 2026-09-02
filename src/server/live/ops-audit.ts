/**
 * Officeverse — OPERATIONS CONTROL · audit reader (Phase 6.5). READ-ONLY.
 *
 * Returns the immutable `audit_logs` rows produced by the Operations Control
 * surface (scoring / incentive rules, team announcements, Power Hour,
 * celebration tests). It NEVER updates or deletes an audit row — there is no
 * write path in this module, and the UI has no mutation for audit records.
 *
 * Reuses the EXISTING Officeverse audit infrastructure (`audit_logs` +
 * `recordAudit`). No parallel audit system is created.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { User } from "@/lib/db/schema";
import { getDb, isDbConfigured } from "@/lib/db";
import { auditLogs, users } from "@/lib/db/schema";
import {
  OPERATIONS_AUDIT_ACTIONS,
  assertCanRunOperations,
  isOperationsAuditAction,
} from "../authz/operations";

export interface OperationsAuditRow {
  id: number;
  action: string;
  actorUserId: number | null;
  actorRole: string | null;
  actorName: string | null;
  entityType: string | null;
  entityId: number | null;
  /** JSON string of the sanitised audit metadata (before/after snapshots, context) */
  metadata: string | null;
  createdAt: string;
}

function safeJson(v: unknown): string | null {
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

export async function listOperationsAudit(
  actor: Pick<User, "role">,
  input: { limit?: number; action?: string } = {},
): Promise<{ dbUnavailable?: boolean; rows: OperationsAuditRow[] }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };

  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const actionFilter =
    input.action && isOperationsAuditAction(input.action)
      ? eq(auditLogs.action, input.action)
      : inArray(auditLogs.action, [...OPERATIONS_AUDIT_ACTIONS]);

  const rows = await getDb()
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorUserId: auditLogs.actorUserId,
      actorRole: auditLogs.actorRole,
      actorName: users.fullName,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(and(actionFilter))
    .orderBy(desc(auditLogs.id))
    .limit(limit);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorUserId: r.actorUserId ?? null,
      actorRole: r.actorRole ?? null,
      actorName: r.actorName ?? null,
      entityType: r.entityType ?? null,
      entityId: r.entityId ?? null,
      metadata: r.metadata == null ? null : safeJson(r.metadata),
      createdAt: r.createdAt,
    })),
  };
}
