/**
 * Officeverse — Assignment Control hooks (Phase 22). Admin-only.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignmentHistoryFn,
  assignmentRosterFn,
  assignmentWorkloadFn,
  reassignBulkFn,
} from "./assignment-fns";

type WorkType = "AGENT_FOLLOWUPS" | "CLOSER_LEADS" | "CLOSER_FOLLOWUPS";

export function useAssignmentRoster() {
  return useQuery({
    queryKey: ["assignments", "roster"],
    queryFn: () => assignmentRosterFn({ data: {} }),
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

export function useReassignBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      workType: WorkType;
      fromOwnerId: number;
      toOwnerId: number;
      selection: number[] | "ALL";
      reason?: string;
    }) => reassignBulkFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assignments"] }),
  });
}
