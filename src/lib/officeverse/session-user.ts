/**
 * Officeverse — map the server's sanitized `PublicUser` onto the client
 * `SessionUser` shape the UI already consumes (Phase 9). PURE.
 *
 * `PublicUser` never contains a password hash or any auth secret — this file
 * only reshapes safe fields. `process` may be overridden client-side purely for
 * display; the server always uses the DB user's process for shift maths.
 */
import { ROLE_LABEL } from "./data";
import type { ProcessCode, Role, SessionUser } from "./types";

export interface PublicUserLike {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  process: ProcessCode;
  status?: string;
  phone?: string | null;
  photoUrl?: string | null;
  /** current canonical business Employee ID (agents.agent_code /
   *  closers.closer_code); null/absent when the user has no staff record */
  employeeCode?: string | null;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function toSessionUser(
  pu: PublicUserLike,
  processOverride?: ProcessCode | null,
): SessionUser {
  return {
    id: String(pu.id),
    name: pu.fullName,
    role: pu.role,
    designation: ROLE_LABEL[pu.role] ?? pu.role,
    process: processOverride ?? pu.process,
    employeeId: pu.employeeCode ?? "",
    initials: initialsOf(pu.fullName),
    email: pu.email,
  };
}
