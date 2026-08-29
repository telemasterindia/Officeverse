/**
 * Officeverse — email job (outbox) service (Phase 5).
 *
 * The reliable persistence + safe-claim FOUNDATION for the future cPanel-cron
 * email worker. This phase:
 *   - does NOT send email (no provider is configured — see ./provider.ts)
 *   - does NOT run a worker or any timer
 *   - only enqueues jobs, and exposes the claim/finish primitives a worker
 *     will call later.
 *
 * There is NO server function that enqueues email. Enqueueing is internal:
 * business-event integration and (later) the scheduler call `enqueueEmail`.
 */
import {
  claimState,
  computeStaleBefore,
  nextRetryPlan,
  DEFAULT_LEASE_MINUTES,
} from "./claim-logic";
import { renderEmailTemplate, type EmailTemplateId } from "./templates";
import { nowIST } from "../time";
import * as repo from "../db/repos/email-jobs";
import type { EmailJob, NewEmailJob } from "@/lib/db/schema";

export interface EnqueueEmailInput {
  template: EmailTemplateId;
  toEmail: string;
  toName?: string | null;
  toUserId?: number | null;
  /** overrides the template-rendered subject when provided */
  subject?: string | null;
  payload?: Record<string, unknown>;
  relatedEntityType?: string | null;
  relatedEntityId?: number | null;
  relatedEntityCode?: string | null;
  /** REQUIRED business-event idempotency key (…:email) */
  dedupeKey: string;
  /** do not send before this IST wall-clock instant */
  scheduledFor?: string | null;
  maxRetries?: number;
}

function toRow(input: EnqueueEmailInput, now: string): NewEmailJob {
  const rendered = renderEmailTemplate(input.template, input.payload ?? {});
  return {
    kind: input.template,
    toEmail: input.toEmail.trim().toLowerCase().slice(0, 191),
    toName: input.toName ?? null,
    toUserId: input.toUserId ?? null,
    subject: (input.subject?.trim() || rendered.subject).slice(0, 500),
    bodyText: rendered.text,
    bodyHtml: rendered.html,
    payload: (input.payload ?? null) as NewEmailJob["payload"],
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
    dedupeKey: input.dedupeKey.trim().slice(0, 191),
    status: "queued",
    retryCount: 0,
    ...(input.maxRetries != null ? { maxRetries: input.maxRetries } : {}),
    nextAttemptAt: input.scheduledFor ?? now,
    scheduledFor: input.scheduledFor ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Enqueue one email job. A repeated `dedupeKey` is a no-op. */
export async function enqueueEmail(
  input: EnqueueEmailInput,
): Promise<{ id: number; created: boolean }> {
  const { row, created } = await repo.enqueue(toRow(input, nowIST()));
  return { id: row.id, created };
}

/** Batch enqueue; DB-level dedupe skips keys that already exist. */
export async function enqueueEmails(
  inputs: EnqueueEmailInput[],
): Promise<{ requested: number; inserted: number }> {
  if (!inputs.length) return { requested: 0, inserted: 0 };
  const now = nowIST();
  const inserted = await repo.bulkEnqueue(inputs.map((i) => toRow(i, now)));
  return { requested: inputs.length, inserted };
}

/* --------------------- worker-facing primitives -------------------- *
 * Used by the FUTURE email worker (Phase 15/16). Included now so the
 * data model is proven end-to-end and unit-testable.
 * ----------------------------------------------------------------- */

export async function getPendingEmailJobs(limit = 50): Promise<EmailJob[]> {
  return repo.listPending({ nowWall: nowIST(), limit });
}

/**
 * Claim the next available job for `workerId`. Returns the claimed row (now
 * `processing`, one attempt consumed) or null when nothing is claimable.
 * Safe against concurrent workers — the claim is a conditional UPDATE.
 */
export async function claimEmailJob(
  workerId: string,
  leaseMinutes = DEFAULT_LEASE_MINUTES,
): Promise<EmailJob | null> {
  const now = nowIST();
  const staleBefore = computeStaleBefore(now, leaseMinutes);
  for (let tries = 0; tries < 5; tries++) {
    const id = await repo.pickClaimCandidateId({ nowWall: now, staleBeforeWall: staleBefore });
    if (id == null) return null;
    const won = await repo.claimById(id, workerId, now, staleBefore);
    if (won === 1) return (await repo.getEmailJobById(id)) ?? null;
    // lost the race for this id — try the next candidate
  }
  return null;
}

export async function markEmailSent(
  id: number,
  workerId: string,
  opts: { provider?: string | null; providerMessageId?: string | null } = {},
): Promise<{ updated: number }> {
  return { updated: await repo.markSent(id, workerId, nowIST(), opts) };
}

/**
 * Record a failed delivery attempt. The job goes back to `queued` with a
 * back-off `next_attempt_at`, or becomes terminal `failed` once `retry_count`
 * (already incremented at claim time) reaches `max_retries`. Never deleted.
 */
export async function markEmailFailed(
  job: Pick<EmailJob, "id" | "retryCount" | "maxRetries">,
  workerId: string,
  errorMessage: string,
  overrideBackoffMinutes?: number,
): Promise<{ updated: number; plan: ReturnType<typeof nextRetryPlan> }> {
  const now = nowIST();
  const plan = nextRetryPlan(job.retryCount, job.maxRetries, now, overrideBackoffMinutes);
  const updated = await repo.markFailed(job.id, workerId, now, errorMessage, {
    status: plan.status,
    nextAttemptAt: plan.nextAttemptAt,
  });
  return { updated, plan };
}

/** Release every job whose lease has expired (worker crash recovery). */
export async function recoverStaleEmailJobs(
  leaseMinutes = DEFAULT_LEASE_MINUTES,
): Promise<{ recovered: number }> {
  const now = nowIST();
  return {
    recovered: await repo.recoverStale(computeStaleBefore(now, leaseMinutes), now),
  };
}

/** Manually re-queue a terminal `failed` job. */
export async function retryEmailJob(id: number): Promise<{ updated: number }> {
  return { updated: await repo.retryFailed(id, nowIST()) };
}

export async function emailJobCounts() {
  return repo.countByStatus();
}

/** Re-export so callers/tests can reason about a row without touching SQL. */
export { claimState };
