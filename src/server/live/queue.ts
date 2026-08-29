/**
 * Officeverse — Live Experience: celebration event queue (Phase 21).
 *
 * PURE + deterministic. If several recognition events land in a burst the TV
 * does NOT play them at once — it plays one, returns to the leaderboard, then
 * plays the next by priority (see priority.ts), FIFO within a priority.
 *
 * Guarantees:
 *   - dedupe: a repeated `dedupeKey` never enqueues twice
 *   - bounded: at most `capacity` items; when full the lowest-priority /
 *     newest item is dropped (a fresh SALE always beats a stale SUBMITTED)
 *   - stale-skip: on `take`, low-priority items older than `staleMs` are
 *     discarded instead of shown (documented below); SALE / EMERGENCY_ADMIN /
 *     TEAM_MILESTONE are never treated as stale
 *   - no permanent blocking: `take` always returns in O(n); nothing is retried
 */
import { comparePriority, priorityOf, type RecognitionKind } from "./priority";

export interface QueueItem {
  dedupeKey: string;
  kind: RecognitionKind;
  /** epoch ms the underlying business event was confirmed */
  createdAtMs: number;
  announcementPriority?: string | undefined;
  /** opaque payload handed back to the caller */
  payload: unknown;
}

interface Stored extends QueueItem {
  seq: number;
}

const NEVER_STALE: ReadonlySet<RecognitionKind> = new Set([
  "EMERGENCY_ADMIN",
  "SALE",
  "TEAM_MILESTONE",
]);

export class CelebrationQueue {
  private items: Stored[] = [];
  private seen = new Set<string>();
  private seqCounter = 0;

  constructor(
    private readonly capacity = 50,
    /** low-priority items older than this (ms) are skipped on take */
    private readonly staleMs = 90_000,
  ) {}

  get size(): number {
    return this.items.length;
  }

  /** Returns true if the item was accepted, false if it was a duplicate. */
  enqueue(item: QueueItem): boolean {
    if (this.seen.has(item.dedupeKey)) return false;
    this.seen.add(item.dedupeKey);
    const stored: Stored = { ...item, seq: ++this.seqCounter };
    this.items.push(stored);
    if (this.items.length > this.capacity) {
      // drop the single worst item (lowest priority, then newest)
      let worstIdx = 0;
      for (let i = 1; i < this.items.length; i++) {
        const a = this.items[i]!;
        const b = this.items[worstIdx]!;
        const pa = priorityOf(a.kind, a.announcementPriority);
        const pb = priorityOf(b.kind, b.announcementPriority);
        if (pa > pb || (pa === pb && a.seq > b.seq)) worstIdx = i;
      }
      const [dropped] = this.items.splice(worstIdx, 1);
      if (dropped) this.seen.delete(dropped.dedupeKey);
    }
    return true;
  }

  /**
   * Remove and return the next item to display, or null if the queue is empty
   * (or only holds stale low-priority items). `nowMs` is the server clock.
   */
  take(nowMs: number): QueueItem | null {
    if (this.items.length === 0) return null;
    this.items.sort(comparePriority);
    while (this.items.length > 0) {
      const head = this.items.shift()!;
      this.seen.delete(head.dedupeKey);
      const age = nowMs - head.createdAtMs;
      const stale = age > this.staleMs && !NEVER_STALE.has(head.kind);
      if (stale) continue; // skip, try the next
      return head;
    }
    return null;
  }

  /** Non-destructive view of what's waiting, in display order. */
  peekAll(): QueueItem[] {
    return [...this.items].sort(comparePriority);
  }

  clear(): void {
    this.items = [];
    this.seen.clear();
  }
}
