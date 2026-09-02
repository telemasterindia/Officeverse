/**
 * Officeverse — staff (agent / closer) directory authorization. PURE.
 *
 * Creating, editing status, and viewing the full staff directory is an
 * Admin / HR operation. Agents and Closers never manage the roster.
 */
import { HttpError } from "../http-error";

export type StaffAdminRole = "admin" | "hr" | "agent" | "closer";

export function canManageStaff(role: string): boolean {
  return role === "admin" || role === "hr";
}

export function assertCanManageStaff(role: string): void {
  if (!canManageStaff(role)) {
    throw new HttpError(403, "Only Admin / HR may manage the staff directory", "forbidden");
  }
}

/**
 * Promoting an Agent to Closer is a role + permission change. Per the Admin
 * assignment-rule fix this is ADMIN ONLY — HR may edit staff status but may not
 * promote (no assignment/permission authority).
 */
export function canPromoteStaff(role: string): boolean {
  return role === "admin";
}

export function assertCanPromoteStaff(role: string): void {
  if (!canPromoteStaff(role)) {
    throw new HttpError(403, "Only an Admin may promote an Agent to Closer", "forbidden");
  }
}

/**
 * Removing an employee from the active workforce (deactivation / termination) is
 * an ADMIN-ONLY lifecycle action. HR may correct profile data and toggle a
 * status through `setStaffStatus`, but the deliberate "remove" action — which
 * also revokes every live session — is Admin only.
 */
export function canRemoveStaff(role: string): boolean {
  return role === "admin";
}

export function assertCanRemoveStaff(role: string): void {
  if (!canRemoveStaff(role)) {
    throw new HttpError(403, "Only an Admin may remove an employee", "forbidden");
  }
}
