/**
 * Officeverse — Live Experience: business-event → recognition wiring (Phase 21).
 *
 * These functions are called from the CRM AFTER the server has CONFIRMED the
 * underlying business event (a lead row was inserted; a status transition was
 * validated and persisted). The browser never asserts "this was a sale". They
 * are BEST-EFFORT: every entry point is wrapped so a recognition failure can
 * never break or slow the lead/follow-up workflow.
 *
 * Pipeline per event:
 *   confirmed business event
 *     → gamification awardEvent() (idempotent; abstract points, never money)
 *     → celebration orchestrator (tier / effect / asset / duration)
 *     → office_tv_events row (idempotent on dedupe_key)
 *     → recognition bus (the /office-tv poll picks it up — no manual refresh)
 *     → [LEAD_ACCEPTED only] a real-time notification to the agent
 *
 * FOLLOW-UP NEVER CALLS ANY OF THIS. Opening / viewing / editing a follow-up
 * produces no points, no notification and no celebration.
 *
 * ZERO payroll coupling — this module imports nothing from ../hr/* / payroll /
 * salary-slip / regularity / incentive / commission.
 */
import { isDbConfigured } from "@/lib/db";
import { currentShiftDate, nowIST } from "../time";
import { getUserById } from "../db/repos/users";
import { createNotification } from "../notifications/service";
import { awardEvent } from "../gamification/service";
import * as repo from "../db/repos/office-tv";
import { recognitionBus } from "./bus";
import { buildCelebration, type RecognitionEvent } from "./orchestrator";
import { DEFAULT_ORCHESTRATOR_CONFIG } from "./orchestrator";
import { resolveTvConfig } from "./config";
import type { RecognitionKind } from "./priority";

const ACCEPT_KINDS = ["LEAD_ACCEPTED", "THIRD_ACCEPTED_LEAD"];

async function loadOrchestratorConfig() {
  try {
    const row = await repo.getTvSettings();
    const cfg = resolveTvConfig(row as Record<string, unknown> | undefined);
    return {
      orch: {
        celebrationsEnabled: true,
        intensity: cfg.celebrationIntensity,
        maxDurationMs: Math.max(4000, cfg.rotationSec * 1000),
      },
      cfg,
    };
  } catch {
    return { orch: DEFAULT_ORCHESTRATOR_CONFIG, cfg: resolveTvConfig(null) };
  }
}

interface EmitInput {
  kind: RecognitionKind;
  eventId: number;
  subjectUserId: number | null;
  subjectName: string | null;
  subjectRole: string | null;
  subjectPhotoAvailable: boolean;
  headline: string | null;
  referenceType: string | null;
  referenceId: string | null;
  dedupeKey: string;
  operationalDate: string;
  /** Phase 5 — the Recognition celebration DECISION (semantic level + profile),
   *  and the abstract points the Scoring Engine awarded for this event. Passed
   *  straight through to the in-memory bus so the future Office TV renderer can
   *  read them. Optional — Recognition still functions without a scoring result. */
  celebrationLevel?: string | null;
  celebrationProfile?: Record<string, unknown> | null;
  points?: number | null;
  subheadline?: string | null;
}

