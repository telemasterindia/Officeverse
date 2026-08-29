/**
 * Officeverse — Admin export authorization (Phase 8). PURE.
 *
 * ADMIN only. No existing business rule grants Agent / Closer / HR a bulk data
 * export, so none is added here. The role comes from the authenticated session
 * (context.requireRole) — never from the client.
 */
import { HttpError } from "../http-error";

export type ExportRole = "admin" | "agent" | "closer" | "hr";

export function canExport(role: ExportRole): boolean {
  return role === "admin";
}

export function assertCanExport(role: ExportRole): void {
  if (!canExport(role)) {
    throw new HttpError(403, "Only an Admin may export Officeverse data", "forbidden");
  }
}
