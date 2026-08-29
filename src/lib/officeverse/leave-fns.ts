/**
 * Officeverse — client-callable HR leave / off server functions (Phase 11).
 *
 * Outside `src/server/**`. Every handler derives the acting user + role from
 * the authenticated session — no client-supplied employee id, approver id,
 * role, leave owner, off owner, or source attendance is trusted.
 *
 *   POST  requestLeaveFn   → employee files leave for THEMSELVES
 *   GET   myHrFn           → own leave + leave_days + off + monthly counters
 *   GET   adminLeaveFn     → all leave (Admin/HR), filterable
 *   GET   adminOffFn       → all Off records (Admin/HR), filterable
 *   POST  decideLeaveFn    → approve / reject / cancel (Admin/HR; not own)
 *   POST  recalcHrFn       → recompute a user's month (Admin/HR)
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/hr/service";

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const month = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM");

const requestInput = z.object({
  leaveType: z.string().trim().max(40).optional(),
  startDate: ymd,
  endDate: ymd,
  reason: z.string().trim().max(500).optional(),
});

const myInput = z.object({ month: month.optional() }).partial().default({});

const adminLeaveInput = z
  .object({
    from: ymd.optional(),
    to: ymd.optional(),
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
    employee: z.string().trim().max(191).optional(),
  })
  .partial()
  .default({});

const adminOffInput = z
  .object({
    month: month.optional(),
    offType: z
      .enum(["LATE_CONVERSION", "SHORT_ATTENDANCE_CONVERSION", "WEEKLY_OFF", "OTHER_COMPANY_OFF"])
      .optional(),
    employee: z.string().trim().max(191).optional(),
  })
  .partial()
  .default({});

const decideInput = z.object({
  id: z.coerce.number().int().positive(),
  decision: z.enum(["APPROVED", "REJECTED", "CANCELLED"]),
  note: z.string().trim().max(500).optional(),
});

const recalcInput = z.object({
  userId: z.coerce.number().int().positive(),
  process: z.enum(["US", "UK", "IN", "AU"]),
  month,
});

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export const requestLeaveFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => requestInput.parse(d))
  .handler(async ({ data }): Promise<{ id: number }> => {
    const user = await requireUser();
    return svc.requestLeave(user, data, requestInfo());
  });

export const myHrFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => myInput.parse(d ?? {}))
  .handler(async ({ data }): Promise<svc.MyHrResult> => {
    const user = await requireUser();
    return svc.myHr(user, data.month ?? currentMonth());
  });

export const adminLeaveFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => adminLeaveInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.listAllLeave(user, data);
  });

export const adminOffFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => adminOffInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.listAllOff(user, data);
  });

export const decideLeaveFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => decideInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const user = await requireUser();
    return svc.decideLeave(user, data.id, data.decision, data.note, requestInfo());
  });

export const recalcHrFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => recalcInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const user = await requireUser();
    return svc.recalcHr(user, data.userId, data.process, data.month, requestInfo());
  });
