import { beforeEach, describe, expect, it } from "vitest";
import { recognitionBus } from "../live/bus";

describe("recognition bus — bounded in-process ring", () => {
  beforeEach(() => recognitionBus.__reset());

  it("assigns a monotonically increasing seq", () => {
    const a = recognitionBus.publish("celebration", { k: 1 });
    const b = recognitionBus.publish("announcement", { k: 2 });
    expect(b.seq).toBe(a.seq + 1);
    expect(recognitionBus.latestSeq()).toBe(b.seq);
  });

  it("since(seq) returns only newer items, oldest first", () => {
    recognitionBus.publish("celebration", { i: 1 });
    const mid = recognitionBus.publish("celebration", { i: 2 });
    recognitionBus.publish("celebration", { i: 3 });
    const got = recognitionBus.since(mid.seq);
    expect(got.map((x) => (x.data as { i: number }).i)).toEqual([3]);
    expect(recognitionBus.since(0)).toHaveLength(3);
  });

  it("stays bounded under a long burst (no unbounded growth)", () => {
    for (let i = 0; i < 5000; i++) recognitionBus.publish("celebration", { i });
    const all = recognitionBus.since(0);
    expect(all.length).toBeLessThanOrEqual(40);
    // still only the most recent ones
    expect((all[all.length - 1]!.data as { i: number }).i).toBe(4999);
  });
});
