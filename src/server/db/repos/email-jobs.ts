/**
 * Officeverse — email job (outbox) repository (Phase 5). DATA ACCESS ONLY.
 *
 * This is the persistence + safe-claim foundation for the FUTURE cPanel-cron
 * email worker. Phase 5 does NOT run a worker and does NOT send mail.
 *
 * Concurrency: there is no long-running lock. Claiming is a CONDITIONAL UPDATE
 * whose WHERE clause encodes the rules in ../../email/claim-logic.ts — two
 * workers racing for the same row means exactly one gets `affectedRows = 1`.
 * A `processing` row whose `locked_at` is older than the lease is reclaimable
 * (crash recovery).
 *
 * `email_jobs_dedupe_uq` (UNIQUE on `dedupe_key`, NOT NULL) guarantees one
 * business event never queues two emails.
 */
import { and, asc, eq, lte, or, sql, isNull, type SQL } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import { emailJobs, type EmailJob, type NewEmailJob } from "@/lib/db/schema";

function rowsAffected(res: unknown): number {
  const head = Array.isArray(res) ? res[0] : res;
  return Number((head as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

function isDuplicateKey(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /duplicate entry|er_dup_entry|dedupe_uq/i.test(m);
}

/* -------------------------------- reads ------------------------------- */

export async function getEmailJobById(
  id: number,
  ex: DBX = getDb(),
): Promise<EmailJob | undefined> {
  const rows = await ex.select().from(emailJobs).where(eq(emailJobs.id, id)).limit(1);
  return rows[0];
}

export async function getEmailJobByDedupeKey(
  key: string,
  ex: DBX = getDb(),
): Promise<EmailJob | undefined> {
  const rows = await ex.select().from(emailJobs).where(eq(emailJobs.dedupeKey, key)).limit(1);
  return rows[0];
}

/** `queued` jobs whose back-off has elapsed and whose hold time (if any) passed. */
export async function listPending(
  opts: { nowWall: string; limit: number },
  ex: DBX = getDb(),
): Promise<EmailJob[]> {
  return ex
    .select()
    .from(emailJobs)
    .where(
      and(
        eq(emailJobs.status, "queued"),
        lte(emailJobs.nextAttemptAt, opts.nowWall),
        or(isNull(emailJobs.scheduledFor), lte(emailJobs.scheduledFor, opts.nowWall)) as SQL,
      ),
    )
    .orderBy(asc(emailJobs.nextAttemptAt), asc(emailJobs.id))
    .limit(opts.limit);
}

/** First job a worker could claim: due `queued` OR a stale `processing` lock. */
export async function pickClaimCandidateId(
  opts: { nowWall: string; staleBeforeWall: string },
  ex: DBX = getDb(),
): Promise<number | undefined> {
  const dueQueued = and(
    eq(emailJobs.status, "queued"),
    lte(emailJobs.nextAttemptAt, opts.nowWall),
    or(isNull(emailJobs.scheduledFor), lte(emailJobs.scheduledFor, opts.nowWall)) as SQL,
  ) as SQL;
  const staleProcessing = and(
    eq(emailJobs.status, "processing"),
    or(isNull(emailJobs.lockedAt), lte(emailJobs.lockedAt, opts.staleBeforeWall)) as SQL,
  ) as SQL;
  const rows = await ex
    .select({ id: emailJobs.id })
    .from(emailJobs)
    .where(or(dueQueued, staleProcessing))
    .orderBy(asc(emailJobs.nextAttemptAt), asc(emailJobs.id))
    .limit(1);
  return rows[0]?.id;
}

/* ------------------------------- writes ----------------------------- */

/**
 * Enqueue one job. If `dedupe_key` already exists this is a no-op and the
 * existing row is returned with `created: false`.
 */
export async function enqueue(
  values: NewEmailJob,
  ex: DBX = getDb(),
): Promise<{ row: EmailJob; created: boolean }> {
  const existing = await getEmailJobByDedupeKey(values.dedupeKey, ex);
  if (existing) return { row: existing, created: false };
  try {
    const res = await ex.insert(emailJobs).values(values);
    const insertId = Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
    const row = insertId
      ? await getEmailJobById(insertId, ex)
      : await getEmailJobByDedupeKey(values.dedupeKey, ex);
    if (!row) throw new Error("Email job insert did not return a row");
    return { row, created: true };
  } catch (err) {
    if (isDuplicateKey(err)) {
      const row = await getEmailJobByDedupeKey(values.dedupeKey, ex);
      if (row) return { row, created: false };
    }
    throw err;
  }
}

/** Batch enqueue; DB-level dedupe skips rows whose key already exists. */
export async function bulkEnqueue(rows: NewEmailJob[], ex: DBX = getDb()): Promise<number> {
  if (!rows.length) return 0;
  const res = await ex
    .insert(emailJobs)
    .values(rows)
    .onDuplicateKeyUpdate({ set: { dedupeKey: sql`${emailJobs.dedupeKey}` } });
  return rowsAffected(res);
}

/**
 * Atomically claim job `id` for `workerId`. Succeeds (returns 1) only if the row
 * is still a due `queued` job or a `processing` job with a stale/absent lock.
 * Consumes one attempt (`retry_count += 1`).
 */
export async function claimById(
  id: number,
  workerId: string,
  nowWall: string,
  staleBeforeWall: string,
  ex: DBX = getDb(),
): Promise<number> {
  const claimable = or(
    and(eq(emailJobs.status, "queued"), lte(emailJobs.nextAttemptAt, nowWall)),
    and(
      eq(emailJobs.status, "processing"),
      or(isNull(emailJobs.lockedAt), lte(emailJobs.lockedAt, staleBeforeWall)) as SQL,
    ),
  ) as SQL;
  const res = await ex
    .update(emailJobs)
    .set({
      status: "processing",
      lockedAt: nowWall,
      lockedBy: workerId,
      retryCount: sql`${emailJobs.retryCount} + 1`,
      updatedAt: nowWall,
    })
    .where(and(eq(emailJobs.id, id), claimable));
  return rowsAffected(res);
}

/** Finalise a successful send. Only the claiming worker (locked_by) may do this. */
export async function markSent(
  id: number,
  workerId: string,
  nowWall: string,
  opts: { provider?: string | null; providerMessageId?: string | null } = {},
  ex: DBX = getDb(),
): Promise<number> {
  const res = await ex
    .update(emailJobs)
    .set({
      status: "sent",
      sentAt: nowWall,
      provider: opts.provider ?? null,
      providerMessageId: opts.providerMessageId ?? null,
      errorMessage: null,
      lockedAt: null,
      lockedBy: null,
      updatedAt: nowWall,
    })
    .where(
      and(
        eq(emailJobs.id, id),
        eq(emailJobs.status, "processing"),
        eq(emailJobs.lockedBy, workerId),
      ),
    );
  return rowsAffected(res);
}

/**
 * Record a failed attempt. `plan` comes from
 * ../../email/claim-logic.ts#nextRetryPlan — either back to `queued` with a
 * future `next_attempt_at`, or terminal `failed` when retries are exhausted.
 * The row is NEVER deleted. Only the claiming worker may do this.
 */
export async function markFailed(
  id: number,
  workerId: string,
  nowWall: string,
  errorMessage: string,
  plan: { status: "queued" | "failed"; nextAttemptAt: string },
  ex: DBX = getDb(),
): Promise<number> {
  const res = await ex
    .update(emailJobs)
    .set({
      status: plan.status,
      nextAttemptAt: plan.nextAttemptAt,
      errorMessage: errorMessage.slice(0, 1000),
      failedAt: nowWall,
      lockedAt: null,
      lockedBy: null,
      updatedAt: nowWall,
    })
    .where(
      and(
        eq(emailJobs.id, id),
        eq(emailJobs.status, "processing"),
        eq(emailJobs.lockedBy, workerId),
      ),
    );
  return rowsAffected(res);
}

/** Release every `processing` job whose lease has expired. Returns the count. */
export async function recoverStale(
  staleBeforeWall: string,
  nowWall: string,
  ex: DBX = getDb(),
): Promise<number> {
  const res = await ex
    .update(emailJobs)
    .set({ status: "queued", lockedAt: null, lockedBy: null, updatedAt: nowWall })
    .where(
      and(
        eq(emailJobs.status, "processing"),
        or(isNull(emailJobs.lockedAt), lte(emailJobs.lockedAt, staleBeforeWall)) as SQL,
      ),
    );
  return rowsAffected(res);
}

/** Manually re-queue a terminal `failed` job (admin tooling / future phase). */
export async function retryFailed(id: number, nowWall: string, ex: DBX = getDb()): Promise<number> {
  const res = await ex
    .update(emailJobs)
    .set({
      status: "queued",
      nextAttemptAt: nowWall,
      errorMessage: null,
      lockedAt: null,
      lockedBy: null,
      updatedAt: nowWall,
    })
    .where(and(eq(emailJobs.id, id), eq(emailJobs.status, "failed")));
  return rowsAffected(res);
}

/** Aggregate counts per status (reporting). */
export async function countByStatus(
  ex: DBX = getDb(),
): Promise<Record<EmailJob["status"], number>> {
  const rows = await ex
    .select({ status: emailJobs.status, n: sql<number>`count(*)` })
    .from(emailJobs)
    .groupBy(emailJobs.status);
  const out: Record<EmailJob["status"], number> = {
    queued: 0,
    processing: 0,
    sent: 0,
    failed: 0,
  };
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}
