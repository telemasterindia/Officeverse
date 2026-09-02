/**
 * Officeverse — OPERATIONS CONTROL · client-callable server functions
 * (Phase 6.5).
 *
 * Outside `src/server/**`. Every handler resolves the acting user from the
 * authenticated session (`requireRole("admin", "closer")`) — the Closer is the
 * Operations Manager in this business — and delegates to the server services,
 * which re-check authorization and write the audit trail.
 *
 * The browser NEVER supplies the actor id / role, a computed score, a points
 * value, or an incentive amount. Scoring / incentive rule DEFINITIONS are
 * managed through the existing `scoring-fns.ts` surface (also widened to the
 * Operations role in Phase 6.5).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRole, requestInfo } from "@/server/context";
import { celebrationOverview, triggerTestCelebration } from "@/server/live/celebration-ops";
import {
  createCelebrationProfile,
  listCelebrationProfiles,
  playCelebrationProfile,
  previewCelebrationProfile,
  setCelebrationProfileEnabled,
  updateCelebrationProfile,
  type ProfileDraft,
} from "@/server/live/celebration-profile-service";
import {
  createAnnouncement,
  listAnnouncements,
  setAnnouncementEnabled,
  stopAnnouncement,
  updateAnnouncementFields,
  type AnnouncementInput,
} from "@/server/live/service";
import { playAnnouncementNow, previewAnnouncement } from "@/server/live/announcement-ops";
import {
  createMilestone,
  listMilestones,
  setMilestoneEnabled,
  simulateMilestone,
  updateMilestone,
  type MilestoneDraft,
} from "@/server/milestones/milestone-service";
import {
  createPowerHour,
  listPowerHours,
  startPowerHour,
  stopPowerHour,
} from "@/server/live/power-hour";
import { listOperationsAudit } from "@/server/live/ops-audit";

const DT = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
const idInput = z.object({ id: z.coerce.number().int().positive() });

/* ------------------------- access + celebration ------------------------- */

export const operationsAccessFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async (): Promise<{ role: string; canRunOperations: true }> => {
    const user = await requireRole("admin", "closer");
    return { role: user.role, canRunOperations: true };
  });

export const celebrationOverviewFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireRole("admin", "closer");
    return celebrationOverview(user);
  });

export const triggerTestCelebrationFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        level: z.enum(["LEVEL_0", "LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"]),
        headline: z.string().trim().max(60).optional(),
        withAudio: z.boolean().optional(),
        audioProfile: z.string().trim().max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return triggerTestCelebration(
      user,
      {
        level: data.level,
        ...(data.headline !== undefined ? { headline: data.headline } : {}),
        ...(data.withAudio !== undefined ? { withAudio: data.withAudio } : {}),
        ...(data.audioProfile !== undefined ? { audioProfile: data.audioProfile } : {}),
      },
      requestInfo(),
    );
  });

/* --------------------- celebration profile builder -------------------- */

const profileDraft = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).nullish(),
  recognitionLevel: z.enum(["LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"]),
  triggerEvent: z
    .enum([
      "LEAD_SUBMITTED",
      "LEAD_ACCEPTED",
      "SALE",
      "THIRD_ACCEPTED_LEAD",
      "TEAM_MILESTONE",
      "ACHIEVEMENT_UNLOCKED",
      "MANUAL",
    ])
    .nullish(),
  priority: z.coerce.number().int().min(0).max(100_000).optional(),
  config: z.unknown(),
});

function toDraft(d: z.infer<typeof profileDraft>): ProfileDraft {
  return {
    name: d.name,
    recognitionLevel: d.recognitionLevel,
    config: d.config,
    ...(d.description !== undefined && d.description !== null
      ? { description: d.description }
      : {}),
    ...(d.triggerEvent != null ? { triggerEvent: d.triggerEvent } : {}),
    ...(d.priority !== undefined ? { priority: d.priority } : {}),
  };
}

export const celebrationProfilesFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireRole("admin", "closer");
    return listCelebrationProfiles(user);
  });

export const createCelebrationProfileFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => profileDraft.parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return createCelebrationProfile(user, toDraft(data), requestInfo());
  });

export const updateCelebrationProfileFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => profileDraft.extend({ id: idInput.shape.id }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    const { id, ...rest } = data;
    return updateCelebrationProfile(user, id, toDraft(rest), requestInfo());
  });

export const setCelebrationProfileEnabledFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.extend({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return setCelebrationProfileEnabled(user, data.id, data.enabled, requestInfo());
  });

export const previewCelebrationProfileFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return previewCelebrationProfile(user, data.id);
  });

export const playCelebrationProfileFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    idInput
      .extend({
        employeeName: z.string().trim().max(80).optional(),
        headline: z.string().trim().max(60).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return playCelebrationProfile(
      user,
      {
        id: data.id,
        ...(data.employeeName !== undefined ? { employeeName: data.employeeName } : {}),
        ...(data.headline !== undefined ? { headline: data.headline } : {}),
      },
      requestInfo(),
    );
  });

/* ---------------------- announcement command center ------------------- */

const cueSound = z.enum(["none", "bell", "chime", "success", "applause", "victory", "alert"]);
const announcementInput = z.object({
  title: z.string().trim().min(2).max(120),
  subtitle: z.string().trim().max(160).nullish(),
  message: z.string().trim().min(2).max(600),
  audience: z.enum(["all", "agents", "closers"]).optional(),
  process: z.enum(["US", "UK", "IN", "AU"]).nullish(),
  effect: z.string().trim().max(24).optional(),
  durationMs: z.coerce.number().int().min(2000).max(120_000).optional(),
  priority: z.enum(["NORMAL", "IMPORTANT", "URGENT"]).optional(),
  ttsEnabled: z.boolean().optional(),
  ttsConfig: z
    .object({
      voiceName: z.string().trim().max(80).nullish(),
      rate: z.coerce.number().min(0.5).max(2).optional(),
      pitch: z.coerce.number().min(0).max(2).optional(),
      volume: z.coerce.number().min(0).max(1).optional(),
      lang: z.string().trim().max(12).optional(),
    })
    .nullish(),
  openingSound: cueSound.optional(),
  closingSound: cueSound.optional(),
  celebrationProfileId: z.coerce.number().int().positive().nullish(),
  publishNow: z.boolean().optional(),
});

function toAnnouncementInput(d: z.infer<typeof announcementInput>): AnnouncementInput {
  return {
    title: d.title,
    message: d.message,
    ...(d.subtitle != null ? { subtitle: d.subtitle } : {}),
    ...(d.audience !== undefined ? { audience: d.audience } : {}),
    ...(d.process != null ? { process: d.process } : {}),
    ...(d.effect !== undefined ? { effect: d.effect } : {}),
    ...(d.durationMs !== undefined ? { durationMs: d.durationMs } : {}),
    ...(d.priority !== undefined ? { priority: d.priority } : {}),
    ...(d.ttsEnabled !== undefined ? { ttsEnabled: d.ttsEnabled } : {}),
    ...(d.ttsConfig != null ? { ttsConfig: d.ttsConfig as Record<string, unknown> } : {}),
    ...(d.openingSound !== undefined ? { openingSound: d.openingSound } : {}),
    ...(d.closingSound !== undefined ? { closingSound: d.closingSound } : {}),
    ...(d.celebrationProfileId != null ? { celebrationProfileId: d.celebrationProfileId } : {}),
    ...(d.publishNow !== undefined ? { publishNow: d.publishNow } : {}),
  };
}

export const announcementsFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireRole("admin", "closer");
    return listAnnouncements(user);
  });

export const createAnnouncementFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => announcementInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return createAnnouncement(user, toAnnouncementInput(data), requestInfo());
  });

export const updateAnnouncementFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => announcementInput.extend({ id: idInput.shape.id }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    const { id, ...rest } = data;
    return updateAnnouncementFields(user, id, toAnnouncementInput(rest), requestInfo());
  });

export const setAnnouncementEnabledFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.extend({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return setAnnouncementEnabled(user, data.id, data.enabled, requestInfo());
  });

export const stopAnnouncementCcFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return stopAnnouncement(user, data.id, requestInfo());
  });

export const previewAnnouncementFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return previewAnnouncement(user, data.id);
  });

export const playAnnouncementNowFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return playAnnouncementNow(user, data.id, requestInfo());
  });

/* ---------------------------- milestone engine ----------------------- */

