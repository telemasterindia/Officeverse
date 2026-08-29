/**
 * Officeverse — Live Experience authorization (Phase 21). PURE.
 *
 *   Admin        → manage displays, broadcasts, assets, TV settings.
 *   Everyone     → the /office-tv surface itself is gated ONLY by a display
 *                  token (see tokens.ts), never by a user session.
 *
 * The TV client is read-only. It can never mutate the CRM, points, payroll or
 * HR. All recognition events are produced server-side from CONFIRMED business
 * events — the browser never asserts "this was a sale / acceptance".
 */
import { HttpError } from "../http-error";

export function canManageOfficeTv(role: string): boolean {
  return role === "admin";
}

export function assertCanManageOfficeTv(role: string): void {
  if (!canManageOfficeTv(role)) {
    throw new HttpError(403, "Only an Admin may manage the Office TV", "forbidden");
  }
}

/** Admin announcement priority the client may request. */
export const ANNOUNCEMENT_PRIORITIES = ["NORMAL", "IMPORTANT", "URGENT"] as const;
export const ANNOUNCEMENT_AUDIENCES = ["all", "agents", "closers"] as const;

export function assertValidAnnouncement(input: {
  title: string;
  message: string;
  durationMs: number;
  priority: string;
}): void {
  if (input.title.trim().length < 2) {
    throw new HttpError(400, "A title is required", "title_required");
  }
  if (input.message.trim().length < 2) {
    throw new HttpError(400, "A message is required", "message_required");
  }
  if (
    !Number.isInteger(input.durationMs) ||
    input.durationMs < 2000 ||
    input.durationMs > 120_000
  ) {
    throw new HttpError(400, "durationMs must be 2000..120000", "bad_duration");
  }
  if (!(ANNOUNCEMENT_PRIORITIES as readonly string[]).includes(input.priority)) {
    throw new HttpError(400, "Invalid priority", "bad_priority");
  }
}
