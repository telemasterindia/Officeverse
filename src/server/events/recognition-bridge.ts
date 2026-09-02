/**
 * Officeverse — RECOGNITION BRIDGE (Phase 5).
 *
 * The ONE seam between the canonical event layer and the EXISTING recognition
 * system (`src/server/live/*`). It is registered as the dispatcher's
 * `RecognitionSink`, so:
 *
 *   BusinessEvent → dispatcher → recognitionBridge(event, scoringDecision, status)
 *                                     ↓
 *                        decideCelebration()  (semantic level + profile)
 *                                     ↓
 *                     recognizeFromBusinessEvent()  (existing office_tv_events +
 *                                                    recognition bus — NO points)
 *
 * RESPONSIBILITY BOUNDARIES (enforced):
 *   - never calls the scoring engine (no evaluateScoring / awardScored / ingest)
 *   - never awards points of any kind
 *   - consumes the scoring RESULT read-only, and works with `scoring = null`
 *   - reuses the existing recognition infra — no second bus / queue / ledger
 *
 * No new database schema. The celebration decision is transient metadata on the
 * in-memory recognition bus; the persisted `office_tv_events` row is unchanged.
 */
import { registerRecognitionSink, type RecognitionSink } from "./dispatcher";
import type { BusinessEvent } from "./business-event";
import type { ScoringDecision } from "../scoring/ingest";
import { getUserById } from "../db/repos/users";
import { decideCelebration } from "../live/celebration-level";
import { recognizeFromBusinessEvent } from "../live/recognition";
import type { RecognitionKind } from "../live/priority";
import { pickCelebrationProfileForTrigger } from "../live/celebration-profile-service";
import { buildCelebrationPayload } from "../live/celebration-profile";
import { evaluateMilestonesForEvent } from "../milestones/milestone-service";

/**
 * BusinessEvent.type → approved recognition KIND. Phase 5 mapped LEAD_SUBMITTED;
 * Phase 7 maps LEAD_ACCEPTED (a higher-value recognition → LEVEL_2). Any other
 * type is a no-op here (its existing recognition path, if any, is untouched).
 */
const KIND_FOR_EVENT: Readonly<Record<string, RecognitionKind>> = {
  LEAD_SUBMITTED: "LEAD_SUBMITTED",
  LEAD_ACCEPTED: "LEAD_ACCEPTED",
};

const HEADLINE_FOR_KIND: Readonly<Record<string, string>> = {
  LEAD_SUBMITTED: "LEAD SUBMITTED",
  LEAD_ACCEPTED: "LEAD ACCEPTED",
};

/**
 * celebration level → audio-cue PROFILE name (a pure token; the renderer's
 * `celebration-audio-profiles` registry owns the actual bell/chime/TTS spec).
 * Presentation only — carries no business meaning, no money.
 */
const AUDIO_PROFILE_FOR_LEVEL: Readonly<Record<string, string>> = {
  LEVEL_0: "silent",
  LEVEL_1: "chime",
  LEVEL_2: "level2-broadcast",
  LEVEL_3: "epic-broadcast",
  LEVEL_4: "hero-broadcast",
};

/** Read-only pull of the scoring result for the same event. Null-safe. */
function readScoring(scoring: ScoringDecision | null): {
  points: number | null;
  ruleName: string | null;
} {
  if (!scoring) return { points: null, ruleName: null };
  const ruleName = scoring.awards[0]?.ruleName ?? scoring.matched[0]?.ruleName ?? null;
  return { points: scoring.awardedPointsTotal, ruleName };
}

export const recognitionBridge: RecognitionSink = async (
  event: BusinessEvent,
  scoring: ScoringDecision | null,
  _ingestStatus: string,
): Promise<void> => {
  const kind = KIND_FOR_EVENT[event.type];
  if (!kind) return; // event type is not mapped to a recognition kind — nothing to celebrate

  const { points, ruleName } = readScoring(scoring);

  // Presentation-safe subject info from the EXISTING photo system — never bytes.
  const user = await getUserById(event.subjectUserId).catch(() => null);
  const employeeName = user?.fullName ?? null;
  const employeePhotoRef = user && user.photoAssetId != null ? String(event.subjectUserId) : null;

  // Phase 10 Stage 4 — after the base celebration is dispatched, let the
  // Milestone Engine evaluate this confirmed event against the Admin-configured
  // milestones. Best-effort + non-blocking: it awards NO points, never blocks
  // the base celebration, and a failure here is swallowed.
  const runMilestones = () =>
    evaluateMilestonesForEvent({
      eventType: event.type,
      subjectUserId: event.subjectUserId,
      subjectRole: (event.payload["role"] as string | null) ?? user?.role ?? null,
      process: (event.payload["process"] as string | null) ?? user?.process ?? "US",
      source: { type: event.source.type, id: event.source.id },
      operationalDate: event.operationalDate,
    }).catch(() => undefined);

  // Phase 10 — an Admin/Operations-authored Celebration Profile bound to this
  // trigger takes precedence over the frozen default map. When none is enabled
  // (or the DB is unavailable) this is null and the default path below runs
  // exactly as before — no behaviour change.
  const profile = await pickCelebrationProfileForTrigger(event.type).catch(() => null);
  if (profile) {
    const headline = HEADLINE_FOR_KIND[kind] ?? kind;
    const payload = buildCelebrationPayload({
      config: profile.config,
      level: profile.level,
      kind,
      employeeName,
      employeePhotoRef,
      headline,
      subheadline: ruleName,
      points, // authoritative scoring points — passed through, never computed
    });
    await recognizeFromBusinessEvent({
      eventType: event.type,
      kind,
      subjectUserId: event.subjectUserId,
      source: { type: event.source.type, id: event.source.id },
      headline: (payload["headline"] as string | null) ?? headline,
      subheadline: (payload["subheadline"] as string | null) ?? ruleName,
      points: (payload["points"] as number | null) ?? null,
      celebrationLevel: profile.level,
      celebrationProfile: payload,
      atMs: event.occurredAtMs,
    });
    await runMilestones();
    return;
  }

  const decision = decideCelebration({
    recognitionKind: kind,
    employeeName,
    employeePhotoRef,
    points, // null when scoring did not run — decideCelebration → 0
    scoredRuleName: ruleName,
    headline: HEADLINE_FOR_KIND[kind] ?? kind,
  });

  await recognizeFromBusinessEvent({
    eventType: event.type,
    kind,
    subjectUserId: event.subjectUserId,
    source: { type: event.source.type, id: event.source.id },
    headline: decision.headline,
    subheadline: decision.subheadline,
    points: decision.points,
    celebrationLevel: decision.level,
    celebrationProfile: {
      level: decision.level,
      profile: decision.profile,
      employeeName: decision.employeeName,
      employeePhotoRef: decision.employeePhotoRef,
      headline: decision.headline,
      subheadline: decision.subheadline,
      points: decision.points,
      soundProfile: decision.soundProfile,
      particleProfile: decision.particleProfile,
      durationMs: decision.durationMs,
      // Phase 7 — audio-cue profile token (bell → TTS → chime); presentation only
      audioProfile: AUDIO_PROFILE_FOR_LEVEL[decision.level] ?? "silent",
    },
    atMs: event.occurredAtMs,
  });
  await runMilestones();
};

// Self-register on load. The dispatcher lazy-imports this file the first time it
// dispatches an event, unless a test has already registered a mock sink.
registerRecognitionSink(recognitionBridge);
