/**
 * Officeverse — holiday-calendar + regularity-bonus hooks (Phase 12).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addHolidayFn,
  adminBonusFn,
  deactivateHolidayFn,
  holidaysFn,
  myBonusFn,
  recalcBonusFn,
  seedUsFederalFn,
  updateHolidayFn,
} from "./holiday-fns";

export type ProcessCode = "US" | "UK" | "IN" | "AU";
export type HolidayType = "US_FEDERAL" | "INDIAN" | "COMPANY" | "WEEKLY_OFF";

export interface HolidayFilters {
  year?: string;
  type?: HolidayType;
  process?: ProcessCode;
}

export function useHolidays(filters: HolidayFilters = {}) {
  return useQuery({
    queryKey: ["holidays", filters],
    queryFn: () => holidaysFn({ data: filters }),
    staleTime: 30_000,
  });
}

export function useAddHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      name: string;
      holidayType: HolidayType;
      holidayDate: string;
      observedDate?: string;
      appliesToProcess?: ProcessCode;
    }) => addHolidayFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays"] }),
  });
}

export function useUpdateHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: number;
      name?: string;
      holidayDate?: string;
      observedDate?: string | null;
      appliesToProcess?: ProcessCode | null;
      active?: boolean;
    }) => updateHolidayFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays"] }),
  });
}

export function useDeactivateHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number }) => deactivateHolidayFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays"] }),
  });
}

export function useSeedUsFederal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { year: number }) => seedUsFederalFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays"] }),
  });
}

/* --------------------------- regularity bonus ------------------- */

export function useMyBonus(month?: string) {
  return useQuery({
    queryKey: ["bonus", "me", month ?? "current"],
    queryFn: () => myBonusFn({ data: month ? { month } : {} }),
    staleTime: 20_000,
  });
}

export interface AdminBonusFilters {
  month?: string;
  employee?: string;
  process?: ProcessCode;
  eligible?: boolean;
}
export function useAdminBonus(filters: AdminBonusFilters = {}) {
  return useQuery({
    queryKey: ["bonus", "admin", filters],
    queryFn: () => adminBonusFn({ data: filters }),
    staleTime: 15_000,
  });
}

export function useRecalcBonus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: number; month: string }) => recalcBonusFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bonus"] }),
  });
}
