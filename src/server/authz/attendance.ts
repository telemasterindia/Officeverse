/**
 * Officeverse — attendance authorization (Phase 10 · privacy hardened Phase 23).
 * PURE. Role always comes from the authenticated session, never the client.
 *
 *   Admin / HR  → view ALL attendance + adjust/override classification.
 *   Closer      → view OWN attendance + login history; view AGENT attendance
 *                 ONLY within the Closer's OWN process/shift (US Closer → US
 *                 Agents; India Closer → India Agents; never cross-process).
 *   Agent       → NO attendance visibility at all — not own history, not any
 *                 counter, not the regularity threshold. Intentional design:
 *                 employees must not observe their accumulated threshold.
 *
 * Nobody sees payroll / salary through attendance. That is enforced by the
 * attendance DTOs never carrying compensation fields.
 */
import { HttpError } from "../http-error";

export type AttendanceRole = "admin" | "agent" | "closer" | "hr";

export function canViewAllAttendance(role: string): boolean {
  return role === "admin" || role === "hr";
}

export function canCorrectAttendance(role: string): boolean {
  return role === "admin" || role === "hr";
}

/** Agents get NOTHING; everyone else may see their own attendance. */
export function canViewOwnAttendance(role: string): boolean {
  return role !== "agent";
}

/** Closer / HR / Admin may open a manager view of other people's attendance. */
export function canViewManagedAttendance(role: string): boolean {
  return role === "admin" || role === "hr" || role === "closer";
}

/** A Closer may only see AGENT attendance inside their own process. */
export function closerCanViewAgent(
  actorRole: string,
  actorProcess: string,
  targetRole: string,
  targetProcess: string,
): boolean {
  if (actorRole === "admin" || actorRole === "hr") return true;
  if (actorRole !== "closer") return false;
  return targetRole === "agent" && targetProcess === actorProcess;
}

export function assertCanViewAllAttendance(role: string): void {
  if (!canViewAllAttendance(role)) {
    throw new HttpError(403, "Only Admin / HR may view all attendance", "forbidden");
  }
}

export function assertCanViewOwnAttendance(role: string): void {
  if (!canViewOwnAttendance(role)) {
    throw new HttpError(403, "Attendance history is not available for your role", "forbidden");
  }
}

export function assertCanViewManagedAttendance(role: string): void {
  if (!canViewManagedAttendance(role)) {
    throw new HttpError(403, "Not authorized to view team attendance", "forbidden");
  }
}

export function assertCanCorrectAttendance(role: string): void {
  if (!canCorrectAttendance(role)) {
    throw new HttpError(403, "Only Admin / HR may adjust attendance", "forbidden");
  }
}

/** New classification for an HR/Admin override. */
export const OVERRIDE_CLASSES = ["NORMAL", "SHORT_LATE", "LATE"] as const;
export type OverrideClass = (typeof OVERRIDE_CLASSES)[number];

export function assertValidOverride(role: string, newClass: string, reason: string): void {
  assertCanCorrectAttendance(role);
  if (!(OVERRIDE_CLASSES as readonly string[]).includes(newClass)) {
    throw new HttpError(400, "Invalid attendance classification", "bad_class");
  }
  if (reason.trim().length < 3) {
    throw new HttpError(
      400,
      "A reason is required for an attendance adjustment",
      "reason_required",
    );
  }
}
