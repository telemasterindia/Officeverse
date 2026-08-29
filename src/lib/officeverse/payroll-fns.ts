/**
 * Officeverse — client-callable payroll + salary server functions (Phase 13).
 *
 * Outside `src/server/**`. Every handler derives the acting user + role from the
 * authenticated session. The client NEVER supplies a calculated salary, a
 * regularity-bonus amount, a leave / Off count, a payroll status, or an
 * approver / lock identity — payroll values are computed server-side and the
 * bonus comes from the Phase-12 engine. The only client-supplied money is the
 * base-salary CONFIGURATION value on setSalaryProfileFn (Admin/HR only).
 *
 *   POST  setSalaryProfileFn  → add an effective-dated base salary (Admin/HR)
 *   GET   salaryProfilesFn    → list salary profiles (Admin/HR)
 *   POST  calculatePayrollFn  → calculate / recalculate one employee+month
 *   POST  approvePayrollFn    → CALCULATED → APPROVED
 *   POST  lockPayrollFn       → APPROVED → LOCKED
 *   POST  reopenPayrollFn     → APPROVED/LOCKED → CALCULATED (reason required)
 *   GET   adminPayrollFn      → all payroll runs (Admin/HR), filterable
 *   GET   myPayrollFn         → caller's own payroll rows only
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/hr/payroll-service";

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const month = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM");
const processCode = z.enum(["US", "UK", "IN", "AU"]);
const payrollStatus = z.enum(["DRAFT", "CALCULATED", "APPROVED", "LOCKED"]);
const userId = z.coerce.number().int().positive();

const setSalaryInput = z.object({
  userId,
  // configuration value, not a payroll result — Admin/HR only, bounded & non-negative
  baseSalary: z.coerce.number().finite().min(0).max(100_000_000),
  effectiveFrom: ymd,
  note: z.string().trim().max(255).optional(),
});

const salaryListInput = z
  .object({ employee: z.string().trim().max(191).optional() })
  .partial()
  .default({});

const calcInput = z.object({ userId, month });
const approveInput = z.object({ userId, month });
const lockInput = z.object({ userId, month });
const reopenInput = z.object({ userId, month, reason: z.string().trim().min(3).max(255) });

const adminListInput = z
  .object({
    month: month.optional(),
    employee: z.string().trim().max(191).optional(),
    process: processCode.optional(),
    status: payrollStatus.optional(),
  })
  .partial()
  .default({});

const myInput = z.object({ month: month.optional() }).partial().default({});

/* --------------------------- salary config --------------------- */

export const setSalaryProfileFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => setSalaryInput.parse(d))
  .handler(async ({ data }): Promise<{ id: number }> => {
    const user = await requireUser();
    const { userId: target, ...rest } = data;
    return svc.setSalaryProfile(user, target, rest, requestInfo());
  });

export const salaryProfilesFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => salaryListInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.listSalaryProfiles(user, data);
  });

/* --------------------------- payroll lifecycle ---------------- */

export const calculatePayrollFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => calcInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.calculatePayrollForEmployee(user, data.userId, data.month, requestInfo());
  });

export const approvePayrollFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => approveInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.approvePayroll(user, data.userId, data.month, requestInfo());
  });

export const lockPayrollFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => lockInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.lockPayroll(user, data.userId, data.month, requestInfo());
  });

export const reopenPayrollFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => reopenInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.reopenPayroll(user, data.userId, data.month, data.reason, requestInfo());
  });

/* ------------------------------ reads ------------------------- */

export const adminPayrollFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => adminListInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.listPayroll(user, data);
  });

export const myPayrollFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => myInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.myPayroll(user, data.month);
  });

/* ============ Phase 16 — payroll input foundations ============ *
 * The client submits only identifiers + HR-typed configuration values
 * (a base salary, an employment date, overtime minutes, or an explicit
 * labelled adjustment amount). It never submits a calculated payroll
 * figure, a proration result, a deduction the engine would compute, or
 * an approval identity.                                               */

const employmentPeriodInput = z.object({
  userId,
  startDate: ymd,
  endDate: ymd.nullable().optional(),
  note: z.string().trim().max(255).optional(),
});
const overtimeInput = z.object({
  userId,
  workDate: ymd,
  overtimeMinutes: z.coerce.number().int().min(0).max(1440),
  scheduledShiftStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  scheduledShiftEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  reason: z.string().trim().max(255).optional(),
});
const overtimeDecisionInput = z.object({
  overtimeId: userId,
  decision: z.enum(["APPROVED", "REJECTED", "VOID"]),
});
const adjustmentInput = z.object({
  userId,
  month,
  kind: z.enum(["EARNING", "DEDUCTION"]),
  label: z.string().trim().min(1).max(120),
  amount: z.coerce.number().finite().min(0).max(100_000_000),
  reason: z.string().trim().max(255).optional(),
});
const breakdownInput = z.object({ userId, month });

export const setEmploymentPeriodFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => employmentPeriodInput.parse(d))
  .handler(async ({ data }): Promise<{ id: number }> => {
    const user = await requireUser();
    const { userId: target, ...rest } = data;
    return svc.setEmploymentPeriod(user, target, rest, requestInfo());
  });

export const employmentPeriodsFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ userId }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.listEmploymentPeriods(user, data.userId);
  });

export const recordOvertimeFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => overtimeInput.parse(d))
  .handler(async ({ data }): Promise<{ id: number }> => {
    const user = await requireUser();
    return svc.recordOvertime(user, data, requestInfo());
  });

export const decideOvertimeFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => overtimeDecisionInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const user = await requireUser();
    return svc.decideOvertime(user, data.overtimeId, data.decision, requestInfo());
  });

export const adminOvertimeFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({
        month: month.optional(),
        status: z.enum(["PENDING", "APPROVED", "REJECTED", "VOID"]).optional(),
      })
      .partial()
      .default({})
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.listOvertime(user, data);
  });

export const myOvertimeFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => myInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.myOvertime(user, data.month);
  });

export const addAdjustmentFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => adjustmentInput.parse(d))
  .handler(async ({ data }): Promise<{ id: number }> => {
    const user = await requireUser();
    return svc.addPayrollAdjustment(user, data, requestInfo());
  });

export const voidAdjustmentFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ adjustmentId: userId }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const user = await requireUser();
    return svc.voidPayrollAdjustment(user, data.adjustmentId, requestInfo());
  });

export const payrollBreakdownFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => breakdownInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.payrollBreakdown(user, data.userId, data.month);
  });
