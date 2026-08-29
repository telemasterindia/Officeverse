/**
 * Officeverse — monthly salary-slip delivery orchestration (Phase 15).
 *
 * Processes the LOCKED payroll runs for one calendar month: generates the final
 * salary slip if the snapshot changed / none exists (reusing Phase-14
 * versioning + idempotency), then emails it to the AUTHORITATIVE users.email
 * through the configured provider.
 *
 * Rules:
 *   - only LOCKED payroll runs are ever emailed (DRAFT / CALCULATED / APPROVED
 *     are skipped)
 *   - a slip already SENT is NOT auto-sent again → ALREADY_SENT
 *   - a slip in FAILED status is retried, reusing the SAME document; every
 *     attempt gets its own salary_slip_sends row
 *   - one employee's failure never stops the batch or rolls back other sends
 *   - bounded processing in chunks; no single transaction around the batch
 *   - never sends to a client-supplied address
 */
import { isDbConfigured } from "@/lib/db";
import { recordAudit, type AuditActorRole } from "../audit";
import { HttpError } from "../http-error";
import { canRunSalaryBatch } from "../authz/hr";
import { getUserById } from "../db/repos/users";
import * as payrollRepo from "../db/repos/payroll";
import * as slipRepo from "../db/repos/salary-slip";
import { buildSlipSnapshot, slipSnapshotEquals } from "./salary-slip";
import { generateSlipForRun, sendSlipById, type SlipActorCtx } from "./salary-slip-service";
import type { PayrollRun } from "@/lib/db/schema";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BATCH_CHUNK = 25;

export interface BatchActor {
  id: number | null;
  role: AuditActorRole;
}

export interface MonthlyDeliveryOptions {
  month: string; // "YYYY-MM"
  dryRun: boolean;
  process?: string | undefined;
}

export interface MonthlyDeliveryFailure {
  userId: number;
  salarySlipId?: number;
  reason: string;
}

export interface MonthlyDeliverySummary {
  month: string;
  process: string | null;
  dryRun: boolean;
  totalPayrollRuns: number;
  skippedNonLocked: number;
  lockedEligible: number;
  missingEmail: number;
  generated: number;
  alreadyGenerated: number;
  wouldGenerate: number;
  sent: number;
  alreadySent: number;
  wouldSend: number;
  failed: number;
  failures: MonthlyDeliveryFailure[];
}

function emptySummary(o: MonthlyDeliveryOptions): MonthlyDeliverySummary {
  return {
    month: o.month,
    process: o.process ?? null,
    dryRun: o.dryRun,
    totalPayrollRuns: 0,
    skippedNonLocked: 0,
    lockedEligible: 0,
    missingEmail: 0,
    generated: 0,
    alreadyGenerated: 0,
    wouldGenerate: 0,
    sent: 0,
    alreadySent: 0,
    wouldSend: 0,
    failed: 0,
    failures: [],
  };
}

export interface LatestSlipLike {
  process: string;
  baseSalary: string;
  regularityBonus: number;
  calculatedSalary: string;
  leaveCount: number;
  offCount: number;
  calculationVersion: string;
  payrollStatusAtGeneration: string;
  isPreview: boolean;
  status: string;
}
export interface RunLike {
  process: string;
  status: string;
  baseSalary: string;
  regularityBonus: number;
  calculatedSalary: string;
  leaveCount: number;
  offCount: number;
  calculationVersion: string;
}

/** true when the latest slip already matches the LOCKED run's figures (and is
 *  not a preview) — i.e. no regeneration is needed. PURE. */
export function snapshotUnchanged(latest: LatestSlipLike, run: RunLike): boolean {
  if (latest.isPreview) return false;
  return slipSnapshotEquals(
    buildSlipSnapshot({ ...latest, status: latest.payrollStatusAtGeneration }),
    buildSlipSnapshot(run),
  );
}

export type DeliveryDisposition =
  "GENERATE_AND_SEND" | "REUSE_AND_SEND" | "ALREADY_SENT" | "GENERATE_NO_EMAIL" | "REUSE_NO_EMAIL";

/**
 * Decide what the monthly batch should do for one LOCKED payroll run. PURE.
 *   - no slip / changed figures / preview → must regenerate
 *   - slip already SENT + unchanged      → ALREADY_SENT (never auto-resend)
 *   - slip GENERATED / FAILED            → (re)send, reusing the same document
 *   - missing email                      → generate only, cannot send
 */
export function deliveryDisposition(
  latest: LatestSlipLike | null | undefined,
  run: RunLike,
  hasEmail: boolean,
): DeliveryDisposition {
  const needGen = !latest || !snapshotUnchanged(latest, run);
  if (!hasEmail) return needGen ? "GENERATE_NO_EMAIL" : "REUSE_NO_EMAIL";
  if (needGen) return "GENERATE_AND_SEND";
  if (latest && latest.status === "SENT") return "ALREADY_SENT";
  return "REUSE_AND_SEND";
}

