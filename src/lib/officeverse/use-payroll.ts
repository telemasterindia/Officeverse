/**
 * Officeverse — payroll + salary hooks (Phase 13 + Phase 16 breakdown inputs).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addAdjustmentFn,
  adminOvertimeFn,
  adminPayrollFn,
  approvePayrollFn,
  calculatePayrollFn,
  decideOvertimeFn,
  employmentPeriodsFn,
  lockPayrollFn,
  myOvertimeFn,
  myPayrollFn,
  payrollBreakdownFn,
  recordOvertimeFn,
  reopenPayrollFn,
  salaryProfilesFn,
  setEmploymentPeriodFn,
  setSalaryProfileFn,
  voidAdjustmentFn,
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

/* ---------------------- Phase 16 breakdown inputs -------------- */

export function usePayrollBreakdown(userId: number | null, month: string) {
  return useQuery({
    queryKey: ["payroll", "breakdown", userId, month],
    queryFn: () => payrollBreakdownFn({ data: { userId: userId as number, month } }),
    enabled: userId != null && /^\d{4}-\d{2}$/.test(month),
    staleTime: 10_000,
  });
}

export function useEmploymentPeriods(userId: number | null) {
  return useQuery({
    queryKey: ["payroll", "employment", userId],
    queryFn: () => employmentPeriodsFn({ data: { userId: userId as number } }),
    enabled: userId != null,
    staleTime: 20_000,
  });
}

export function useSetEmploymentPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      userId: number;
      startDate: string;
      endDate?: string | null;
      note?: string;
    }) => setEmploymentPeriodFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll"] }),
  });
}

export function useAdminOvertime(filters: { month?: string; status?: string } = {}) {
  return useQuery({
    queryKey: ["payroll", "overtime", filters],
    queryFn: () => adminOvertimeFn({ data: filters }),
    staleTime: 15_000,
  });
}

export function useMyOvertime(month?: string) {
  return useQuery({
    queryKey: ["payroll", "overtime", "me", month ?? "all"],
    queryFn: () => myOvertimeFn({ data: month ? { month } : {} }),
    staleTime: 20_000,
  });
}

export function useRecordOvertime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      userId: number;
      workDate: string;
      overtimeMinutes: number;
      reason?: string;
    }) => recordOvertimeFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll"] }),
  });
}

export function useDecideOvertime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { overtimeId: number; decision: "APPROVED" | "REJECTED" | "VOID" }) =>
      decideOvertimeFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll"] }),
  });
}

export function useAddAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      userId: number;
      month: string;
      kind: "EARNING" | "DEDUCTION";
      label: string;
      amount: number;
      reason?: string;
    }) => addAdjustmentFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll"] }),
  });
}

export function useVoidAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { adjustmentId: number }) => voidAdjustmentFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll"] }),
  });
}
