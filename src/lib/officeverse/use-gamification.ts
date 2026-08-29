/**
 * Officeverse — gamification hooks (Phase 20).
 *
 * Read hooks for the personal view + leaderboard; Admin/HR hooks for the
 * participant drill-down, the data-driven point rules, reversals and audited
 * adjustments. No hook ever posts a point amount, rank or achievement award.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adjustPointsFn,
  gamificationParticipantFn,
  gamificationRulesFn,
  leaderboardFn,
  myGamificationFn,
  reversePointFn,
  seedGamificationFn,
  setGamificationRuleFn,
} from "./gamification-fns";

type LeaderboardKind = "daily" | "weekly" | "monthly" | "alltime";
type ProcessCode = "US" | "UK" | "IN" | "AU";

export function useMyGamification() {
  return useQuery({
    queryKey: ["gamification", "me"],
    queryFn: () => myGamificationFn({ data: {} }),
    staleTime: 30_000,
  });
}

export function useLeaderboard(kind: LeaderboardKind = "weekly", process?: ProcessCode) {
  return useQuery({
    queryKey: ["gamification", "leaderboard", kind, process ?? "all"],
    queryFn: () => leaderboardFn({ data: { kind, ...(process ? { process } : {}) } }),
    staleTime: 30_000,
  });
}

export function useGamificationParticipant(userId: number | null) {
  return useQuery({
    queryKey: ["gamification", "participant", userId],
    queryFn: () => gamificationParticipantFn({ data: { userId: userId as number } }),
    enabled: userId != null,
    staleTime: 15_000,
  });
}

export function useGamificationRules() {
  return useQuery({
    queryKey: ["gamification", "rules"],
    queryFn: () => gamificationRulesFn({ data: {} }),
    staleTime: 30_000,
  });
}

export function useReversePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { transactionId: number; reason: string }) => reversePointFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gamification"] }),
  });
}

export function useAdjustPoints() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { targetUserId: number; points: number; reason: string }) =>
      adjustPointsFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gamification"] }),
  });
}

export function useSetGamificationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      event:
        "LEAD_SUBMITTED" | "LEAD_ACCEPTED" | "SALE" | "TEAM_MILESTONE" | "ACHIEVEMENT_UNLOCKED";
      points: number;
      enabled: boolean;
      note?: string;
    }) => setGamificationRuleFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gamification", "rules"] }),
  });
}

export function useSeedGamification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => seedGamificationFn({ data: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gamification"] }),
  });
}
