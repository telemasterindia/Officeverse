import { describe, expect, it } from "vitest";
import { lateOffs, planOffRecords, shortOffs } from "../hr/off-conversion";

describe("2 LATE = 1 OFF (frozen)", () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 1],
    [3, 1],
    [4, 2],
    [6, 3],
    [8, 4],
  ])("%i Late → %i Off", (late, offs) => {
    expect(lateOffs(late)).toBe(offs);
  });
});

describe("3 SHORT ATTENDANCE = 1 OFF (frozen)", () => {
  it.each([
    [0, 0],
    [2, 0],
    [3, 1],
    [5, 1],
    [6, 2],
    [9, 3],
  ])("%i Short → %i Off", (short, offs) => {
    expect(shortOffs(short)).toBe(offs);
  });
});

describe("planOffRecords — separate counters, never combined", () => {
  it("1 Late + 2 Short → 0 Off (neither threshold met)", () => {
    const p = planOffRecords({ periodMonth: "2026-08", lateCount: 1, shortCount: 2 });
    expect(p.lateOffCount).toBe(0);
    expect(p.shortOffCount).toBe(0);
    expect(p.records).toHaveLength(0);
  });

  it("2 Late + 2 Short → exactly 1 Off, and it is LATE_CONVERSION only", () => {
    const p = planOffRecords({ periodMonth: "2026-08", lateCount: 2, shortCount: 2 });
    expect(p.records).toHaveLength(1);
    expect(p.records[0]).toMatchObject({ offType: "LATE_CONVERSION", offIndex: 1, sourceCount: 2 });
  });

  it("4 Late + 6 Short → 2 late offs + 2 short offs, distinctly typed and indexed", () => {
    const p = planOffRecords({ periodMonth: "2026-08", lateCount: 4, shortCount: 6 });
    expect(p.records.map((r) => `${r.offType}#${r.offIndex}`)).toEqual([
      "LATE_CONVERSION#1",
      "LATE_CONVERSION#2",
      "SHORT_ATTENDANCE_CONVERSION#1",
      "SHORT_ATTENDANCE_CONVERSION#2",
    ]);
  });
});

describe("idempotency — the plan is deterministic", () => {
  it("running planOffRecords twice yields identical records", () => {
    const a = planOffRecords({ periodMonth: "2026-08", lateCount: 6, shortCount: 9 });
    const b = planOffRecords({ periodMonth: "2026-08", lateCount: 6, shortCount: 9 });
    expect(a.records).toEqual(b.records);
  });

  it("the same monthly counts always map to the same off_index set (no double-convert)", () => {
    const first = planOffRecords({ periodMonth: "2026-08", lateCount: 2, shortCount: 0 });
    const again = planOffRecords({ periodMonth: "2026-08", lateCount: 2, shortCount: 0 });
    // service upserts by (user, type, month, off_index) → re-run touches the SAME row
    expect(first.records).toEqual([
      {
        offType: "LATE_CONVERSION",
        offIndex: 1,
        sourceCount: 2,
        sourceDescription: expect.stringContaining("2026-08"),
      },
    ]);
    expect(again.records).toEqual(first.records);
  });
});
