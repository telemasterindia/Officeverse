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

export async function onLeadSubmitted(input: LeadRecoInput): Promise<void> {
  if (!isDbConfigured()) return;
  const user = await getUserById(input.agentUserId);
  if (!user || (user.role !== "agent" && user.role !== "closer")) return;

  await awardEvent({
    userId: user.id,
    event: "LEAD_SUBMITTED",
    referenceType: "lead",
    referenceId: input.leadCode,
    ...(input.atMs != null ? { atMs: input.atMs } : {}),
  }).catch(() => undefined);

  await emit({
    kind: "LEAD_SUBMITTED",
    eventId: hash(input.leadCode),
    subjectUserId: user.id,
    subjectName: user.fullName,
    subjectRole: user.role,
    subjectPhotoAvailable: user.photoAssetId != null,
    headline: "LEAD SUBMITTED",
    referenceType: "lead",
    referenceId: input.leadCode,
    dedupeKey: `LEAD_SUBMITTED:lead:${input.leadCode}`,
    operationalDate: currentShiftDate(user.process, input.atMs),
  });
}

export async function onLeadAccepted(input: LeadRecoInput): Promise<void> {
  if (!isDbConfigured()) return;
  const user = await getUserById(input.agentUserId);
  if (!user || (user.role !== "agent" && user.role !== "closer")) return;
  const operationalDate = currentShiftDate(user.process, input.atMs);

  const award = await awardEvent({
    userId: user.id,
    event: "LEAD_ACCEPTED",
    referenceType: "lead",
    referenceId: input.leadCode,
    ...(input.atMs != null ? { atMs: input.atMs } : {}),
  }).catch(() => null);

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
  // only, never a salary / incentive rule.
  const { cfg } = await loadOrchestratorConfig();
  const acceptedToday =
    (await repo.countSubjectEventsForDate(user.id, ACCEPT_KINDS, operationalDate).catch(() => 0)) +
    1;
  const isThird = cfg.thirdAcceptedThreshold > 0 && acceptedToday === cfg.thirdAcceptedThreshold;
  const kind: RecognitionKind = isThird ? "THIRD_ACCEPTED_LEAD" : "LEAD_ACCEPTED";

  await emit({
    kind,
    eventId: hash(input.leadCode + ":acc"),
    subjectUserId: user.id,
    subjectName: user.fullName,
    subjectRole: user.role,
    subjectPhotoAvailable: user.photoAssetId != null,
    headline: isThird ? `${cfg.thirdAcceptedThreshold} ACCEPTED LEADS` : "LEAD ACCEPTED!",
    referenceType: "lead",
    referenceId: input.leadCode,
    dedupeKey: `${isThird ? "THIRD_ACCEPTED_LEAD" : "LEAD_ACCEPTED"}:lead:${input.leadCode}`,
    operationalDate,
  });

  // Achievement recognition (Phase-20 awarded them; surface any new ones).
  if (award?.newAchievements?.length) {
    for (const code of award.newAchievements) {
      await emit({
        kind: "ACHIEVEMENT_UNLOCKED",
        eventId: hash(`${input.leadCode}:${code}`),
        subjectUserId: user.id,
        subjectName: user.fullName,
        subjectRole: user.role,
        subjectPhotoAvailable: user.photoAssetId != null,
        headline: `ACHIEVEMENT: ${code.replace(/_/g, " ")}`,
        referenceType: "achievement",
        referenceId: code,
        dedupeKey: `ACHIEVEMENT_UNLOCKED:${user.id}:${code}`,
        operationalDate,
      });
    }
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
    operationalDate: currentShiftDate(user.process, input.atMs),
  });
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
