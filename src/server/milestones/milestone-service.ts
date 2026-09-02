/**
 * Officeverse — MILESTONE ENGINE service (Phase 10 Stage 4). Server-side only.
 *
 *   BUSINESS EVENT → SCORING ENGINE → POINT LEDGER
 *       → [ MILESTONE ENGINE (this) ] → RECOGNITION
 *       → CELEBRATION / ANNOUNCEMENT → OFFICE TV
 *
 * It CONSUMES authoritative ledger values (SUM / COUNT over ACTIVE
 * `gamification_point_transactions`, the same table Phase-8 aggregates) and,
 * when a configured threshold is reached under the configured trigger policy,
 * fires exactly ONE recognition moment through the EXISTING recognition path.
 *
 * It NEVER: scores, awards points, re-ranks, writes payroll / salary / incentive,
 * or fabricates a person for a team milestone.
 *
 * Definition CRUD = Admin governance. List + simulate = Admin + Closer.
 * Automatic triggers run with actor "system" and record the source event.
 */
import type { User } from "@/lib/db/schema";
import { getDb, isDbConfigured } from "@/lib/db";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { nowIST } from "../time";
import { assertCanManageMilestones, assertCanRunOperations } from "../authz/operations";
import * as repo from "../db/repos/milestones";
import { recognizeMilestone } from "../live/recognition";
import { fireMilestoneAnnouncement } from "../live/announcement-ops";
import { celebrationPayloadForProfileId } from "../live/celebration-profile-service";
import {
  isEvaluableType,
  isPointsType,
  isTeamType,
  normalizeMilestoneDraft,
  validateMilestoneDraft,
  type MilestoneDraft,
  type MilestonePeriod,
  type MilestoneTriggerPolicy,
  type NormalizedMilestone,
} from "./milestone-model";
import {
  buildMilestoneRecognition,
  crossed,
  dedupeKeyFor,
  periodKeyFor,
  windowFor,
} from "./milestone-eval";

type Meta = { ip?: string | null; userAgent?: string | null };

export type { MilestoneDraft } from "./milestone-model";

/* ------------------------------- CRUD --------------------------------- */