async function processOneRun(
  ctx: SlipActorCtx,
  run: PayrollRun,
  dryRun: boolean,
  summary: MonthlyDeliverySummary,
): Promise<void> {
  const emp = await getUserById(run.userId);
  const email = emp?.email?.trim().toLowerCase() ?? "";
  const hasEmail = Boolean(emp) && EMAIL_RE.test(email);

  const latest = await slipRepo.latestSalarySlipForRun(run.id);
  const disposition = deliveryDisposition(latest, run, hasEmail);
  const needGen = disposition === "GENERATE_AND_SEND" || disposition === "GENERATE_NO_EMAIL";

  if (dryRun) {
    if (needGen) summary.wouldGenerate += 1;
    else summary.alreadyGenerated += 1;
    if (disposition === "GENERATE_NO_EMAIL" || disposition === "REUSE_NO_EMAIL") {
      summary.missingEmail += 1;
      return;
    }
    if (disposition === "ALREADY_SENT") summary.alreadySent += 1;
    else summary.wouldSend += 1;
    return;
  }

  // real run — generate the document even if we cannot email it
  let slipId: number;
  let slipStatus: string;
  if (needGen) {
    const g = await generateSlipForRun(ctx, { payrollRunId: run.id }, {});
    summary.generated += 1;
    slipId = g.slip.id;
    slipStatus = g.slip.status;
  } else {
    summary.alreadyGenerated += 1;
    slipId = latest!.id;
    slipStatus = latest!.status;
  }

  if (!hasEmail) {
    summary.missingEmail += 1;
    summary.failures.push({
      userId: run.userId,
      salarySlipId: slipId,
      reason: "no_recipient_email",
    });
    return;
  }

  if (slipStatus === "SENT") {
    summary.alreadySent += 1;
    return;
  }

  const res = await sendSlipById(ctx, { salarySlipId: slipId, auto: true }, {});
  if (res.status === "SENT") {
    summary.sent += 1;
    return;
  }
  summary.failed += 1;
  summary.failures.push({
    userId: run.userId,
    salarySlipId: slipId,
    reason:
      res.status === "NO_PROVIDER"
        ? "no_email_provider"
        : res.status === "NO_RECIPIENT"
          ? "no_recipient_email"
          : (res.error ?? "send_failed"),
  });
}

export async function processMonthlySalarySlips(
  actor: BatchActor,
  opts: MonthlyDeliveryOptions,
  meta: { ip?: string | null; userAgent?: string | null; source?: string | null } = {},
): Promise<MonthlyDeliverySummary> {
  if (!/^\d{4}-\d{2}$/.test(opts.month)) {
    throw new HttpError(400, "month must be YYYY-MM", "bad_month");
  }
  if (!canRunSalaryBatch(actor.role)) {
    throw new HttpError(403, "Only Admin / HR may run salary-slip delivery", "forbidden");
  }
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");

  const ctx: SlipActorCtx = { actorUserId: actor.id, actorRole: actor.role };
  const summary = emptySummary(opts);

  const allRuns = await payrollRepo.listPayrollRuns({
    month: opts.month,
    ...(opts.process ? { process: opts.process } : {}),
  });
  const locked = allRuns.filter((r) => r.status === "LOCKED");
  summary.totalPayrollRuns = allRuns.length;
  summary.skippedNonLocked = allRuns.length - locked.length;
  summary.lockedEligible = locked.length;

  for (let i = 0; i < locked.length; i += BATCH_CHUNK) {
    const chunk = locked.slice(i, i + BATCH_CHUNK);
    for (const run of chunk) {
      try {
        // one row per employee — never a giant transaction, never a rollback
        await processOneRun(ctx, run, opts.dryRun, summary);
      } catch (err) {
        summary.failed += 1;
        summary.failures.push({
          userId: run.userId,
          reason: err instanceof Error ? err.message.slice(0, 200) : "unknown error",
        });
      }
    }
  }

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: opts.dryRun ? "salary_slip.batch_preview" : "salary_slip.batch_process",
    entityType: "payroll_month",
    entityCode: opts.month,
    metadata: {
      month: opts.month,
      process: opts.process ?? null,
      source: meta.source ?? "admin_ui",
      totalPayrollRuns: summary.totalPayrollRuns,
      skippedNonLocked: summary.skippedNonLocked,
      lockedEligible: summary.lockedEligible,
      missingEmail: summary.missingEmail,
      generated: summary.generated,
      alreadyGenerated: summary.alreadyGenerated,
      wouldGenerate: summary.wouldGenerate,
      sent: summary.sent,
      alreadySent: summary.alreadySent,
      wouldSend: summary.wouldSend,
      failed: summary.failed,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return summary;
}