/** Persist + broadcast one recognition moment (idempotent on dedupeKey). */
async function emit(input: EmitInput): Promise<void> {
  const { orch } = await loadOrchestratorConfig();
  const assets = await repo.listEnabledAssets().catch(() => []);
  const evt: RecognitionEvent = {
    kind: input.kind,
    eventId: input.eventId,
    subject: input.subjectUserId
      ? {
          userId: input.subjectUserId,
          name: input.subjectName ?? "",
          role: input.subjectRole ?? "",
          photoAvailable: input.subjectPhotoAvailable,
        }
      : null,
    headline: input.headline,
  };
  const celebration = buildCelebration(
    evt,
    assets.map((a) => ({
      id: a.id,
      category: a.category,
      kind: a.kind as "video" | "effect",
      enabled: a.enabled,
      storageKey: a.storageKey,
      effect: a.effect,
    })),
    orch,
  );
  if (!celebration) return;

  const { created } = await repo.insertTvEvent({
    kind: input.kind,
    subjectUserId: input.subjectUserId,
    tier: celebration.tier,
    effect: celebration.effect,
    assetCategory: celebration.assetCategory,
    message: input.headline?.slice(0, 200) ?? null,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    dedupeKey: input.dedupeKey,
    operationalDate: input.operationalDate,
    createdAt: nowIST(),
  });
  if (!created) return; // duplicate confirmed event → no second celebration

  recognitionBus.publish("celebration", {
    kind: input.kind,
    tier: celebration.tier,
    effect: celebration.effect,
    assetCategory: celebration.assetCategory,
    assetId: celebration.assetId,
    hasVideo: !!celebration.videoKey,
    durationMs: celebration.durationMs,
    headline: input.headline,
    subheadline: input.subheadline ?? null,
    // Phase 5 — celebration decision + abstract points for the future renderer
    celebrationLevel: input.celebrationLevel ?? null,
    celebrationProfile: input.celebrationProfile ?? null,
    points: typeof input.points === "number" ? Math.trunc(input.points) : null,
    subject: input.subjectUserId
      ? {
          userId: input.subjectUserId,
          name: input.subjectName,
          role: input.subjectRole,
          photoAvailable: input.subjectPhotoAvailable,
        }
      : null,
  });
}

/* --------------------------- entry points -------------------------- */

export interface LeadRecoInput {
  agentUserId: number;
  leadCode: string;
  atMs?: number;
}

/**
 * Phase 5 — the canonical recognition entry. The dispatcher's recognition
 * bridge calls this for a confirmed `BusinessEvent` (+ the Scoring Engine's
 * result, where available). It drives the RECOGNITION MOMENT ONLY — it never
 * awards points (that is the Scoring Engine's job, or the dispatcher's
 * legacy-points bridge when no rule exists).
 *
 * Idempotent on `<eventType>:<source.type>:<source.id>` via `office_tv_events`,
 * so an event retry / re-dispatch / server restart produces no second
 * celebration.
 */
export interface BusinessRecognitionInput {
  /** BusinessEvent.type, e.g. "LEAD_SUBMITTED" */
  eventType: string;
  /** the approved recognition KIND to celebrate as */
  kind: RecognitionKind;
  /** the employee being recognised */
  subjectUserId: number;
  source: { type: string; id: string };
  headline: string | null;
  subheadline: string | null;
  /** abstract points the Scoring Engine awarded for this event (null = none) */
  points: number | null;
  /** the celebration DECISION metadata (semantic level + profile) */
  celebrationLevel: string | null;
  celebrationProfile: Record<string, unknown> | null;
  atMs?: number;
}

export async function recognizeFromBusinessEvent(input: BusinessRecognitionInput): Promise<void> {
  if (!isDbConfigured()) return;
  const user = await getUserById(input.subjectUserId);
  if (!user || (user.role !== "agent" && user.role !== "closer")) return;

  await emit({
    kind: input.kind,
    eventId: hash(input.source.id),
    subjectUserId: user.id,
    subjectName: user.fullName,
    subjectRole: user.role,
    subjectPhotoAvailable: user.photoAssetId != null,
    headline: input.headline,
    subheadline: input.subheadline,
    referenceType: input.source.type,
    referenceId: input.source.id,
    dedupeKey: `${input.eventType}:${input.source.type}:${input.source.id}`,
    operationalDate: currentShiftDate(user.process, input.atMs),
    celebrationLevel: input.celebrationLevel,
    celebrationProfile: input.celebrationProfile,
    points: input.points,
  });
}

/**
 * Retained for compatibility. Phase 5 moved LEAD_SUBMITTED onto the canonical
 * BusinessEvent path, so points now come from the Scoring Engine / the
 * dispatcher legacy-points bridge — NOT from here. This helper now drives the
 * recognition moment only.
 */
