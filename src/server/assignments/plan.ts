/**
 * Officeverse — Assignment Control: bulk-reassignment planner (Phase 22). PURE.
 *
 * The SERVER decides the final set. The client only sends a selection (explicit
 * ids, or the "ALL" sentinel meaning "every currently-eligible record for this
 * owner"). This planner takes the server-recomputed eligible set and the
 * request, and returns exactly which records to move and why the rest were
 * skipped — so stale UI state, archived records, or records already on the
 * target can never be silently mis-assigned.
 */

export const SELECT_ALL = "ALL" as const;
export type Selection = number[] | typeof SELECT_ALL;

export interface EligibleRecord {
  id: number;
  /** current owner id in the dimension being reassigned (agent id / closer id / user id) */
  currentOwnerId: number;
}

export type SkipReason =
  | "same_owner" // from === to for the whole operation
  | "already_target" // record already owned by the destination
  | "not_eligible" // not in the server's eligible set (wrong status / archived / not this owner)
  | "not_owned"; // requested id does not belong to the stated current owner

export interface ReassignPlan {
  requested: number;
  toApply: number[];
  skipped: { id: number; reason: SkipReason }[];
}

export interface PlanInput {
  eligible: EligibleRecord[];
  requested: Selection;
  fromOwnerId: number;
  toOwnerId: number;
}

export function planBulkReassign(input: PlanInput): ReassignPlan {
  const { eligible, requested, fromOwnerId, toOwnerId } = input;
  const byId = new Map(eligible.map((r) => [r.id, r]));

  // Whole-operation guard: moving to the same owner is a no-op.
  if (fromOwnerId === toOwnerId) {
    const ids =
      requested === SELECT_ALL ? eligible.map((r) => r.id) : requested.filter((id) => byId.has(id));
    return {
      requested: requested === SELECT_ALL ? eligible.length : requested.length,
      toApply: [],
      skipped: ids.map((id) => ({ id, reason: "same_owner" as const })),
    };
  }

  if (requested === SELECT_ALL) {
    const toApply: number[] = [];
    const skipped: { id: number; reason: SkipReason }[] = [];
    for (const r of eligible) {
      if (r.currentOwnerId === toOwnerId) skipped.push({ id: r.id, reason: "already_target" });
      else toApply.push(r.id);
    }
    return { requested: eligible.length, toApply, skipped };
  }

  const toApply: number[] = [];
  const skipped: { id: number; reason: SkipReason }[] = [];
  const seen = new Set<number>();
  for (const id of requested) {
    if (seen.has(id)) continue;
    seen.add(id);
    const rec = byId.get(id);
    if (!rec) {
      skipped.push({ id, reason: "not_eligible" });
      continue;
    }
    if (rec.currentOwnerId !== fromOwnerId) {
      skipped.push({ id, reason: "not_owned" });
      continue;
    }
    if (rec.currentOwnerId === toOwnerId) {
      skipped.push({ id, reason: "already_target" });
      continue;
    }
    toApply.push(id);
  }
  return { requested: seen.size, toApply, skipped };
}

export interface ReassignResult {
  requested: number;
  reassigned: number;
  skipped: number;
  failed: number;
}

/** Fold a plan + the number actually written into the authoritative summary. */
export function summarizeResult(
  plan: ReassignPlan,
  applied: number,
  opts: { transactionFailed?: boolean } = {},
): ReassignResult {
  if (opts.transactionFailed) {
    return {
      requested: plan.requested,
      reassigned: 0,
      skipped: plan.skipped.length,
      failed: plan.toApply.length,
    };
  }
  const reassigned = Math.max(0, Math.min(applied, plan.toApply.length));
  return {
    requested: plan.requested,
    reassigned,
    skipped: plan.skipped.length,
    failed: plan.toApply.length - reassigned,
  };
}
