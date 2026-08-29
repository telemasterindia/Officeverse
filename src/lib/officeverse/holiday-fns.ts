/**
 * Officeverse — client-callable holiday-calendar + regularity-bonus server
 * functions (Phase 12).
 *
 * Outside `src/server/**`. Every handler derives the acting user + role from the
 * authenticated session. No client-supplied employee id, process, eligibility,
 * or bonus amount is ever trusted — the bonus is always recomputed server-side
 * from the authoritative Phase-11 leave_days + off_records.
 *
 *   GET   holidaysFn        → role-aware calendar
 *                             (Admin/HR: full list + audit; employee: own
 *                              process + company-wide, ACTIVE only)
 *   POST  addHolidayFn      → add a holiday (Admin/HR)
 *   POST  updateHolidayFn   → edit a holiday (Admin/HR)
 *   POST  deactivateHolidayFn → soft-deactivate a holiday (Admin/HR)
 *   POST  seedUsFederalFn   → generate a year's US federal holidays (Admin/HR)
 *   GET   myBonusFn         → caller's own regularity bonus for a month
 *   GET   adminBonusFn      → all bonus rows (Admin/HR), filterable
 *   POST  recalcBonusFn     → (re)calculate one employee + month (Admin/HR)
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
const year = z.coerce.number().int().gte(1970).lte(2100);
const processCode = z.enum(["US", "UK", "IN", "AU"]);
const holidayType = z.enum(["US_FEDERAL", "INDIAN", "COMPANY", "WEEKLY_OFF"]);

const listInput = z
  .object({
    year: z
      .string()
      .trim()
      .regex(/^\d{4}$/)
      .optional(),
    type: holidayType.optional(),
    process: processCode.optional(),
  })
  .partial()
  .default({});

const addInput = z.object({
  name: z.string().trim().min(1).max(120),
  holidayType,
  holidayDate: ymd,
  observedDate: ymd.optional(),
  // omitted / "" → company-wide (applies to every process)
  appliesToProcess: processCode.optional(),
});

const updateInput = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  holidayDate: ymd.optional(),
  observedDate: ymd.nullable().optional(),
  appliesToProcess: processCode.nullable().optional(),
  active: z.boolean().optional(),
});

const idInput = z.object({ id: z.coerce.number().int().positive() });

const seedInput = z.object({ year });

const myBonusInput = z.object({ month: month.optional() }).partial().default({});

const adminBonusInput = z
  .object({
    month: month.optional(),
    employee: z.string().trim().max(191).optional(),
    process: processCode.optional(),
    eligible: z.coerce.boolean().optional(),
  })
  .partial()
  .default({});

const recalcBonusInput = z.object({
  userId: z.coerce.number().int().positive(),
  month,
});

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
function currentYear(): string {
  return new Date().toISOString().slice(0, 4);
}

/* ------------------------------- holidays ------------------------- */

export const holidaysFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (user.role === "admin" || user.role === "hr") {
      return svc.listHolidays(user, {
        year: data.year,
        type: data.type,
        process: data.process,
      });
    }
    return svc.myHolidays(user, data.year ?? currentYear());
  });

export const addHolidayFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => addInput.parse(d))
  .handler(async ({ data }): Promise<{ id: number }> => {
    const user = await requireUser();
    return svc.addHoliday(user, data, requestInfo());
  });

export const updateHolidayFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const user = await requireUser();
    const { id, ...patch } = data;
    return svc.updateHolidayEntry(user, id, patch, requestInfo());
  });

export const deactivateHolidayFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const user = await requireUser();
    return svc.deactivateHoliday(user, data.id, requestInfo());
  });

export const seedUsFederalFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => seedInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.seedUsFederal(user, data.year, requestInfo());
  });

/* --------------------------- regularity bonus ------------------- */

export const myBonusFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => myBonusInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.myBonus(user, data.month ?? currentMonth());
  });

export const adminBonusFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => adminBonusInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.listAllBonus(user, data);
  });

export const recalcBonusFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => recalcBonusInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.recalcBonusForEmployee(user, data.userId, data.month, requestInfo());
  });
