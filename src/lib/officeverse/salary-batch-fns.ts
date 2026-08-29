/**
 * Officeverse — client-callable monthly salary-slip delivery functions
 * (Phase 15).
 *
 * Outside `src/server/**`. The batch service, email provider, PDF renderer and
 * document store never reach the client bundle.
 *
 *   POST  monthlyDeliveryPreviewFn  → Admin/HR, dry run (no email sent)
 *   POST  runMonthlyDeliveryFn      → Admin/HR, real run (explicit action)
 *   POST  cronRunMonthlyDeliveryFn  → server-to-server, shared-secret only
 *
 * The client submits only { month, process? } (and the cron secret for the
 * cron endpoint). No salary, bonus, delivery address, status, document key or
 * provider credential is ever accepted from the client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import { assertCanManagePayroll, type HrRole } from "@/server/authz/hr";
import { processMonthlySalarySlips } from "@/server/hr/salary-slip-batch";
import { runSalarySlipCron } from "@/server/hr/salary-slip-cron";

const month = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM");
const processCode = z.enum(["US", "UK", "IN", "AU"]);

const runInput = z.object({ month, process: processCode.optional() });
const cronInput = z.object({
  secret: z.string().min(1).max(512),
  month: month.optional(),
});

export const monthlyDeliveryPreviewFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => runInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    assertCanManagePayroll(user.role as HrRole);
    return processMonthlySalarySlips(
      { id: user.id, role: user.role },
      { month: data.month, dryRun: true, process: data.process },
      { ...requestInfo(), source: "admin_ui" },
    );
  });

export const runMonthlyDeliveryFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => runInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    assertCanManagePayroll(user.role as HrRole);
    return processMonthlySalarySlips(
      { id: user.id, role: user.role },
      { month: data.month, dryRun: false, process: data.process },
      { ...requestInfo(), source: "admin_ui" },
    );
  });

/**
 * Server-to-server cron trigger. Deliberately does NOT call requireUser — it is
 * authenticated by the shared `OFFICEVERSE_CRON_SECRET` only. Missing / invalid
 * secret is rejected with a generic error and no detail.
 */
export const cronRunMonthlyDeliveryFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => cronInput.parse(d))
  .handler(async ({ data }) => {
    return runSalarySlipCron({
      cronSecret: data.secret,
      month: data.month,
      source: "http_cron",
    });
  });
