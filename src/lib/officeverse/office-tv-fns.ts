/**
 * Officeverse — client-callable Office TV / Live Experience server functions
 * (Phase 21). Admin-only management surface.
 *
 * Outside `src/server/**`. Every handler resolves identity via `requireUser()`
 * and the service enforces `assertCanManageOfficeTv` (admin). The TV display
 * surface itself does NOT use these — it is authenticated by a display token
 * against `GET /api/office-tv/state`.
 *
 * The client never supplies recognition events, points, ranks, or a "sale
 * happened" flag. An announcement is an ANNOUNCEMENT — it never creates
 * payroll / salary / commission / incentive data.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/live/service";

const idInput = z.object({ id: z.coerce.number().int().positive() });

/* ----------------------------- displays ----------------------------- */

export const officeTvDisplaysFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireUser();
    return svc.listDisplays(user);
  });

export const createDisplayFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ name: z.string().trim().min(2).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.createDisplay(user, data.name, requestInfo());
  });

export const revokeDisplayFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.revokeDisplay(user, data.id, requestInfo());
  });

export const rotateDisplayFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.rotateDisplay(user, data.id, requestInfo());
  });

/* ------------------------------ settings --------------------------- */

export const officeTvSettingsFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireUser();
    return svc.getSettings(user);
  });

export const updateOfficeTvSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        displayName: z.string().trim().min(1).max(80).optional(),
        rotationSec: z.coerce.number().int().min(4).max(60).optional(),
        leaderboardWindow: z.enum(["daily", "weekly", "monthly", "alltime"]).optional(),
        celebrationIntensity: z.enum(["low", "normal", "high"]).optional(),
        soundEnabled: z.boolean().optional(),
        thirdAcceptedThreshold: z.coerce.number().int().min(1).max(100).optional(),
        teamMilestoneEvery: z.coerce.number().int().min(0).max(100_000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.updateSettings(user, data, requestInfo());
  });

/* ----------------------- celebration assets ----------------------- */

export const celebrationAssetsFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireUser();
    return svc.listAssets(user);
  });

export const uploadCelebrationAssetFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        category: z.enum([
          "VICTORY",
          "FIREWORKS",
          "CONFETTI",
          "GOLD",
          "MONEY",
          "ENERGY",
          "CHAMPION",
          "PARTY",
          "FESTIVAL",
        ]),
        label: z.string().trim().max(80).default(""),
        dataBase64: z.string().min(64).max(12_000_000),
        filename: z.string().trim().max(120).optional(),
        durationMs: z.coerce.number().int().min(500).max(20_000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const bytes = new Uint8Array(Buffer.from(data.dataBase64, "base64"));
    return svc.uploadAsset(
      user,
      {
        category: data.category,
        label: data.label,
        bytes,
        filename: data.filename ?? null,
        durationMs: data.durationMs ?? null,
      },
      requestInfo(),
    );
  });

export const setCelebrationAssetEnabledFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.coerce.number().int().positive(), enabled: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.setAssetEnabled(user, data.id, data.enabled, requestInfo());
  });

export const deleteCelebrationAssetFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.deleteAsset(user, data.id, requestInfo());
  });

/* ------------------------- announcements ------------------------- */

const announcementInput = z.object({
  title: z.string().trim().min(2).max(120),
  subtitle: z.string().trim().max(160).optional(),
  message: z.string().trim().min(2).max(600),
  audience: z.enum(["all", "agents", "closers"]).optional(),
  process: z.enum(["US", "UK", "IN", "AU"]).nullish(),
  effect: z.string().trim().max(24).optional(),
  assetId: z.coerce.number().int().positive().nullish(),
  durationMs: z.coerce.number().int().min(2000).max(120_000).optional(),
  priority: z.enum(["NORMAL", "IMPORTANT", "URGENT"]).optional(),
  publishAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/)
    .nullish(),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/)
    .nullish(),
  publishNow: z.boolean().optional(),
});

export const officeTvAnnouncementsFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireUser();
    return svc.listAnnouncements(user);
  });

export const createAnnouncementFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => announcementInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.createAnnouncement(
      user,
      {
        title: data.title,
        message: data.message,
        ...(data.subtitle !== undefined ? { subtitle: data.subtitle } : {}),
        ...(data.audience !== undefined ? { audience: data.audience } : {}),
        ...(data.process != null ? { process: data.process } : {}),
        ...(data.effect !== undefined ? { effect: data.effect } : {}),
        ...(data.assetId != null ? { assetId: data.assetId } : {}),
        ...(data.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.publishAt != null ? { publishAt: data.publishAt } : {}),
        ...(data.expiresAt != null ? { expiresAt: data.expiresAt } : {}),
        ...(data.publishNow !== undefined ? { publishNow: data.publishNow } : {}),
      },
      requestInfo(),
    );
  });

export const publishAnnouncementFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.publishAnnouncementNow(user, data.id, requestInfo());
  });

export const stopAnnouncementFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.stopAnnouncement(user, data.id, requestInfo());
  });

/* -------------------------------- seed --------------------------- */

export const seedOfficeTvFn = createServerFn({ method: "POST" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireUser();
    return svc.seedOfficeTv(user, requestInfo());
  });
