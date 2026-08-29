import { describe, expect, it } from "vitest";
import { CelebrationQueue, type QueueItem } from "../live/queue";

const now = 1_000_000_000;
function item(over: Partial<QueueItem> = {}): QueueItem {
  return {
    dedupeKey: over.dedupeKey ?? Math.random().toString(36),
    kind: over.kind ?? "LEAD_ACCEPTED",
    createdAtMs: over.createdAtMs ?? now,
    payload: over.payload ?? { x: 1 },
    ...(over.announcementPriority ? { announcementPriority: over.announcementPriority } : {}),
  };
}

describe("CelebrationQueue — deterministic, bounded, no leaks", () => {
  it("dedupes a repeated business-event key", () => {
    const q = new CelebrationQueue();
    expect(q.enqueue(item({ dedupeKey: "SALE:lead:1" }))).toBe(true);
    expect(q.enqueue(item({ dedupeKey: "SALE:lead:1" }))).toBe(false);
    expect(q.size).toBe(1);
  });

  it("returns items highest-priority first, FIFO within a priority", () => {
    const q = new CelebrationQueue();
    q.enqueue(item({ dedupeKey: "a", kind: "LEAD_SUBMITTED" }));
    q.enqueue(item({ dedupeKey: "b", kind: "SALE" }));
    q.enqueue(item({ dedupeKey: "c", kind: "LEAD_ACCEPTED" }));
    q.enqueue(item({ dedupeKey: "d", kind: "LEAD_ACCEPTED" }));
    expect(q.take(now)!.dedupeKey).toBe("b"); // SALE
    expect(q.take(now)!.dedupeKey).toBe("c"); // first LEAD_ACCEPTED
    expect(q.take(now)!.dedupeKey).toBe("d");
    expect(q.take(now)!.dedupeKey).toBe("a"); // LEAD_SUBMITTED last
    expect(q.take(now)).toBeNull();
  });

  it("is bounded: when full it drops the single lowest-priority / newest item", () => {
    const q = new CelebrationQueue(3);
    q.enqueue(item({ dedupeKey: "s1", kind: "LEAD_SUBMITTED" }));
    q.enqueue(item({ dedupeKey: "s2", kind: "LEAD_SUBMITTED" }));
    q.enqueue(item({ dedupeKey: "acc", kind: "LEAD_ACCEPTED" }));
    q.enqueue(item({ dedupeKey: "sale", kind: "SALE" })); // over capacity → drop worst (s2)
    expect(q.size).toBe(3);
    const keys = q.peekAll().map((i) => i.dedupeKey);
    expect(keys).toContain("sale");
    expect(keys).toContain("acc");
    expect(keys).not.toContain("s2");
  });

  it("skips a stale low-priority item but never a stale SALE", () => {
    const q = new CelebrationQueue(50, 90_000);
    q.enqueue(item({ dedupeKey: "old-sub", kind: "LEAD_SUBMITTED", createdAtMs: now - 200_000 }));
    q.enqueue(item({ dedupeKey: "old-sale", kind: "SALE", createdAtMs: now - 200_000 }));
    const first = q.take(now);
    expect(first!.dedupeKey).toBe("old-sale"); // SALE is never stale
    expect(q.take(now)).toBeNull(); // the stale SUBMITTED was skipped, not shown
  });

  it("does not leak across many enqueue/take cycles", () => {
    const q = new CelebrationQueue(10);
    for (let i = 0; i < 5000; i++) {
      q.enqueue(item({ dedupeKey: `k${i}`, kind: "LEAD_ACCEPTED", createdAtMs: now + i }));
      q.take(now + i);
    }
    expect(q.size).toBe(0);
    expect(q.peekAll()).toEqual([]);
  });

  it("clear() empties the queue and the dedupe set", () => {
    const q = new CelebrationQueue();
    q.enqueue(item({ dedupeKey: "x" }));
    q.clear();
    expect(q.size).toBe(0);
    expect(q.enqueue(item({ dedupeKey: "x" }))).toBe(true); // key reusable after clear
  });
});
