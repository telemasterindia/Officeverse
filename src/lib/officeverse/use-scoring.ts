/**
 * Officeverse — Scoring Console hooks (Phase 3). Admin only.
 *
 * Thin react-query wrappers over `scoring-fns`. No hook posts a computed award —
 * only rule definitions and read-only dry-run requests.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createScoringRuleFn,
  getScoringRuleFn,
  listScoringRulesFn,
  scoreDryRunFn,
  scoringMetaFn,
  setScoringRuleEnabledFn,
  updateScoringRuleFn,
  type CreateScoringRuleInput,
  type ScoreDryRunInput,
  type UpdateScoringRuleInput,
} from "./scoring-fns";

const KEY = ["scoring"] as const;

export function useScoringMeta() {
  return useQuery({
    queryKey: [...KEY, "meta"],
    queryFn: () => scoringMetaFn({ data: {} }),
    staleTime: 5 * 60_000,
  });
}

export function useScoringRules(event?: string) {
  return useQuery({
    queryKey: [...KEY, "rules", event ?? "all"],
    queryFn: () => listScoringRulesFn({ data: event ? { event } : {} }),
    staleTime: 15_000,
  });
}

export function useScoringRule(ruleId: number | null) {
  return useQuery({
    queryKey: [...KEY, "rule", ruleId],
    queryFn: () => getScoringRuleFn({ data: { ruleId: ruleId as number } }),
    enabled: ruleId != null,
    staleTime: 10_000,
  });
}

export function useCreateScoringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: CreateScoringRuleInput) => createScoringRuleFn({ data: draft }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateScoringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: UpdateScoringRuleInput) => updateScoringRuleFn({ data: draft }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetScoringRuleEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ruleId: number; enabled: boolean }) => setScoringRuleEnabledFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useScoreDryRun() {
  return useMutation({
    mutationFn: (v: ScoreDryRunInput) => scoreDryRunFn({ data: v }),
  });
}
