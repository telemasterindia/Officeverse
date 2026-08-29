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
