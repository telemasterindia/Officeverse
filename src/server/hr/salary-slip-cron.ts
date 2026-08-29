/**
 * Officeverse — authenticated cron entry point for monthly salary-slip delivery
 * (Phase 15).
 *
 * A future GoDaddy / cPanel cron job invokes this with a shared secret
 * (`OFFICEVERSE_CRON_SECRET`). There is NO unauthenticated public trigger. The
 * secret is compared with a constant-time check and never echoed back.
 *
 * Nothing here requires a developer machine to be online — the cron runs on the
 * production host. This module is server-only.
 */
import { timingSafeEqual } from "node:crypto";
import { env } from "../env";
import { HttpError } from "../http-error";
import { addDaysYMD, calendarTodayIST } from "../time";
import { processMonthlySalarySlips, type MonthlyDeliverySummary } from "./salary-slip-batch";

/** Previous calendar month ("YYYY-MM") in IST — the default target. */
export function previousPayrollMonthIST(today: string = calendarTodayIST()): string {
  const firstOfThisMonth = `${today.slice(0, 7)}-01`;
  const lastOfPrev = addDaysYMD(firstOfThisMonth, -1);
  return lastOfPrev.slice(0, 7);
}

/** Constant-time secret comparison that also tolerates length differences. */
export function safeSecretEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // still run a compare to avoid an early-exit timing signal
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export interface CronInput {
  cronSecret: string;
  /** optional explicit month; defaults to the previous calendar month */
  month?: string | undefined;
  /** where the invocation came from, for the audit trail */
  source?: string | undefined;
}

export async function runSalarySlipCron(input: CronInput): Promise<MonthlyDeliverySummary> {
  const expected = env("OFFICEVERSE_CRON_SECRET");
  if (!expected) {
    throw new HttpError(503, "Salary-slip cron is not configured", "cron_not_configured");
  }
  if (typeof input.cronSecret !== "string" || !safeSecretEqual(input.cronSecret, expected)) {
    throw new HttpError(401, "Invalid cron credentials", "cron_forbidden");
  }

  const month =
    input.month && /^\d{4}-\d{2}$/.test(input.month) ? input.month : previousPayrollMonthIST();

  return processMonthlySalarySlips(
    { id: null, role: "system" },
    { month, dryRun: false },
    { source: input.source ?? "cron" },
  );
}