const milestoneDraft = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).nullish(),
  type: z.enum([
    "INDIVIDUAL_COUNT",
    "INDIVIDUAL_POINTS",
    "INDIVIDUAL_EVENT",
    "TEAM_COUNT",
    "TEAM_POINTS",
    "TEAM_EVENT",
  ]),
  metric: z.string().trim().max(64).nullish(),
  threshold: z.coerce.number().int().min(1).max(100_000_000),
  period: z.enum(["DAILY", "WEEKLY", "MONTHLY", "ALL_TIME"]).optional(),
  triggerPolicy: z.enum(["ONCE", "PER_PERIOD", "EVERY_THRESHOLD_CROSSING"]).optional(),
  scope: z.object({ processes: z.array(z.string().trim().max(4)).max(4).nullish() }).nullish(),
  priority: z.coerce.number().int().min(0).max(100_000).optional(),
  recognitionLevel: z.enum(["LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"]).optional(),
  celebrationProfileId: z.coerce.number().int().positive().nullish(),
  announcementId: z.coerce.number().int().positive().nullish(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});

function toMilestoneDraft(d: z.infer<typeof milestoneDraft>): MilestoneDraft {
  return {
    name: d.name,
    type: d.type,
    threshold: d.threshold,
    effectiveFrom: d.effectiveFrom,
    ...(d.description != null ? { description: d.description } : {}),
    ...(d.metric != null ? { metric: d.metric } : {}),
    ...(d.period !== undefined ? { period: d.period } : {}),
    ...(d.triggerPolicy !== undefined ? { triggerPolicy: d.triggerPolicy } : {}),
    ...(d.scope?.processes != null
      ? { scope: { processes: d.scope.processes.filter((p): p is string => !!p) } }
      : {}),
    ...(d.priority !== undefined ? { priority: d.priority } : {}),
    ...(d.recognitionLevel !== undefined ? { recognitionLevel: d.recognitionLevel } : {}),
    ...(d.celebrationProfileId != null ? { celebrationProfileId: d.celebrationProfileId } : {}),
    ...(d.announcementId != null ? { announcementId: d.announcementId } : {}),
    ...(d.effectiveUntil != null ? { effectiveUntil: d.effectiveUntil } : {}),
  };
}

export const milestonesFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    // list + simulate are operational visibility (Admin + Closer); the service
    // gates DEFINITION mutations to Admin only.
    const user = await requireRole("admin", "closer");
    return listMilestones(user);
  });

export const createMilestoneFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => milestoneDraft.parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return createMilestone(user, toMilestoneDraft(data), requestInfo());
  });

export const updateMilestoneFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => milestoneDraft.extend({ id: idInput.shape.id }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    const { id, ...rest } = data;
    return updateMilestone(user, id, toMilestoneDraft(rest), requestInfo());
  });

export const setMilestoneEnabledFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.extend({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return setMilestoneEnabled(user, data.id, data.enabled, requestInfo());
  });

export const simulateMilestoneFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    idInput
      .extend({
        userId: z.coerce.number().int().positive().optional(),
        operationalDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return simulateMilestone(
      user,
      {
        id: data.id,
        ...(data.userId !== undefined ? { userId: data.userId } : {}),
        ...(data.operationalDate !== undefined ? { operationalDate: data.operationalDate } : {}),
      },
      requestInfo(),
    );
  });

/* ------------------------------ power hour ----------------------------- */

export const powerHoursFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireRole("admin", "closer");
    return listPowerHours(user);
  });

export const createPowerHourFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        title: z.string().trim().min(2).max(120),
        message: z.string().trim().min(2).max(600),
        startsAt: z.string().regex(DT),
        endsAt: z.string().regex(DT),
        audience: z.enum(["all", "agents", "closers"]).optional(),
        process: z.enum(["US", "UK", "IN", "AU"]).nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return createPowerHour(
      user,
      {
        title: data.title,
        message: data.message,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        ...(data.audience !== undefined ? { audience: data.audience } : {}),
        ...(data.process != null ? { process: data.process } : {}),
      },
      requestInfo(),
    );
  });

export const startPowerHourFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return startPowerHour(user, data.id, requestInfo());
  });

export const stopPowerHourFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return stopPowerHour(user, data.id, requestInfo());
  });

/* -------------------------------- audit ------------------------------- */

export const operationsAuditFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        action: z.string().max(64).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const user = await requireRole("admin", "closer");
    return listOperationsAudit(user, {
      ...(data.limit !== undefined ? { limit: data.limit } : {}),
      ...(data.action !== undefined ? { action: data.action } : {}),
    });
  });