export interface MilestoneDTO extends NormalizedMilestone {
  id: number;
  enabled: boolean;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneTriggerDTO {
  id: number;
  milestoneId: number;
  userId: number | null;
  periodKey: string;
  thresholdValue: number;
  actualValue: number;
  sourceType: string | null;
  sourceId: string | null;
  triggeredAt: string;
}

function toDTO(m: NonNullable<Awaited<ReturnType<typeof repo.getMilestone>>>): MilestoneDTO {
  const scopeProcesses =
    m.scope &&
    typeof m.scope === "object" &&
    Array.isArray((m.scope as { processes?: unknown }).processes)
      ? ((m.scope as { processes: unknown[] }).processes.filter(
          (p) => typeof p === "string",
        ) as string[])
      : null;
  return {
    id: m.id,
    name: m.name,
    description: m.description ?? null,
    enabled: m.enabled,
    type: m.type,
    metric: m.metric ?? null,
    threshold: m.threshold,
    period: m.period as MilestonePeriod,
    triggerPolicy: m.triggerPolicy as MilestoneTriggerPolicy,
    scope: scopeProcesses && scopeProcesses.length ? { processes: scopeProcesses } : null,
    priority: m.priority,
    recognitionLevel: m.recognitionLevel,
    celebrationProfileId: m.celebrationProfileId ?? null,
    announcementId: m.announcementId ?? null,
    effectiveFrom: m.effectiveFrom,
    effectiveUntil: m.effectiveUntil ?? null,
    createdByUserId: m.createdByUserId ?? null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

export async function listMilestones(actor: Pick<User, "role">): Promise<{
  dbUnavailable?: boolean;
  milestones: MilestoneDTO[];
  triggers: MilestoneTriggerDTO[];
}> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, milestones: [], triggers: [] };
  const [defs, trig] = await Promise.all([repo.listMilestones(), repo.listTriggers({}, 60)]);
  return {
    milestones: defs.map((d) => toDTO(d)),
    triggers: trig.map((t): MilestoneTriggerDTO => ({
      id: t.id,
      milestoneId: t.milestoneId,
      userId: t.userId ?? null,
      periodKey: t.periodKey,
      thresholdValue: t.thresholdValue,
      actualValue: t.actualValue,
      sourceType: t.sourceType ?? null,
      sourceId: t.sourceId ?? null,
      triggeredAt: t.triggeredAt,
    })),
  };
}

function persistShape(n: NormalizedMilestone) {
  return {
    name: n.name,
    description: n.description,
    type: n.type,
    metric: n.metric,
    threshold: n.threshold,
    period: n.period,
    triggerPolicy: n.triggerPolicy,
    scope: (n.scope ?? null) as never,
    priority: n.priority,
    recognitionLevel: n.recognitionLevel,
    celebrationProfileId: n.celebrationProfileId,
    announcementId: n.announcementId,
    effectiveFrom: n.effectiveFrom,
    effectiveUntil: n.effectiveUntil,
  };
}

export async function createMilestone(
  actor: Pick<User, "id" | "role">,
  draft: MilestoneDraft,
  meta: Meta = {},
): Promise<{ id: number }> {
  assertCanManageMilestones(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const errs = validateMilestoneDraft(draft);
  if (errs.length)
    throw new HttpError(400, `Invalid milestone: ${errs.join(", ")}`, "invalid_milestone");
  const n = normalizeMilestoneDraft(draft);
  const now = nowIST();
  const id = await repo.insertMilestone({
    ...persistShape(n),
    enabled: false, // always created disabled — simulate, then enable
    createdByUserId: actor.id,
    createdAt: now,
    updatedAt: now,
  });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "MILESTONE_CREATED",
    entityType: "milestone",
    entityId: id,
    metadata: {
      before: null,
      after: {
        name: n.name,
        type: n.type,
        threshold: n.threshold,
        period: n.period,
        policy: n.triggerPolicy,
      },
      success: true,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { id };
}

export async function updateMilestone(
  actor: Pick<User, "id" | "role">,
  id: number,
  draft: MilestoneDraft,
  meta: Meta = {},
): Promise<{ id: number }> {
  assertCanManageMilestones(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const errs = validateMilestoneDraft(draft);
  if (errs.length)
    throw new HttpError(400, `Invalid milestone: ${errs.join(", ")}`, "invalid_milestone");
  const existing = await repo.getMilestone(id);
  if (!existing) throw new HttpError(404, "Milestone not found", "not_found");
  const n = normalizeMilestoneDraft(draft);
  await repo.updateMilestone(id, { ...persistShape(n), updatedAt: nowIST() });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "MILESTONE_UPDATED",
    entityType: "milestone",
    entityId: id,
    metadata: {
      before: {
        name: existing.name,
        type: existing.type,
        threshold: existing.threshold,
        period: existing.period,
        policy: existing.triggerPolicy,
      },
      after: {
        name: n.name,
        type: n.type,
        threshold: n.threshold,
        period: n.period,
        policy: n.triggerPolicy,
      },
      success: true,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { id };
}

export async function setMilestoneEnabled(
  actor: Pick<User, "id" | "role">,
  id: number,
  enabled: boolean,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanManageMilestones(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const existing = await repo.getMilestone(id);
  if (!existing) throw new HttpError(404, "Milestone not found", "not_found");
  await repo.updateMilestone(id, { enabled, updatedAt: nowIST() });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: enabled ? "MILESTONE_ENABLED" : "MILESTONE_DISABLED",
    entityType: "milestone",
    entityId: id,
    metadata: { before: { enabled: existing.enabled }, after: { enabled }, success: true },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

/* ---------------------------- simulate ------------------------------- */

export interface SimulateInput {
  id: number;
  /** required for individual milestones; ignored for team milestones */
  userId?: number;
  /** server operational date to evaluate against; defaults to today's US shift */
  operationalDate?: string;
}

/**
 * DRY-RUN — compute the authoritative value vs threshold and what WOULD fire,
 * WITHOUT any side effect: no recognition, no points, no announcement, no
 * `office_tv_events`, no `milestone_triggers` row, no leaderboard mutation.
 * Audits `MILESTONE_SIMULATED` (an explicit operator action).
 */
export async function simulateMilestone(
  actor: Pick<User, "id" | "role" | "process">,
  input: SimulateInput,
  meta: Meta = {},
): Promise<{
  milestoneId: number;
  type: string;
  period: string;
  threshold: number;
  currentValue: number;
  wouldFire: boolean;
  dedupeKey: string;
  reason: string;
  recognitionPreview: ReturnType<typeof buildMilestoneRecognition> | null;
}> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const m = await repo.getMilestone(input.id);
  if (!m) throw new HttpError(404, "Milestone not found", "not_found");
  const opDate =
    input.operationalDate && /^\d{4}-\d{2}-\d{2}$/.test(input.operationalDate)
      ? input.operationalDate
      : (await import("../time")).currentShiftDate(actor.process);

  const team = isTeamType(m.type);
  if (!team && !input.userId) {
    throw new HttpError(400, "Individual milestone simulation needs a userId", "user_required");
  }
  const scopeProcess = scopeProcessOf(m.scope);
  const value = await authoritativeValue(m, {
    userId: input.userId ?? 0,
    operationalDate: opDate,
    scopeProcess,
  });
  const periodKey = periodKeyFor(m.period as MilestonePeriod, opDate);
  const dedupeKey = dedupeKeyFor({
    milestoneId: m.id,
    policy: m.triggerPolicy as MilestoneTriggerPolicy,
    isTeam: team,
    userId: team ? null : (input.userId ?? null),
    periodKey,
    actualValue: value,
    threshold: m.threshold,
  });
  const firedKeys = await repo.firedKeysForMilestone(m.id);
  const dec = crossed(
    {
      milestoneId: m.id,
      policy: m.triggerPolicy as MilestoneTriggerPolicy,
      isTeam: team,
      userId: team ? null : (input.userId ?? null),
      periodKey,
      actualValue: value,
      threshold: m.threshold,
    },
    firedKeys,
  );
  const reason = !m.enabled
    ? "milestone is disabled"
    : value < m.threshold
      ? `below threshold (${value} < ${m.threshold})`
      : firedKeys.has(dedupeKey)
        ? "already fired for this key"
        : "threshold reached — would fire";
  const subjectName = team ? null : input.userId ? await repo.userName(input.userId) : null;
  const preview = dec.fired
    ? buildMilestoneRecognition({
        milestoneId: m.id,
        type: m.type,
        name: m.name,
        description: m.description ?? null,
        isTeam: team,
        subjectUserId: team ? null : (input.userId ?? null),
        subjectName,
        recognitionLevel: m.recognitionLevel,
        threshold: m.threshold,
        actualValue: value,
        scopeLabel: scopeProcess,
        points: isPointsType(m.type) ? value : null,
      })
    : null;

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "MILESTONE_SIMULATED",
    entityType: "milestone",
    entityId: m.id,
    metadata: {
      userId: input.userId ?? null,
      operationalDate: opDate,
      currentValue: value,
      threshold: m.threshold,
      wouldFire: dec.fired,
      dryRun: true,
      success: true,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return {
    milestoneId: m.id,
    type: m.type,
    period: m.period,
    threshold: m.threshold,
    currentValue: value,
    wouldFire: dec.fired,
    dedupeKey: dec.dedupeKey,
    reason,
    recognitionPreview: preview,
  };
}

/* ------------------------ the evaluation engine --------------------- */

function scopeProcessOf(scope: unknown): string | null {
  if (!scope || typeof scope !== "object") return null;
  const ps = (scope as { processes?: unknown }).processes;
  return Array.isArray(ps) && ps.length === 1 && typeof ps[0] === "string" ? ps[0] : null;
}

async function authoritativeValue(
  m: NonNullable<Awaited<ReturnType<typeof repo.getMilestone>>>,
  ctx: { userId: number; operationalDate: string; scopeProcess: string | null },
): Promise<number> {
  const w = windowFor(m.period as MilestonePeriod, ctx.operationalDate);
  switch (m.type) {
    case "INDIVIDUAL_POINTS":
      return repo.sumUserPoints(ctx.userId, w.from, w.to);
    case "INDIVIDUAL_COUNT":
    case "INDIVIDUAL_EVENT":
      return repo.countUserEvent(ctx.userId, m.metric ?? "", w.from, w.to);
    case "TEAM_POINTS":
      return repo.sumTeamPoints(w.from, w.to, ctx.scopeProcess);
    case "TEAM_COUNT":
    case "TEAM_EVENT":
      return repo.countTeamEvent(m.metric ?? "", w.from, w.to, ctx.scopeProcess);
    default:
      return 0; // reserved / unknown type → never fires
  }
}

export interface MilestoneEventContext {
  /** BusinessEvent.type / recognition kind that just happened, e.g. "LEAD_ACCEPTED" */
  eventType: string;
  subjectUserId: number;
  subjectRole: string | null;
  process: string;
  source: { type: string; id: string };
  /** the event's authoritative server shift date */
  operationalDate: string;
}

/**
 * Evaluate every enabled milestone that could be affected by this confirmed
 * event. Best-effort, total — a failure here never affects scoring, the CRM, or
 * the base celebration. Called from the recognition bridge AFTER the normal
 * celebration and from `onSale`.
 */
export async function evaluateMilestonesForEvent(ctx: MilestoneEventContext): Promise<void> {
  if (!isDbConfigured()) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ctx.operationalDate)) return;
  let actives: Awaited<ReturnType<typeof repo.listActiveMilestones>>;
  try {
    actives = await repo.listActiveMilestones(ctx.operationalDate);
  } catch {
    return;
  }
  const now = nowIST();

  for (const m of actives) {
    try {
      if (!isEvaluableType(m.type)) continue; // fail safe on reserved types
      const team = isTeamType(m.type);
      const pointsType = isPointsType(m.type);
      // COUNT / EVENT milestones only care about their own metric event;
      // POINTS milestones are affected by ANY point-bearing event for the user.
      if (!pointsType && (m.metric ?? "") !== ctx.eventType) continue;
      // scope: a process-scoped milestone ignores events from other processes
      const scopeProcesses =
        m.scope && Array.isArray((m.scope as { processes?: unknown }).processes)
          ? (m.scope as { processes: string[] }).processes
          : null;
      if (scopeProcesses && scopeProcesses.length && !scopeProcesses.includes(ctx.process))
        continue;

      const scopeProcess = scopeProcessOf(m.scope);
      const value = await authoritativeValue(m, {
        userId: ctx.subjectUserId,
        operationalDate: ctx.operationalDate,
        scopeProcess,
      });
      if (value < m.threshold) continue; // below threshold — NO audit, NO fire

      const periodKey = periodKeyFor(m.period as MilestonePeriod, ctx.operationalDate);
      const firedKeys = await repo.firedKeysForMilestone(m.id);
      const dec = crossed(
        {
          milestoneId: m.id,
          policy: m.triggerPolicy as MilestoneTriggerPolicy,
          isTeam: team,
          userId: team ? null : ctx.subjectUserId,
          periodKey,
          actualValue: value,
          threshold: m.threshold,
        },
        firedKeys,
      );
      if (!dec.fired) continue;

      // record the fire FIRST (unique dedupe key = retry / race safe)
      const { created } = await repo.insertTrigger({
        milestoneId: m.id,
        userId: team ? null : ctx.subjectUserId,
        periodKey,
        sourceType: ctx.source.type,
        sourceId: ctx.source.id,
        thresholdValue: m.threshold,
        actualValue: value,
        dedupeKey: dec.dedupeKey,
        recognitionSeq: null,
        triggeredAt: now,
        createdAt: now,
      });
      if (!created) continue; // lost a race — someone already fired this key

      const subjectName = team ? null : await repo.userName(ctx.subjectUserId).catch(() => null);
      const rec = buildMilestoneRecognition({
        milestoneId: m.id,
        type: m.type,
        name: m.name,
        description: m.description ?? null,
        isTeam: team,
        subjectUserId: team ? null : ctx.subjectUserId,
        subjectName,
        recognitionLevel: m.recognitionLevel,
        threshold: m.threshold,
        actualValue: value,
        scopeLabel: scopeProcess,
        points: pointsType ? value : null,
      });

      // configured celebration profile → its payload; else a minimal payload
      // carrying the configured level (the TV falls back safely).
      let celebrationProfile: Record<string, unknown> | null = null;
      if (m.celebrationProfileId) {
        celebrationProfile = await celebrationPayloadForProfileId(m.celebrationProfileId, {
          employeeName: subjectName,
          headline: rec.headline,
          points: rec.points,
        }).catch(() => null);
      }
      if (!celebrationProfile) {
        celebrationProfile = {
          level: rec.level,
          headline: rec.headline,
          subheadline: rec.subheadline,
          points: rec.points ?? 0,
          employeeName: subjectName,
        };
      }

      const seq = await recognizeMilestone({
        kind: rec.kind,
        subjectUserId: rec.subjectUserId,
        subjectName,
        subjectRole: team ? null : ctx.subjectRole,
        subjectPhotoAvailable: false,
        headline: rec.headline,
        subheadline: rec.subheadline,
        points: rec.points,
        celebrationLevel: rec.level,
        celebrationProfile,
        dedupeKey: dec.dedupeKey,
        operationalDate: ctx.operationalDate,
        sourceType: ctx.source.type,
        sourceId: ctx.source.id,
      }).catch(() => null);

      let annSeq: number | null = null;
      if (m.announcementId) {
        annSeq = await fireMilestoneAnnouncement(m.announcementId, {
          employeeName: subjectName,
          points: rec.points,
          headline: rec.headline,
        }).catch(() => null);
      }

      await recordAudit({
        actorUserId: null,
        actorRole: "system",
        action: "MILESTONE_TRIGGERED",
        entityType: "milestone",
        entityId: m.id,
        metadata: {
          source: { type: ctx.source.type, id: ctx.source.id },
          subjectUserId: rec.subjectUserId,
          isTeam: team,
          periodKey,
          threshold: m.threshold,
          actualValue: value,
          dedupeKey: dec.dedupeKey,
          recognitionSeq: seq,
          announcementId: m.announcementId ?? null,
          announcementSeq: annSeq,
          celebrationProfileId: m.celebrationProfileId ?? null,
          awardedPoints: false, // milestones NEVER award points
          success: true,
        },
      }).catch(() => undefined);
    } catch {
      // one milestone failing never blocks the others or the base celebration
    }
  }
}
