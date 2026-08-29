/**
 * Officeverse — office-network management authorization (Phase 23). PURE.
 *
 * Only HR / Admin may view or change authorized office networks. Agents and
 * Closers can neither see nor manage them — the management surface is not
 * exposed to them and the server rejects the calls.
 */
import { HttpError } from "../http-error";

export function canManageOfficeNetworks(role: string): boolean {
  return role === "admin" || role === "hr";
}

export function assertCanManageOfficeNetworks(role: string): void {
  if (!canManageOfficeNetworks(role)) {
    throw new HttpError(403, "Only Admin / HR may manage office networks", "forbidden");
  }
}
