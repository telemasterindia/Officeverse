/**
 * Officeverse — client-callable attendance server functions (Phase 10).
 *
 * Outside `src/server/**` (client import-protection). Handlers derive identity +
 * role from the authenticated session — the client never sends a user id, role,
 * process, shift, or timestamp that affects the result.
 *
 *   GET   myAttendanceFn      → the caller's OWN attendance rows
 *   GET   adminAttendanceFn   → all rows (Admin / HR only), filterable
 *   POST  correctAttendanceFn → Admin / HR correction with an audit trail
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/attendance/service";

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const rangeInput = z.object({ from: ymd.optional(), to: ymd.optional() }).partial().default({});

const adminFilters = z
  .object({
    from: ymd.optional(),
    to: ymd.optional(),
    employee: z.string().trim().max(191).optional(),
    process: z.string().trim().max(4).optional(),
    shiftName: z.string().trim().max(40).optional(),
    status: z.string().trim().max(40).optional(),
  })
  .partial()
  .default({});

const correctInput = z.object({
  id: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
  patch: z
    .object({
      firstCheckInAt: z.string().trim().max(25).optional(),
      lastCheckOutAt: z.string().trim().max(25).optional(),
      totalMinutes: z.number().int().min(0).max(1440).optional(),
      lateMinutes: z.number().int().min(0).max(1440).optional(),
      earlyDepartureMinutes: z.number().int().min(0).max(1440).optional(),
      status: z.string().trim().max(40).optional(),
      checkInStatus: z.string().trim().max(20).optional(),
      checkOutStatus: z.string().trim().max(20).optional(),
      shortAttendance: z.boolean().optional(),
    })
    .partial(),
});

export const myAttendanceFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => rangeInput.parse(d ?? {}))
  .handler(async ({ data }): Promise<svc.MyAttendanceResult> => {
    const user = await requireUser();
    return svc.listMyAttendance(user, data);
  });

export const adminAttendanceFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => adminFilters.parse(d ?? {}))
  .handler(async ({ data }): Promise<svc.AdminAttendanceResult> => {
    const user = await requireUser();
    return svc.listAllAttendance(user, data);
  });

export const correctAttendanceFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => correctInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const user = await requireUser();
    return svc.correctAttendance(user, data.id, data.patch, data.reason, requestInfo());
  });
