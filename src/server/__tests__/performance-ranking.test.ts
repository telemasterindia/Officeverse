/**
 * Phase 8 — ranking is ALWAYS points DESC then userId ASC (standard competition
 * ranks 1,2,2,4). The Phase-8 supporting metrics are carried through for display
 * and NEVER influence the order.
 */
import { describe, expect, it } from "vitest";
import { rankLeaderboard, rankOf, type LeaderboardInputRow } from "../gamification/leaderboard";

const row = (
  userId: number,
  points: number,
  extra: Partial<LeaderboardInputRow> = {},
): LeaderboardInputRow => ({
  userId,
  name: `U${userId}`,
  role: "agent",
  process: "US",
  points,
  ...extra,
});

describe("performance ranking", () => {
  it("orders by points desc; ties broken by lower userId; competition ranks", () => {
    const ranked = rankLeaderboard([row(7, 30), row(3, 50), row(9, 30), row(1, 50)]);
    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([
      [1, 1],
      [3, 1],
      [7, 3],
      [9, 3],
    ]);
  });

  it("is stable regardless of input order", () => {
    const rows = [row(2, 10), row(5, 40), row(4, 40), row(8, 10), row(1, 40)];
    const a = rankLeaderboard(rows).map((r) => r.userId);
    const b = rankLeaderboard([...rows].reverse()).map((r) => r.userId);
    expect(a).toEqual(b);
    expect(a).toEqual([1, 4, 5, 2, 8]); // 40s by userId asc, then 10s by userId asc
  });

  it("a full points+metrics tie is still deterministic (userId asc) — no unstable order", () => {
    const tie = [
      row(9, 100, { leadsAccepted: 5, leadsSubmitted: 9, sales: 1 }),
      row(4, 100, { leadsAccepted: 5, leadsSubmitted: 9, sales: 1 }),
      row(6, 100, { leadsAccepted: 5, leadsSubmitted: 9, sales: 1 }),
    ];
    for (let i = 0; i < 10; i++) {
      expect(rankLeaderboard(tie).map((r) => r.userId)).toEqual([4, 6, 9]);
    }
  });

  it("supporting metrics never change the order (higher accepted, fewer points → still lower)", () => {
    const ranked = rankLeaderboard([
      row(1, 100, { leadsAccepted: 0, sales: 0 }),
      row(2, 90, { leadsAccepted: 50, sales: 20 }),
    ]);
    expect(ranked.map((r) => r.userId)).toEqual([1, 2]);
  });

  it("zero-point and negative-point rows rank last, still deterministically", () => {
    const ranked = rankLeaderboard([row(3, 0), row(1, -25), row(2, 10)]);
    expect(ranked.map((r) => [r.userId, r.points, r.rank])).toEqual([
      [2, 10, 1],
      [3, 0, 2],
      [1, -25, 3],
    ]);
  });

  it("empty period → empty ranking, rankOf → null", () => {
    const ranked = rankLeaderboard([]);
    expect(ranked).toEqual([]);
    expect(rankOf(ranked, 5)).toBeNull();
  });
});
