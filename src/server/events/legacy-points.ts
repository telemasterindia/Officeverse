/**
 * Officeverse — LEGACY POINTS BRIDGE (Phase 5). Dispatcher-owned.
 *
 * The pre-engine gamification path awarded points for a business event via
 * `awardEvent()` (idempotent on `<event>:<referenceType>:<referenceId>`,
 * value from the admin-owned `gamification_point_rules` table).
 *
 * From Phase 5 the canonical `BusinessEvent` is the single point authority:
 *
 *   - the Scoring Engine takes ownership when it has an Admin rule for the
 *     event (`ingest()` → status "scored") — `awardScored()` writes the ledger;
 *   - when scoring does NOT take ownership (flag off / event not scoring-enabled
 *     / no open-ended rule), THIS bridge runs the exact same pre-engine
 *     `awardEvent()` so existing point behaviour is preserved byte-for-byte.
 *
 * The dispatcher gates this call on the ingest status, so the two award paths
 * are mutually exclusive per event — there is never a duplicate point.
 *
 * Recognition never calls this. Scoring never calls this. It lives in the
 * dispatcher lane only.
 */
import { awardEvent } from "../gamification/service";
import { isGamificationEvent } from "../gamification/points";
import type { BusinessEvent } from "./business-event";

/**
 * BusinessEvent.type → legacy GamificationEvent.
 *
 * Phase 5 migrated `LEAD_SUBMITTED`; Phase 7 migrates `LEAD_ACCEPTED`. Both now
 * flow BusinessEvent → dispatcher → { scoring , recognition }. The dispatcher
 * runs this fallback ONLY when the Scoring Engine did not take the points
 * (flag off / no open-ended rule), so a single accepted lead is never
 * double-awarded. `SALE` is NOT migrated (a later phase).
 */
const MIGRATED_TO_BUSINESS_EVENT: Readonly<Record<string, string>> = {
  LEAD_SUBMITTED: "LEAD_SUBMITTED",
  LEAD_ACCEPTED: "LEAD_ACCEPTED",
};

/** True when the dispatcher should NOT run the legacy fallback because the
 *  Scoring Engine already owns this event's points. */
export function scoringOwnsPoints(ingestStatus: string): boolean {
  return ingestStatus === "scored" || ingestStatus === "duplicate";
}

/**
 * Run the pre-engine `awardEvent()` for a migrated BusinessEvent. Best-effort,
 * idempotent, never throws. A no-op for any type not in the migration map.
 */
export async function runLegacyPointsFallback(event: BusinessEvent): Promise<void> {
  const legacy = MIGRATED_TO_BUSINESS_EVENT[event.type];
  if (!legacy || !isGamificationEvent(legacy)) return;

  await awardEvent({
    userId: event.subjectUserId,
    event: legacy,
    referenceType: event.source.type,
    referenceId: event.source.id,
    atMs: event.occurredAtMs,
  }).catch(() => undefined);
}
