/**
 * Officeverse — HR leave / off hooks (Phase 11).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminLeaveFn,
  adminOffFn,
  decideLeaveFn,
  myHrFn,
  recalcHrFn,
  requestLeaveFn,
} from "./leave-fns";

export function useMyHr(month?: string) {
  return useQuery({
    queryKey: ["hr", "me", month ?? "current"],
    queryFn: () => myHrFn({ data: month ? { month } : {} }),
    staleTime: 20_000,
  });
}

export interface AdminLeaveFilters {
  from?: string;
  to?: string;
  status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  employee?: string;
}
export function useAdminLeave(filters: AdminLeaveFilters = {}) {
  return useQuery({
    queryKey: ["hr", "leave", filters],
    queryFn: () => adminLeaveFn({ data: filters }),
    staleTime: 15_000,
  });
}

export interface AdminOffFilters {
  month?: string;
  offType?: string;
  employee?: string;
}
export function useAdminOff(filters: AdminOffFilters = {}) {
  return useQuery({
    queryKey: ["hr", "off", filters],
    queryFn: () => adminOffFn({ data: filters }),
    staleTime: 15_000,
  });
}

export function useRequestLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { leaveType?: string; startDate: string; endDate: string; reason?: string }) =>
      requestLeaveFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr"] }),
  });
}

export function useDecideLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: number;
      decision: "APPROVED" | "REJECTED" | "CANCELLED";
      note?: string;
    }) => decideLeaveFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr"] }),
  });
}

export function useRecalcHr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: number; process: "US" | "UK" | "IN" | "AU"; month: string }) =>
      recalcHrFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr"] }),
  });
}