export async function onLeadSubmitted(input: LeadRecoInput): Promise<void> {
  await recognizeFromBusinessEvent({
    eventType: "LEAD_SUBMITTED",
    kind: "LEAD_SUBMITTED",
    subjectUserId: input.agentUserId,
    source: { type: "lead", id: input.leadCode },
    headline: "LEAD SUBMITTED",
    subheadline: null,
    points: null,
    celebrationLevel: null,
    celebrationProfile: null,
    ...(input.atMs != null ? { atMs: input.atMs } : {}),
  });
}

export async function onLeadAccepted(input: LeadRecoInput): Promise<void> {
  if (!isDbConfigured()) return;
  const user = await getUserById(input.agentUserId);
  if (!user || (user.role !== "agent" && user.role !== "closer")) return;
  const operationalDate = currentShiftDate(user.process, input.atMs);

  // Phase 7 — the BASE `LEAD_ACCEPTED` celebration AND its points now flow
  // through the canonical BusinessEvent path
  // (`emitBusinessEvent(buildLeadAcceptedEvent(...))` in `leads/service.ts` →
  // dispatcher → { Scoring Engine | gated legacy-points fallback } →
  // recognition bridge → LEVEL_2 celebration). This helper therefore no longer
  // awards points or emits the base celebration — it keeps ONLY the side
  // effects the BusinessEvent path does not cover: the agent notification, the
  // THIRD_ACCEPTED_LEAD escalation and the TEAM_MILESTONE.

  // A real-time notification to the agent — never blocks their workflow.
  await createNotification({
    recipientUserId: user.id,
    type: "lead.accepted",
    title: "Lead accepted",
    message: `Your lead ${input.leadCode} was accepted by a closer.`,
    relatedEntityType: "lead",
    relatedEntityCode: input.leadCode,
    dedupeKey: `lead.accepted:${input.leadCode}`,
  }).catch(() => undefined);

  // Escalate the Nth acceptance of the operational day to a heavy celebration,
  // where N is the CONFIGURED threshold (default 3) — a CELEBRATION threshold
  // only, never a salary / incentive rule. LEVEL_3 is out of Phase-7 scope, so
  // this stays on the direct recognition path (not the BusinessEvent layer).
  const { cfg } = await loadOrchestratorConfig();
  const acceptedToday =
    (await repo.countSubjectEventsForDate(user.id, ACCEPT_KINDS, operationalDate).catch(() => 0)) +
    1;
  const isThird = cfg.thirdAcceptedThreshold > 0 && acceptedToday === cfg.thirdAcceptedThreshold;
  if (isThird) {
    await emit({
      kind: "THIRD_ACCEPTED_LEAD",
      eventId: hash(input.leadCode + ":acc3"),
      subjectUserId: user.id,
      subjectName: user.fullName,
      subjectRole: user.role,
      subjectPhotoAvailable: user.photoAssetId != null,
      headline: `${cfg.thirdAcceptedThreshold} ACCEPTED LEADS`,
      referenceType: "lead",
      referenceId: input.leadCode,
      dedupeKey: `THIRD_ACCEPTED_LEAD:lead:${input.leadCode}`,
      operationalDate,
    });
  }

  // Team milestone (data-driven; 0 = disabled).
  if (cfg.teamMilestoneEvery > 0) {
    const teamAccepted = await repo
      .countEventsForDate(ACCEPT_KINDS, operationalDate)
      .catch(() => 0);
    if (teamAccepted > 0 && teamAccepted % cfg.teamMilestoneEvery === 0) {
      await emit({
        kind: "TEAM_MILESTONE",
        eventId: hash(`team:${operationalDate}:${teamAccepted}`),
        subjectUserId: null,
        subjectName: null,
        subjectRole: null,
        subjectPhotoAvailable: false,
        headline: `TEAM HIT ${teamAccepted} ACCEPTED LEADS!`,
        referenceType: "team_milestone",
        referenceId: `${operationalDate}:${teamAccepted}`,
        dedupeKey: `TEAM_MILESTONE:${operationalDate}:${teamAccepted}`,
        operationalDate,
      });
    }
  }
}

export interface SaleRecoInput {
  userId: number;
  leadCode: string;
  atMs?: number;
}

