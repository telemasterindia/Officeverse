/**
 * Officeverse — client-callable salary-slip server functions (Phase 14).
 *
 * Outside `src/server/**` — the PDF renderer, email provider and document store
 * never reach the client bundle. Every handler derives identity + role from the
 * session. The client submits only an identifier: it can NEVER supply a salary
 * amount, bonus, calculated salary, employee identity, payroll status, leave
 * or Off count, or a destination address — the server resolves all of that from
 * the authoritative payroll_run + users record.
 *
 *   POST  generateSalarySlipFn  → Admin/HR, { payrollRunId }
 *   POST  sendSalarySlipFn      → Admin/HR, { salarySlipId } (address from users record)
 *   GET   adminSalarySlipsFn    → Admin/HR list, filterable
 *   GET   salarySlipHistoryFn   → Admin/HR send history for one slip
 *   GET   mySalarySlipsFn       → caller's own slips only
 *   POST  downloadSalarySlipFn  → own slip, or any slip for Admin/HR
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/hr/salary-slip-service";

const id = z.coerce.number().int().positive();
const month = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM");
const slipStatus = z.enum(["GENERATED", "SENT", "FAILED"]);

const generateInput = z.object({
  payrollRunId: id,
  // opt-in, non-final preview from a CALCULATED payroll — clearly marked
  allowPreview: z.coerce.boolean().optional(),
});
const sendInput = z.object({ salarySlipId: id });
const downloadInput = z.object({ salarySlipId: id });
const historyInput = z.object({ salarySlipId: id });

const adminListInput = z
  .object({
    month: month.optional(),
    employee: z.string().trim().max(191).optional(),
    status: slipStatus.optional(),
  })
  .partial()
  .default({});

const myInput = z.object({ month: month.optional() }).partial().default({});

export const generateSalarySlipFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => generateInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.generateSalarySlip(
      user,
      { payrollRunId: data.payrollRunId, allowPreview: data.allowPreview },
      requestInfo(),
    );
  });

export const sendSalarySlipFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => sendInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.sendSalarySlip(user, { salarySlipId: data.salarySlipId }, requestInfo());
  });

export const adminSalarySlipsFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => adminListInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.listSalarySlips(user, data);
  });

export const salarySlipHistoryFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => historyInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.salarySlipHistory(user, data.salarySlipId);
  });

export const mySalarySlipsFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => myInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.mySalarySlips(user, data.month);
  });

export const downloadSalarySlipFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => downloadInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.downloadSalarySlip(user, data.salarySlipId, requestInfo());
  });
