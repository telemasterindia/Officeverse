/**
 * Officeverse — PERFORMANCE INTELLIGENCE · client-callable server functions
 * (Phase 8).
 *
 * Outside `src/server/**`. Every handler resolves the acting user from the
 * session (`requireUser()`); the SERVICE enforces role authorization
 * (`canRunOperations` = Admin + Operations Manager; Agent → own row only;
 * existing HR/Admin gamification boundary preserved).
 *
 * READ-ONLY. No mutation, no audit noise. Points are read from the authoritative
 * ledger — never computed here.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/server/context";
import * as svc from "@/server/gamification/performance";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const PROC = z.enum(["US", "UK", "IN", "AU"]);

const periodInput = z.object({
  period: z.enum(["today", "week", "month", "custom"]).optional(),
  from: z.string().regex(YMD).optional(),
  to: z.string().regex(YMD).optional(),
  process: PROC.optional(),
});

const employeeInput = periodInput.extend({
  userId: z.coerce.number().int().positive(),
});

const breakdownInput = periodInput.extend({
  userId: z.coerce.number().int().positive().optional(),
});

export type PerformancePeriodInput = z.input<typeof periodInput>;
export type PerformanceEmployeeInput = z.input<typeof employeeInput>;

export const performanceLeaderboardFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => periodInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.performanceLeaderboard(user, {
      ...(data.period !== undefined ? { period: data.period } : {}),
      ...(data.from !== undefined ? { from: data.from } : {}),
      ...(data.to !== undefined ? { to: data.to } : {}),
      ...(data.process !== undefined ? { process: data.process } : {}),
    });
  });

export const performanceEmployeeFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => employeeInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.performanceEmployee(user, data.userId, {
      ...(data.period !== undefined ? { period: data.period } : {}),
      ...(data.from !== undefined ? { from: data.from } : {}),
      ...(data.to !== undefined ? { to: data.to } : {}),
    });
  });

export const performanceBreakdownFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => breakdownInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.performanceBreakdown(user, {
      ...(data.period !== undefined ? { period: data.period } : {}),
      ...(data.from !== undefined ? { from: data.from } : {}),
      ...(data.to !== undefined ? { to: data.to } : {}),
      ...(data.process !== undefined ? { process: data.process } : {}),
      ...(data.userId !== undefined ? { userId: data.userId } : {}),
    });
  });

export const incentiveSnapshotFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => periodInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.incentiveReadySnapshot(user, {
      ...(data.period !== undefined ? { period: data.period } : {}),
      ...(data.from !== undefined ? { from: data.from } : {}),
      ...(data.to !== undefined ? { to: data.to } : {}),
      ...(data.process !== undefined ? { process: data.process } : {}),
    });
  });