export async function onSale(input: SaleRecoInput): Promise<void> {
  if (!isDbConfigured()) return;
  const user = await getUserById(input.userId);
  if (!user || (user.role !== "agent" && user.role !== "closer")) return;

  await awardEvent({
    userId: user.id,
    event: "SALE",
    referenceType: "lead",
    referenceId: input.leadCode,
    ...(input.atMs != null ? { atMs: input.atMs } : {}),
  }).catch(() => undefined);

  const operationalDate = currentShiftDate(user.process, input.atMs);
  await emit({
    kind: "SALE",
    eventId: hash(input.leadCode + ":sale"),
    subjectUserId: user.id,
    subjectName: user.fullName,
    subjectRole: user.role,
    subjectPhotoAvailable: user.photoAssetId != null,
    headline: "SALE!",
    referenceType: "lead",
    referenceId: input.leadCode,
    dedupeKey: `SALE:lead:${input.leadCode}`,
    operationalDate,
  });

  // Phase 10 Stage 4 — let the Milestone Engine react to this confirmed SALE
  // ("First Sale", "10 Sales", team sale targets …). Dynamic import keeps this
  // module free of a static milestone dependency; best-effort, never blocks.
  void import("../milestones/milestone-service")
    .then((m) =>
      m.evaluateMilestonesForEvent({
        eventType: "SALE",
        subjectUserId: user.id,
        subjectRole: user.role,
        process: user.process,
        source: { type: "lead", id: input.leadCode },
        operationalDate,
      }),
    )
    .catch(() => undefined);
}

/* --------------------------- milestones -------------------------- */

export interface MilestoneRecoInput {
  /** approved recognition kind — TEAM_MILESTONE (team) or ACHIEVEMENT_UNLOCKED (individual) */
  kind: RecognitionKind;
  /** null for a TEAM milestone — a person is NEVER fabricated */
  subjectUserId: number | null;
  subjectName: string | null;
  subjectRole: string | null;
  subjectPhotoAvailable: boolean;
  headline: string | null;
  subheadline: string | null;
  /** authoritative points ONLY when the milestone measures points; else null */
  points: number | null;
  /** semantic level ("LEVEL_2" …) + the Stage-1 celebration profile payload */
  celebrationLevel: string | null;
  celebrationProfile: Record<string, unknown> | null;
  /** deterministic idempotency key from the Milestone Engine */
  dedupeKey: string;
  operationalDate: string;
  sourceType: string | null;
  sourceId: string | null;
}

/**
 * Phase 10 Stage 4 — publish ONE milestone recognition moment through the
 * EXISTING recognition path (`emit` → idempotent `office_tv_events` → the
 * recognition bus → Office TV interrupt). It awards NO points and runs NO
 * scoring; the caller (Milestone Engine) has already checked the authoritative
 * threshold. Returns the published bus seq, or null when nothing was emitted
 * (duplicate dedupe key / celebration suppressed).
 */
export async function recognizeMilestone(input: MilestoneRecoInput): Promise<number | null> {
  if (!isDbConfigured()) return null;
  const before = recognitionBus.latestSeq();
  await emit({
    kind: input.kind,
    eventId: hash(input.dedupeKey),
    subjectUserId: input.subjectUserId,
    subjectName: input.subjectName,
    subjectRole: input.subjectRole,
    subjectPhotoAvailable: input.subjectPhotoAvailable,
    headline: input.headline,
    subheadline: input.subheadline,
    referenceType: input.sourceType,
    referenceId: input.sourceId,
    dedupeKey: input.dedupeKey,
    operationalDate: input.operationalDate,
    celebrationLevel: input.celebrationLevel,
    celebrationProfile: input.celebrationProfile,
    points: input.points,
  });
  const after = recognitionBus.latestSeq();
  return after > before ? after : null;
}

/* ----------------------------- helpers ---------------------------- */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Fire-and-forget wrapper: never throws, never rejects into the caller. */
export function recognizeSafe(p: Promise<unknown>): void {
  void Promise.resolve(p).catch((err) => {
    console.error("[recognition] non-fatal:", err instanceof Error ? err.message : err);
  });
}
