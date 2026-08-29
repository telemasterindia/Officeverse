/**
 * Officeverse — client-callable gamification server functions (Phase 20).
 *
 * Outside `src/server/**`. Every handler derives the acting user + role from
 * the session (`requireUser()`), then delegates to `@/server/gamification/*`.
 *
 * The client NEVER supplies a point amount, rank, score, achievement award or
 * "sale happened" flag. It may only:
 *   - read its own gamification profile           (myGamificationFn)
 *   - read a leaderboard for a window / process   (leaderboardFn)
 *   - read a participant's detail (self or mgr)   (gamificationParticipantFn)
 * and, for Admin / HR only:
 *   - reverse a specific ledger row (reason req.) (reversePointFn)
 *   - post an explicit audited adjustment         (adjustPointsFn)
 *   - read / edit the data-driven point rules     (gamificationRulesFn / setGamificationRuleFn)
 *   - seed the defaults                           (seedGamificationFn)
 *
 * There is deliberately no "award points" / "give N points" endpoint — business
 * events reach the points engine server-side only (Phase 21).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/gamification/service";

const userId = z.coerce.number().int().positive();
const reason = z.string().trim().min(5).max(400);

const leaderboardInput = z
  .object({
    kind: z.enum(["daily", "weekly", "monthly", "alltime"]).optional(),
    process: z.enum(["US", "UK", "IN", "AU"]).optional(),
  })
  .partial()
  .default({});

const participantInput = z.object({ userId });
const reverseInput = z.object({ transactionId: z.coerce.number().int().positive(), reason });
const adjustInput = z.object({
  targetUserId: userId,
  points: z.coerce
    .number()
    .int()
    .refine((n) => n !== 0, "must be non-zero"),
  reason,
});
const setRuleInput = z.object({
  event: z.enum([
    "LEAD_SUBMITTED",
    "LEAD_ACCEPTED",
    "SALE",
    "TEAM_MILESTONE",
    "ACHIEVEMENT_UNLOCKED",
  ]),
  points: z.coerce.number().int().min(0).max(100_000),
  enabled: z.boolean(),
  note: z.string().trim().max(255).optional(),
});

export const myGamificationFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireUser();
    return svc.myGamification(user);
  });

export const leaderboardFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => leaderboardInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.getLeaderboard(user, { kind: data.kind, process: data.process });
  });

export const gamificationParticipantFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => participantInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.participantDetail(user, data.userId);
  });

export const reversePointFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => reverseInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.reversePointTransaction(user, data.transactionId, data.reason, requestInfo());
  });

export const adjustPointsFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => adjustInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.adjustPoints(
      user,
      { targetUserId: data.targetUserId, points: data.points, reason: data.reason },
      requestInfo(),
    );
  });

export const gamificationRulesFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireUser();
    return svc.listRules(user);
  });

export const setGamificationRuleFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => setRuleInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.setRule(
      user,
      {
        event: data.event,
        points: data.points,
        enabled: data.enabled,
        ...(data.note !== undefined ? { note: data.note } : {}),
      },
      requestInfo(),
    );
  });

export const seedGamificationFn = createServerFn({ method: "POST" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireUser();
    return svc.seedGamification(user, requestInfo());
  });
