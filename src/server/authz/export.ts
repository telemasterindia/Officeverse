/**
 * Officeverse — export authorization (Phase 8). PURE.
 *
 * The role comes from the session, never the client.
 *
 *   canExport      — the full Data-Export centre (any dataset + filters).
 *                    ADMIN ONLY. Data Export is an Admin operational module; HR
 *                    has no access (Admin UAT — HR role separation).
 *   canSelfExport  — self-service export of ONLY one's own leads / follow-ups.
 *                    ADMIN + CLOSER (own). Agents and HR are excluded.
 */
import { HttpError } from "../http-error";

export type ExportRole = "admin" | "agent" | "closer" | "hr";

/** Full export centre — arbitrary datasets + filters. Admin only. */
export function canExport(role: ExportRole): boolean {
  return role === "admin";
}

export function assertCanExport(role: ExportRole): void {
  if (!canExport(role)) {
    throw new HttpError(403, "Only an Admin may use the Data Export centre", "forbidden");
  }
}

/** Self-service export of one's OWN leads / follow-ups. Agents + HR excluded. */
export function canSelfExport(role: ExportRole): boolean {
  return role === "admin" || role === "closer";
}

export function assertCanSelfExport(role: ExportRole): void {
  if (!canSelfExport(role)) {
    throw new HttpError(403, "You cannot export leads or follow-ups", "forbidden");
  }
}
