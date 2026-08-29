import { describe, expect, it } from "vitest";
import {
  planBulkReassign,
  SELECT_ALL,
  summarizeResult,
  type EligibleRecord,
} from "../assignments/plan";

const FROM = 10;
const TO = 20;
const OTHER = 30;

function elig(pairs: [number, number][]): EligibleRecord[] {
  return pairs.map(([id, currentOwnerId]) => ({ id, currentOwnerId }));
}

describe("planBulkReassign — server decides the final set", () => {
  it("SELECT_ALL moves every eligible record, skipping ones already on the destination", () => {
    const plan = planBulkReassign({
      eligible: elig([
        [1, FROM],
        [2, FROM],
        [3, TO], // already owned by destination
        [4, FROM],
      ]),
      requested: SELECT_ALL,
      fromOwnerId: FROM,
      toOwnerId: TO,
    });
    expect(plan.requested).toBe(4);
    expect(plan.toApply).toEqual([1, 2, 4]);
    expect(plan.skipped).toEqual([{ id: 3, reason: "already_target" }]);
  });

  it("an explicit selection is filtered to eligible + owned + not-already-target", () => {
    const plan = planBulkReassign({
      eligible: elig([
        [1, FROM],
        [2, FROM],
        [5, OTHER], // eligible list is for FROM, but this row is owned by someone else
      ]),
      requested: [1, 2, 5, 99], // 99 not in the eligible set at all
      fromOwnerId: FROM,
      toOwnerId: TO,
    });
    expect(plan.toApply).toEqual([1, 2]);
    expect(plan.skipped).toContainEqual({ id: 5, reason: "not_owned" });
    expect(plan.skipped).toContainEqual({ id: 99, reason: "not_eligible" });
  });

  it("deduplicates a repeated id in the request", () => {
    const plan = planBulkReassign({
      eligible: elig([[1, FROM]]),
      requested: [1, 1, 1],
      fromOwnerId: FROM,
      toOwnerId: TO,
    });
    expect(plan.requested).toBe(1);
    expect(plan.toApply).toEqual([1]);
  });

  it("moving to the same owner is a no-op for the whole operation", () => {
    const plan = planBulkReassign({
      eligible: elig([
        [1, FROM],
        [2, FROM],
      ]),
      requested: SELECT_ALL,
      fromOwnerId: FROM,
      toOwnerId: FROM,
    });
    expect(plan.toApply).toEqual([]);
    expect(plan.skipped.every((s) => s.reason === "same_owner")).toBe(true);
  });

  it("supports multi-destination distribution via separate operations on one source", () => {
    const eligible = elig([
      [1, FROM],
      [2, FROM],
      [3, FROM],
      [4, FROM],
      [5, FROM],
      [6, FROM],
    ]);
    const a = planBulkReassign({ eligible, requested: [1, 2], fromOwnerId: FROM, toOwnerId: TO });
    const b = planBulkReassign({
      eligible,
      requested: [3, 4],
      fromOwnerId: FROM,
      toOwnerId: OTHER,
    });
    const c = planBulkReassign({ eligible, requested: [5, 6], fromOwnerId: FROM, toOwnerId: 40 });
    expect(a.toApply).toEqual([1, 2]);
    expect(b.toApply).toEqual([3, 4]);
    expect(c.toApply).toEqual([5, 6]);
    // the three batches are disjoint — no record is moved twice
    expect(new Set([...a.toApply, ...b.toApply, ...c.toApply]).size).toBe(6);
  });
});

describe("summarizeResult — authoritative counts, never 'all reassigned' when some failed", () => {
  it("reports partial success honestly", () => {
    const plan = {
      requested: 47,
      toApply: [1, 2, 3, 4, 5],
      skipped: [{ id: 9, reason: "already_target" as const }],
    };
    expect(summarizeResult(plan, 3)).toEqual({
      requested: 47,
      reassigned: 3,
      skipped: 1,
      failed: 2,
    });
  });

  it("a failed transaction reassigns nothing", () => {
    const plan = { requested: 10, toApply: [1, 2, 3], skipped: [] };
    expect(summarizeResult(plan, 0, { transactionFailed: true })).toEqual({
      requested: 10,
      reassigned: 0,
      skipped: 0,
      failed: 3,
    });
  });

  it("full success", () => {
    const plan = { requested: 5, toApply: [1, 2, 3, 4, 5], skipped: [] };
    expect(summarizeResult(plan, 5)).toEqual({
      requested: 5,
      reassigned: 5,
      skipped: 0,
      failed: 0,
    });
  });
});
