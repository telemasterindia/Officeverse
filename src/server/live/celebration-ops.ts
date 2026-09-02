/**
 * Officeverse — CELEBRATION ENGINE · Operations control (Phase 6.5).
 *
 * An operations-facing READ + TEST surface over the EXISTING recognition
 * infrastructure. It:
 *   - reports the active celebration configuration (read-only)
 *   - previews the supported celebration levels / profiles (from the frozen
 *     Phase-5 `decideCelebration` contract — never re-derived here)
 *   - lists recent recognition events (employee / kind / points supplied by
 *     scoring / level / timestamp / source)
 *   - triggers ONE controlled TEST celebration onto the EXISTING in-memory
 *     `recognitionBus` — no business event, no scoring, no CRM mutation, no
 *     `office_tv_events` row, no points ledger row.
 *
 * It never calculates a score or an incentive. `points` is whatever the
 * recognition record already carries.
 */
import type { User } from "@/lib/db/schema";
import { isDbConfigured } from "@/lib/db";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { currentShiftDate } from "../time";
import { assertCanRunOperations } from "../authz/operations";
import * as repo from "../db/repos/office-tv";
import { recognitionBus } from "./bus";
import { resolveTvConfig } from "./config";
import {
  CELEBRATION_LEVELS,
  decideCelebration,
  isCelebrationLevel,
  type CelebrationLevel,
} from "./celebration-level";
import {
  ANNOUNCEMENT_TEMPLATES,
  AUDIO_PROFILES,
} from "@/components/celebration/celebration-audio-profiles";

type Meta = { ip?: string | null; userAgent?: string | null };

export interface CelebrationLevelPreview {
  level: CelebrationLevel;
  profile: string;
  soundProfile: string;
  particleProfile: string;
  durationMs: number;
  /** LEVEL_0 shows a subtle recognition state only */
  cinematic: boolean;
}

