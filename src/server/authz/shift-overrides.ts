/**
 * Officeverse — shift-override authorization (Admin UAT Batch-2 follow-up §1).
 * PURE. Role always comes from the authenticated session, never the client.
 *
 *   Admin        → create / edit / delete a per-date shift override and trigger
 *                  a re-derivation of that date's attendance.
 *   HR           → NO. Shift POLICY is an Admin control (attendance CORRECTIONS
 *                  remain HR/Admin — that is unchanged).
 *   Agent/Closer → NO. An employee can never change their own shift or its
 *                  timing.
 */
import { HttpError } from "../http-error";

export function canManageShiftOverrides(role: string): boolean {
  return role === "admin";
}

export function assertCanManageShiftOverrides(role: string): void {
  if (!canManageShiftOverrides(role)) {
    throw new HttpError(403, "Only an Admin may configure shift timing", "forbidden");
  }
}
