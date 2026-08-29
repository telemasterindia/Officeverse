import { describe, expect, it } from "vitest";
import {
  addDays,
  dayOfWeek,
  rankLeaderboard,
  rankOf,
  startOfIsoWeek,
  windowBounds,
  type LeaderboardInputRow,
} from "../gamification/leaderboard";

describe("leaderboard — operational-date windows (server-authoritative)", () => {
  it("daily window is the single operational date", () => {
    expect(windowBounds("daily", "2026-03-10")).toEqual({ from: "2026-03-10", to: "2026-03-10" });
  });

  it("weekly window is Monday..Sunday of the ISO week", () => {
    // 2026-03-10 is a Tuesday
    expect(dayOfWeek("2026-03-10")).toBe(2);
    expect(startOfIsoWeek("2026-03-10")).toBe("2026-03-09"); // Monday
    expect(windowBounds("weekly", "2026-03-10")).toEqual({ from: "2026-03-09", to: "2026-03-15" });
  });

  it("weekly window on a Sunday still resolves to that same Mon..Sun", () => {
    expect(dayOfWeek("2026-03-15")).toBe(0); // Sunday
    expect(windowBounds("weekly", "2026-03-15")).toEqual({ from: "2026-03-09", to: "2026-03-15" });
  });

  it("monthly window covers the whole calendar month (leap Feb included)", () => {
    expect(windowBounds("monthly", "2024-02-15")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(windowBounds("monthly", "2026-02-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(windowBounds("monthly", "2026-12-01")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("all-time window is unbounded", () => {
    expect(windowBounds("alltime", "2026-03-10")).toEqual({ from: null, to: null });
  });

  it("rejects a non-ISO operational date (never a browser-local string)", () => {
    expect(() => windowBounds("daily", "3/10/2026")).toThrow();
    expect(() => windowBounds("weekly", "")).toThrow();
  });

  it("addDays is UTC-safe across a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("leaderboard — ranking by points with a deterministic tie-break", () => {
  const rows: LeaderboardInputRow[] = [
    { userId: 7, name: "G", role: "agent", process: "US", points: 30 },
    { userId: 3, name: "C", role: "closer", process: "US", points: 50 },
    { userId: 9, name: "I", role: "agent", process: "US", points: 30 },
    { userId: 1, name: "A", role: "agent", process: "US", points: 50 },
  ];

  it("orders by points desc, breaks ties by lower userId, uses competition ranks", () => {
    const ranked = rankLeaderboard(rows);
    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([
      [1, 1], // 50 pts, lower id wins the tie
      [3, 1], // 50 pts
      [7, 3], // 30 pts, lower id first
      [9, 3], // 30 pts
    ]);
  });

  it("is stable regardless of input order", () => {
    const a = rankLeaderboard(rows).map((r) => r.userId);
    const b = rankLeaderboard([...rows].reverse()).map((r) => r.userId);
    expect(a).toEqual(b);
  });

  it("rankOf returns the competition rank or null", () => {
    const ranked = rankLeaderboard(rows);
    expect(rankOf(ranked, 9)).toBe(3);
    expect(rankOf(ranked, 999)).toBeNull();
  });

  it("ranking is never driven by raw lead count", () => {
    const ranked = rankLeaderboard([
      { userId: 1, name: "A", role: "agent", process: "US", points: 10, acceptedLeads: 100 },
      { userId: 2, name: "B", role: "agent", process: "US", points: 40, acceptedLeads: 2 },
    ]);
    expect(ranked[0]!.userId).toBe(2); // fewer leads, more points → higher
  });
});
