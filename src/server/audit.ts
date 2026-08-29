/**
 * Officeverse — audit logging (Phase 13).
 *
 * `recordAudit` writes one row to `audit_logs`. Metadata is sanitised: any key
 * whose name looks like a secret (password / hash / token / secret / authorization)
 * is dropped before persistence. Passwords and hashes are NEVER stored.
 */
import { getDb } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { nowIST } from "./time";

export type AuditActorRole = "admin" | "agent" | "closer" | "hr" | "system";

export interface AuditInput {
  actorUserId?: number | null;
  actorRole?: AuditActorRole | null;
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  entityCode?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

const SECRET_KEY = /(password|passwd|pwd|hash|secret|token|authorization|api[_-]?key)/i;

export function sanitizeMetadata(
  meta: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!meta) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] =
      v && typeof v === "object" && !Array.isArray(v)
        ? sanitizeMetadata(v as Record<string, unknown>)
        : v;
  }
  return out;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  await getDb()
    .insert(auditLogs)
    .values({
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      entityCode: input.entityCode ?? null,
      metadata: sanitizeMetadata(input.metadata),
      ip: input.ip ?? null,
      userAgent: (input.userAgent ?? null)?.slice(0, 255) ?? null,
      createdAt: nowIST(),
    });
}
