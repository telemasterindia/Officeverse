/**
 * Officeverse — dynamic shift-override server functions (Admin UAT Batch-2
 * follow-up §1). Admin only — the service enforces it; HR / Agents / Closers
 * cannot see or change shift timing.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/attendance/shift-override-service";

const proc = z.enum(["US", "UK", "IN", "AU"]);
const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const hhmm = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM (24h)");

const listInput = z.object({
  process: proc.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
});

const setInput = z.object({
  process: proc,
  operationalDate: ymd,
  startHHMM: hhmm,
  endHHMM: hhmm,
  reportingHHMM: hhmm.nullish(),
  shortLateFromHHMM: hhmm.nullish(),
  lateFromHHMM: hhmm.nullish(),
  reason: z.string().trim().max(255).optional(),
});
export type SetShiftOverrideInput = z.input<typeof setInput>;

const dateKey = z.object({ process: proc, operationalDate: ymd });

export const listShiftOverridesFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.listShiftOverrides(user, data);
  });

export const setShiftOverrideFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => setInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.setShiftOverride(user, data as svc.SetShiftOverrideInput, requestInfo());
  });

export const removeShiftOverrideFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => dateKey.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.removeShiftOverride(user, data, requestInfo());
  });

export const recomputeShiftDateFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => dateKey.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.recomputeAttendanceForDate(user, data, requestInfo());
  });

export const effectiveShiftFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => dateKey.parse(d))
  .handler(async ({ data }) => {
    await requireUser();
    return svc.effectiveShiftForDate(data.process, data.operationalDate);
  });
