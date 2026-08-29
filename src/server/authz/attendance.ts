/**
 * Officeverse — attendance authorization (Phase 10). PURE.
 *
 *   Admin, HR   → view ALL attendance + correct rows.
 *   Agent, Closer → view ONLY their own attendance (self-scoped server-side),
 *                   never another employee's, never edit.
 *
 * The role always comes from the authenticated session (context.requireUser),
 * never from the client.
 */
import { HttpError } from "../http-error";

export type AttendanceRole = "admin" | "agent" | "closer" | "hr";

export function canViewAllAttendance(role: AttendanceRole): boolean {
  return role === "admin" || role === "hr";
}

export function canCorrectAttendance(role: AttendanceRole): boolean {
  return role === "admin" || role === "hr";
}

/** Everyone authenticated may see their OWN attendance. */
export function canViewOwnAttendance(): boolean {
  return true;
}

export function assertCanViewAllAttendance(role: AttendanceRole): void {
  if (!canViewAllAttendance(role)) {
    throw new HttpError(403, "Only Admin / HR may view all attendance", "forbidden");
  }
}

export function assertCanCorrectAttendance(role: AttendanceRole): void {
  if (!canCorrectAttendance(role)) {
    throw new HttpError(403, "Only Admin / HR may correct attendance", "forbidden");
  }
}
