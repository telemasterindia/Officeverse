/**
 * Officeverse — Live Experience: in-process recognition bus (Phase 21).
 *
 * A small, bounded, in-memory ring of the most recent recognition payloads with
 * a monotonically increasing `seq`. The /office-tv client polls the state
 * endpoint (~2 s) and advances through `seq` values it has not seen — no manual
 * refresh, no extra infrastructure, consistent with the app's existing
 * react-query polling model.
 *
 * NOTE (single-process assumption): the target deployment (cPanel Node, one
 * process) shares this ring across all requests. A future multi-process /
 * horizontally-scaled deployment would back this with the `office_tv_events`
 * table (already persisted) or a pub/sub channel; the state contract does not
 * change. Nothing here is authoritative — the DB is.
 */

export interface LivePayload {
  seq: number;
  /** epoch ms the payload was published */
  atMs: number;
  type: "celebration" | "leaderboard" | "announcement";
  data: unknown;
}

const MAX_RING = 40;

class RecognitionBus {
  private ring: LivePayload[] = [];
  private seq = 0;

  publish(type: LivePayload["type"], data: unknown): LivePayload {
    const item: LivePayload = { seq: ++this.seq, atMs: Date.now(), type, data };
    this.ring.push(item);
    if (this.ring.length > MAX_RING) this.ring.splice(0, this.ring.length - MAX_RING);
    return item;
  }

  /** Everything with seq > `afterSeq`, oldest first. */
  since(afterSeq: number): LivePayload[] {
    return this.ring.filter((p) => p.seq > afterSeq);
  }

  latestSeq(): number {
    return this.seq;
  }

  /** test helper */
  __reset(): void {
    this.ring = [];
    this.seq = 0;
  }
}

const g = globalThis as unknown as { __ovRecognitionBus?: RecognitionBus };
export const recognitionBus: RecognitionBus = (g.__ovRecognitionBus ??= new RecognitionBus());
