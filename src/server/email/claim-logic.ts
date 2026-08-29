/**
 * Officeverse — email job claim / lease / retry decision logic (Phase 5).
 *
 * PURE functions. No DB. The repository SQL (db/repos/email-jobs.ts) mirrors
 * these exact rules in conditional UPDATE statements so two concurrent cPanel
 * cron workers can never send the same email:
 *
 *   queued & next_attempt_at <= now                    → claimable
 *   processing & locked_at <= (now - lease)            → claimable (stale recovery)
 *   processing & locked_at newer than that             → locked (another worker)
 *   sent | failed                                      → not claimable
 *
 * On CLAIM the worker sets status=processing, locked_at=now, locked_by=worker,
 * retry_count = retry_count + 1 (an attempt is consumed even if the worker then
 * dies). On a delivery failure the job returns to `queued` with a back-off
 * next_attempt_at, UNLESS retry_count >= max_retries, in which case it becomes
 * terminal `failed` (never deleted — auditable).
 */
import { istWallClockToEpochMs, nowIST } from "../time";

export const DEFAULT_LEASE_MINUTES = 10;
export const DEFAULT_MAX_RETRIES = 5;

export type ClaimState = "claimable" | "locked" | "done" | "not_due";

export interface ClaimableJob {
  status: "queued" | "processing" | "sent" | "failed";
  nextAttemptAt: string;
  lockedAt: string | null;
}

/** Instant (IST wall-clock) before which a `processing` lock counts as stale. */
export function computeStaleBefore(
  nowWall: string = nowIST(),
  leaseMinutes: number = DEFAULT_LEASE_MINUTES,
): string {
  const ms = istWallClockToEpochMs(nowWall) - leaseMinutes * 60_000;
  return epochToWall(ms);
}

/** Is a `processing` lock older than the lease (or missing) → recoverable? */
export function isStaleLock(
  lockedAt: string | null,
  staleBeforeWall: string = computeStaleBefore(),
): boolean {
  if (!lockedAt) return true;
  return istWallClockToEpochMs(lockedAt) <= istWallClockToEpochMs(staleBeforeWall);
}

/** What a worker may do with this job right now. */
export function claimState(
  job: ClaimableJob,
  nowWall: string = nowIST(),
  staleBeforeWall: string = computeStaleBefore(nowWall),
): ClaimState {
  if (job.status === "sent" || job.status === "failed") return "done";
  if (job.status === "processing") {
    return isStaleLock(job.lockedAt, staleBeforeWall) ? "claimable" : "locked";
  }
  // queued
  if (istWallClockToEpochMs(job.nextAttemptAt) > istWallClockToEpochMs(nowWall)) {
    return "not_due";
  }
  return "claimable";
}

/** Exponential-ish back-off in minutes for the Nth attempt (capped at 60). */
export function backoffMinutes(retryCount: number): number {
  const n = Math.max(0, Math.trunc(retryCount));
  return Math.min(60, 2 ** n);
}

export interface RetryPlan {
  status: "queued" | "failed";
  nextAttemptAt: string;
  giveUp: boolean;
}

/**
 * Decide what happens after a failed delivery attempt. `retryCount` is the
 * value AFTER the claim increment (i.e. attempts consumed so far).
 */
export function nextRetryPlan(
  retryCount: number,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  nowWall: string = nowIST(),
  overrideBackoffMinutes?: number,
): RetryPlan {
  if (retryCount >= maxRetries) {
    return { status: "failed", nextAttemptAt: nowWall, giveUp: true };
  }
  const mins = overrideBackoffMinutes ?? backoffMinutes(retryCount);
  const ms = istWallClockToEpochMs(nowWall) + mins * 60_000;
  return { status: "queued", nextAttemptAt: epochToWall(ms), giveUp: false };
}

function epochToWall(ms: number): string {
  // Reuse the canonical formatter: nowIST accepts an instant.
  return nowIST(ms).slice(0, 19);
}
