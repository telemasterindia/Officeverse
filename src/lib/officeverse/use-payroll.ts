/**
 * Officeverse — payroll + salary hooks (Phase 13).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminPayrollFn,
  approvePayrollFn,
  calculatePayrollFn,
  lockPayrollFn,
  myPayrollFn,
  reopenPayrollFn,
  salaryProfilesFn,
  setSalaryProfileFn,
} from "./payroll-fns";

export type ProcessCode = "US" | "UK" | "IN" | "AU";
export type PayrollStatus = "DRAFT" | "CALCULATED" | "APPROVED" | "LOCKED";

export interface AdminPayrollFilters {
  month?: string;
  employee?: string;
  process?: ProcessCode;
  status?: PayrollStatus;
}

export function useAdminPayroll(filters: AdminPayrollFilters = {}) {
  return useQuery({
    queryKey: ["payroll", "admin", filters],
    queryFn: () => adminPayrollFn({ data: filters }),
    staleTime: 15_000,
  });
}

export function useMyPayroll(month?: string) {
  return useQuery({
    queryKey: ["payroll", "me", month ?? "all"],
    queryFn: () => myPayrollFn({ data: month ? { month } : {} }),
    staleTime: 20_000,
  });
}

export function useSalaryProfiles(employee?: string) {
  return useQuery({
    queryKey: ["payroll", "salary-profiles", employee ?? ""],
    queryFn: () => salaryProfilesFn({ data: employee ? { employee } : {} }),
    staleTime: 20_000,
  });
}

export function useSetSalaryProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: number; baseSalary: number; effectiveFrom: string; note?: string }) =>
      setSalaryProfileFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll"] }),
  });
}

export function useCalculatePayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: number; month: string }) => calculatePayrollFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll"] }),
  });
}

export function useApprovePayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: number; month: string }) => approvePayrollFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll"] }),
  });
}

export function useLockPayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: number; month: string }) => lockPayrollFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll"] }),
  });
}

export function useReopenPayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: number; month: string; reason: string }) =>
      reopenPayrollFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll"] }),
  });
}
