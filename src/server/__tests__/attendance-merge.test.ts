import { describe, expect, it } from "vitest";
import { mergedMinutes, mergedMs } from "../attendance/merge";

const H = 3_600_000;

describe("mergedMinutes — multiple / overlapping sessions never double-count", () => {
  it("a single session", () => {
    expect(mergedMinutes([{ startMs: 0, endMs: 2 * H }])).toBe(120);
  });

  it("two fully separate sessions add up", () => {
    expect(
      mergedMinutes([
        { startMs: 0, endMs: 1 * H },
        { startMs: 2 * H, endMs: 3 * H },
      ]),
    ).toBe(120);
  });

  it("two OVERLAPPING sessions count the union once", () => {
    // 21:00–02:00 and 22:00–04:00 → union 21:00–04:00 = 7h
    expect(
      mergedMinutes([
        { startMs: 21 * H, endMs: 26 * H },
        { startMs: 22 * H, endMs: 28 * H },
      ]),
    ).toBe(7 * 60);
  });

  it("one session fully contained in another → just the outer", () => {
    expect(
      mergedMinutes([
        { startMs: 0, endMs: 8 * H },
        { startMs: 2 * H, endMs: 3 * H },
      ]),
    ).toBe(8 * 60);
  });

  it("adjacent (touching) intervals merge", () => {
    expect(
      mergedMs([
        { startMs: 0, endMs: 1 * H },
        { startMs: 1 * H, endMs: 2 * H },
      ]),
    ).toBe(2 * H);
  });

  it("ignores zero/negative-length and non-finite intervals", () => {
    expect(
      mergedMinutes([
        { startMs: 5, endMs: 5 },
        { startMs: 10, endMs: 4 },
        { startMs: Number.NaN, endMs: 1 },
        { startMs: 0, endMs: 1 * H },
      ]),
    ).toBe(60);
  });

  it("empty → 0", () => {
    expect(mergedMinutes([])).toBe(0);
  });
});
