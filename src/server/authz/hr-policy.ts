/**
 * Officeverse — HR Policy authorization. PURE.
 *
 *   manage  (create / edit / publish / unpublish)  → HR + Admin
 *   view published                                 → every authenticated user
 *
 * Agents and Closers can READ published policies and nothing else.
 */
import { HttpError } from "../http-error";

export type PolicyRole = "admin" | "hr" | "agent" | "closer";

/** Author, edit and publish company HR policies. */
export function canManageHrPolicy(role: string): boolean {
  return role === "admin" || role === "hr";
}

export function assertCanManageHrPolicy(role: string): void {
  if (!canManageHrPolicy(role)) {
    throw new HttpError(403, "Only HR or Admin may manage HR policies", "forbidden");
  }
}

/** See the full policy list incl. drafts — HR + Admin only. */
export const canViewAllHrPolicies = canManageHrPolicy;

export function assertCanViewAllHrPolicies(role: string): void {
  if (!canViewAllHrPolicies(role)) {
    throw new HttpError(403, "Only HR or Admin may view policy drafts", "forbidden");
  }
}
