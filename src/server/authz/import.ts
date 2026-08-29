/**
 * Officeverse — bulk-import authorization (Phase 7). PURE.
 *
 * OWNERSHIP MODEL (server-enforced; the spreadsheet is never trusted):
 *   - AGENT  → may bulk import. Every created Lead is owned by that agent
 *              (agent_id = self); an `agent_code` column that names anyone else
 *              rejects the row. Follow-ups are agent-owned by that same agent;
 *              an agent may NOT import closer-owned follow-ups.
 *   - ADMIN  → may bulk import. Assigns ownership via `agent_code` /
 *              `closer_code`, resolved server-side. A Lead with only a
 *              `closer_code` is a closer-originated Lead (agent_id NULL) —
 *              exactly the Phase-4-correction model; no fake agent.
 *   - CLOSER → NOT granted Agent-style bulk import (no existing rule requires it).
 *   - HR     → no import.
 */
import { HttpError } from "../http-error";

export type ImportRole = "admin" | "agent" | "closer" | "hr";

export interface ImportActor {
  role: ImportRole;
}

export function canBulkImport(a: ImportActor): boolean {
  return a.role === "admin" || a.role === "agent";
}

export function assertCanBulkImport(a: ImportActor): void {
  if (!canBulkImport(a)) {
    throw new HttpError(403, "Your role cannot run bulk imports", "forbidden");
  }
}

/** Whether this actor may set per-row ownership from the file. */
export function canAssignOwnershipFromFile(a: ImportActor): boolean {
  return a.role === "admin";
}

/** Whether this actor may import closer-owned follow-ups. */
export function canImportCloserOwnedFollowUps(a: ImportActor): boolean {
  return a.role === "admin";
}
