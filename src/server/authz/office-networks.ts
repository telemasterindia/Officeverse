/**
 * Officeverse — office-network management authorization (Phase 23; Admin UAT §11). PURE.
 *
 * IP / office-network configuration is ADMIN ONLY. No Agent, Closer or HR user
 * may view, add, edit, disable or remove an office IP/network rule — the
 * management surface is not exposed to them and the server rejects every call.
 * Server-side authorization is the boundary; hiding the UI is not sufficient.
 */
import { HttpError } from "../http-error";

export function canManageOfficeNetworks(role: string): boolean {
  return role === "admin";
}

export function assertCanManageOfficeNetworks(role: string): void {
  if (!canManageOfficeNetworks(role)) {
    throw new HttpError(403, "Only an Admin may manage office networks", "forbidden");
  }
}
