/**
 * Officeverse — attendance hooks (Phase 10).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminAttendanceFn,
  correctAttendanceFn,
  managedAttendanceFn,
  myAttendanceFn,
  overrideAttendanceFn,
} from "./attendance-fns";

export interface AttendanceRange {
  from?: string;
  to?: string;
}
export interface AdminAttendanceFilters extends AttendanceRange {
  employee?: string;
  process?: string;
  shiftName?: string;
  status?: string;
}

export function useMyAttendance(range: AttendanceRange = {}) {
  return useQuery({
    queryKey: ["attendance", "me", range],
    queryFn: () => myAttendanceFn({ data: range }),
    staleTime: 30_000,
  });
}

export function useAdminAttendance(filters: AdminAttendanceFilters = {}) {
  return useQuery({
    queryKey: ["attendance", "admin", filters],
    queryFn: () => adminAttendanceFn({ data: filters }),
    staleTime: 20_000,
  });
}

/** Closer (own-process agents only) / HR / Admin manager view. */
export function useManagedAttendance(filters: AdminAttendanceFilters = {}) {
  return useQuery({
    queryKey: ["attendance", "managed", filters],
    queryFn: () => managedAttendanceFn({ data: filters }),
    staleTime: 20_000,
  });
}

export function useCorrectAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; reason: string; patch: Record<string, unknown> }) =>
      correctAttendanceFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

/** HR / Admin classification override: NORMAL | SHORT_LATE | LATE + reason. */
export function useOverrideAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; newClass: "NORMAL" | "SHORT_LATE" | "LATE"; reason: string }) =>
      overrideAttendanceFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
}