export interface RecentRecognitionRow {
  id: number;
  kind: string;
  subjectUserId: number | null;
  message: string | null;
  tier: number;
  /** points supplied by the scoring engine for this event (may be absent) */
  points: number | null;
  celebrationLevel: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

export interface CelebrationOverview {
  dbUnavailable?: boolean;
  config: {
    displayName: string;
    celebrationIntensity: string;
    soundEnabled: boolean;
    rotationSec: number;
  };
  levels: CelebrationLevelPreview[];
  /** Phase 7 — the code-owned audio-cue profile registry (read-only preview) */
  audioProfiles: {
    id: string;
    label: string;
    preSound: string;
    postSound: string;
    ttsEnabled: boolean;
    ttsTemplate: string;
  }[];
  announcementTemplates: string[];
  recent: RecentRecognitionRow[];
}

/** All five level previews — derived from the frozen Phase-5 contract. */
export function celebrationLevelPreviews(): CelebrationLevelPreview[] {
  return CELEBRATION_LEVELS.map((level) => {
    const p = decideCelebration({
      recognitionKind: "OPERATIONS_PREVIEW",
      levelOverride: level,
      employeeName: "Preview",
      headline: "PREVIEW",
      points: 0,
    });
    return {
      level,
      profile: p.profile,
      soundProfile: p.soundProfile,
      particleProfile: p.particleProfile,
      durationMs: p.durationMs,
      cinematic: level !== "LEVEL_0",
    };
  });
}

const AUDIO_PROFILE_VIEW = AUDIO_PROFILES.map((p) => ({
  id: p.id,
  label: p.label,
  preSound: p.preSound,
  postSound: p.postSound,
  ttsEnabled: p.tts.enabled,
  ttsTemplate: p.tts.template,
}));

export async function celebrationOverview(actor: Pick<User, "role">): Promise<CelebrationOverview> {
  assertCanRunOperations(actor.role);
  const levels = celebrationLevelPreviews();
  const audioProfiles = AUDIO_PROFILE_VIEW;
  const announcementTemplates = [...ANNOUNCEMENT_TEMPLATES];
  if (!isDbConfigured()) {
    return {
      dbUnavailable: true,
      config: {
        displayName: "Officeverse Live",
        celebrationIntensity: "normal",
        soundEnabled: false,
        rotationSec: 12,
      },
      levels,
      audioProfiles,
      announcementTemplates,
      recent: [],
    };
  }
  const settingsRow = await repo.getTvSettings().catch(() => undefined);
  const cfg = resolveTvConfig(settingsRow as Record<string, unknown> | undefined);
  const today = currentShiftDate("US");
  const rows = await repo.listEventsForDate(today, 40).catch(() => []);
  const recent: RecentRecognitionRow[] = rows.map((e) => ({
    id: e.id,
    kind: e.kind,
    subjectUserId: e.subjectUserId ?? null,
    message: e.message ?? null,
    tier: e.tier,
    // office_tv_events does not persist the scoring points; the live payload
    // carries them. The ops table shows what the recognition record holds.
    points: null,
    celebrationLevel: null,
    referenceType: e.referenceType ?? null,
    referenceId: e.referenceId ?? null,
    createdAt: e.createdAt,
  }));
  return {
    config: {
      displayName: cfg.displayName,
      celebrationIntensity: cfg.celebrationIntensity,
      soundEnabled: cfg.soundEnabled,
      rotationSec: cfg.rotationSec,
    },
    levels,
    audioProfiles,
    announcementTemplates,
    recent,
  };
}

export interface TestCelebrationInput {
  level: string;
  headline?: string | null;
  /** Phase 7 — also exercise the audio-cue sequence (bell → TTS → chime) */
  withAudio?: boolean;
  /** override the audio-cue profile token for the test (defaults per level) */
  audioProfile?: string | null;
}

const AUDIO_PROFILE_FOR_LEVEL: Readonly<Record<string, string>> = {
  LEVEL_0: "silent",
  LEVEL_1: "chime",
  LEVEL_2: "level2-broadcast",
  LEVEL_3: "epic-broadcast",
  LEVEL_4: "hero-broadcast",
};

/**
 * Publish ONE synthetic celebration to the existing `recognitionBus` so the
 * Office TV plays it on its next poll. This is a PRESENTATION test only:
 *   - no BusinessEvent, no dispatcher, no scoring, no `awardScored`
 *   - no `office_tv_events` row, no points ledger row
 *   - `points` is always 0 (a test never carries a score)
 */
export async function triggerTestCelebration(
  actor: Pick<User, "id" | "role" | "fullName">,
  input: TestCelebrationInput,
  meta: Meta = {},
): Promise<{ ok: true; seq: number; level: CelebrationLevel }> {
  assertCanRunOperations(actor.role);
  if (!isCelebrationLevel(input.level)) {
    throw new HttpError(400, "Unknown celebration level", "bad_level");
  }
  const level = input.level;
  const headline = (input.headline ?? "OPERATIONS TEST").toString().trim().slice(0, 60) || "TEST";

  const profile = decideCelebration({
    recognitionKind: "CELEBRATION_TEST",
    levelOverride: level,
    employeeName: actor.fullName,
    headline,
    points: 0,
  });
  const audioProfile = input.withAudio
    ? input.audioProfile?.trim() || AUDIO_PROFILE_FOR_LEVEL[level] || "silent"
    : "silent";

  const published = recognitionBus.publish("celebration", {
    kind: "CELEBRATION_TEST",
    tier: 1,
    effect: "ENERGY",
    assetCategory: "none",
    assetId: null,
    hasVideo: false,
    durationMs: profile.durationMs,
    headline,
    subheadline: "Operations test — not a real recognition",
    celebrationLevel: level,
    celebrationProfile: { ...profile, audioProfile },
    points: 0,
    subject: {
      userId: actor.id,
      name: actor.fullName,
      role: actor.role,
      photoAvailable: false,
    },
  });

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: input.withAudio ? "CELEBRATION_AUDIO_TEST_TRIGGERED" : "CELEBRATION_TEST_TRIGGERED",
    entityType: "celebration_test",
    entityId: published.seq,
    metadata: { level, headline, audioProfile, seq: published.seq, success: true },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { ok: true, seq: published.seq, level };
}
