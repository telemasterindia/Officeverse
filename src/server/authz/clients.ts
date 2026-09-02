/**
 * Officeverse — client (customer organisation) directory authorization. PURE.
 *
 * A Client is the customer-facing organisation a debt-relief file belongs to —
 * a back-office record, NOT an Agent / Closer / employee. Creating, editing and
 * viewing the client directory is an Admin / HR operation. Agents and Closers
 * work leads and follow-ups; they never manage the client roster.
 *
 * Clients are not process-scoped in the schema (a client organisation is not a
 * US-vs-India entity), so there is no per-process filtering here — the whole
 * directory is Admin / HR only.
 */
import { HttpError } from "../http-error";

export function canManageClients(role: string): boolean {
  return role === "admin" || role === "hr";
}

export function assertCanManageClients(role: string): void {
  if (!canManageClients(role)) {
    throw new HttpError(403, "Only Admin / HR may manage the client directory", "forbidden");
  }
}
