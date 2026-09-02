/**
 * Officeverse — Assignment Control hooks (Phase 22). Admin-only.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignmentHistoryFn,
  assignmentRosterFn,
  assignmentWorkloadFn,
  longDatedFollowUpsFn,
  reassignBulkFn,
} from "./assignment-fns";

export type WorkType =
  "AGENT_FOLLOWUPS" | "CLOSER_LEADS" | "CLOSER_FOLLOWUPS" | "CLOSER_FOLLOWUPS_TO_AGENT";
export type TransferScope = "OVERDUE" | "DUE_TODAY" | "UPCOMING" | "ALL_PENDING" | "SELECTED";

export function useAssignmentRoster(process?: "US" | "UK" | "IN" | "AU") {
  return useQuery({
    queryKey: ["assignments", "roster", process ?? "all"],
    queryFn: () => assignmentRosterFn({ data: process ? { process } : {} }),
    staleTime: 15_000,
  });
}

export function useAssignmentWorkload(workType: WorkType, ownerId: number | null, search: string) {
  return useQuery({
    queryKey: ["assignments", "workload", workType, ownerId, search],
    queryFn: () =>
      assignmentWorkloadFn({
        data: { workType, ownerId: ownerId as number, ...(search ? { search } : {}) },
      }),
    enabled: ownerId != null && ownerId > 0,
    staleTime: 5_000,
  });
}

export function useAssignmentHistory() {
  return useQuery({
    queryKey: ["assignments", "history"],
    queryFn: () => assignmentHistoryFn({ data: {} }),
    staleTime: 10_000,
  });
}

/** §6 — long-dated (≈2–3 month) SCHEDULED follow-ups for Admin review. */
export function useLongDatedFollowUps(process?: "US" | "UK" | "IN" | "AU") {
  return useQuery({
    queryKey: ["assignments", "long-dated", process ?? "all"],
    queryFn: () => longDatedFollowUpsFn({ data: process ? { process } : {} }),
    staleTime: 30_000,
  });
}

export function useReassignBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      workType: WorkType;
      fromOwnerId: number;
      toOwnerId: number;
      selection: number[] | "ALL";
      scope?: TransferScope;
      reason?: string;
    }) => reassignBulkFn({ data: v }),
    onSuccess: () => {
      // Admin UAT §2 — the new owner must see the work immediately. Refresh the
      // roster/workload/history AND every downstream view of ownership.
      qc.invalidateQueries({ queryKey: ["assignments"] });
      qc.invalidateQueries({ queryKey: ["srv-leads"] });
      qc.invalidateQueries({ queryKey: ["srv-lead"] });
      qc.invalidateQueries({ queryKey: ["srv-followups"] });
      qc.invalidateQueries({ queryKey: ["srv-closers"] });
    },
  });
}
