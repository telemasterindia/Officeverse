import { describe, expect, it } from "vitest";
import {
  comparePriority,
  DEFAULT_PRIORITY,
  priorityOf,
  RECOGNITION_KINDS,
  type PriorityKeyed,
} from "../live/priority";

describe("recognition priority — deterministic, never random", () => {
  it("orders emergency > sale > team milestone > third accepted > accepted > submitted > achievement", () => {
    const order = [
      "EMERGENCY_ADMIN",
      "SALE",
      "TEAM_MILESTONE",
      "THIRD_ACCEPTED_LEAD",
      "LEAD_ACCEPTED",
      "LEAD_SUBMITTED",
      "ACHIEVEMENT_UNLOCKED",
    ] as const;
    for (let i = 1; i < order.length; i++) {
      expect(DEFAULT_PRIORITY[order[i - 1]!]).toBeLessThan(DEFAULT_PRIORITY[order[i]!]);
    }
  });

  it("every recognition kind has a weight", () => {
    for (const k of RECOGNITION_KINDS) {
      expect(typeof priorityOf(k)).toBe("number");
    }
  });

  it("an URGENT announcement outranks a normal LEAD_ACCEPTED but not a SALE", () => {
    expect(priorityOf("ANNOUNCEMENT", "URGENT")).toBeLessThan(priorityOf("LEAD_ACCEPTED"));
    expect(priorityOf("ANNOUNCEMENT", "URGENT")).toBeGreaterThan(priorityOf("SALE"));
  });

  it("a NORMAL announcement never outranks SALE / TEAM_MILESTONE / THIRD_ACCEPTED_LEAD", () => {
    const n = priorityOf("ANNOUNCEMENT", "NORMAL");
    expect(n).toBeGreaterThan(priorityOf("SALE"));
    expect(n).toBeGreaterThan(priorityOf("TEAM_MILESTONE"));
    expect(n).toBeGreaterThan(priorityOf("THIRD_ACCEPTED_LEAD"));
  });

  it("comparePriority breaks ties by enqueue order (FIFO), never randomly", () => {
    const a: PriorityKeyed = { kind: "LEAD_ACCEPTED", seq: 5 };
    const b: PriorityKeyed = { kind: "LEAD_ACCEPTED", seq: 2 };
    expect(comparePriority(a, b)).toBeGreaterThan(0); // b (earlier seq) first
    const sorted = [a, b, { kind: "SALE", seq: 9 } as PriorityKeyed].sort(comparePriority);
    expect(sorted.map((x) => x.seq)).toEqual([9, 2, 5]);
  });
});
