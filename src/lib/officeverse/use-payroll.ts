/**
 * Officeverse — payroll + salary hooks (Phase 13 + Phase 16 breakdown inputs).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addAdjustmentFn,
  adminOvertimeFn,
  adminPayrollFn,
  approvePayrollFn,
  attendanceRegisterFn,
  calculateAllPayrollFn,
  calculatePayrollFn,
  consolidatedPayrollFn,
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
import type { AttendanceRegister, ConsolidatedPayroll } from "@/server/hr/payroll-register-service";

export type { AttendanceRegister, ConsolidatedPayroll };
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

export function useSalaryProfiles(employee?: string, process?: ProcessCode) {
  return useQuery({
    queryKey: ["payroll", "salary-profiles", employee ?? "", process ?? "ALL"],
    queryFn: () =>
      salaryProfilesFn({
        data: {
          ...(employee ? { employee } : {}),
          ...(process ? { process } : {}),
        },
      }),
    staleTime: 20_000,
  });
}

export function useSetSalaryProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      employeeId: string;
      baseSalary: number;
      effectiveFrom: string;
      note?: string;
    }) => {
      const { employeeId, ...rest } = v;
      return setSalaryProfileFn({ data: { employee_id: employeeId, ...rest } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll"] }),
  });
}

export function useCalculatePayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { employeeId: string; month: string }) =>
      calculatePayrollFn({ data: { employee_id: v.employeeId, month: v.month } }),
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

/* ----------- Monthly Attendance Register + Consolidated Payroll ---------- */

export interface RegisterQuery {
  month: string;
  process?: ProcessCode | undefined;
  q?: string | undefined;
}
const registerArgs = (r: RegisterQuery) => ({
  month: r.month,
  ...(r.process ? { process: r.process } : {}),
  ...(r.q && r.q.trim() ? { q: r.q.trim() } : {}),
});

export function useAttendanceRegister(r: RegisterQuery) {
  return useQuery<AttendanceRegister>({
    queryKey: ["payroll", "attendance-register", r.month, r.process ?? "ALL", r.q ?? ""],
    queryFn: () => attendanceRegisterFn({ data: registerArgs(r) }),
    enabled: /^\d{4}-\d{2}$/.test(r.month),
    staleTime: 10_000,
  });
}

export function useConsolidatedPayroll(r: RegisterQuery) {
  return useQuery<ConsolidatedPayroll>({
    queryKey: ["payroll", "consolidated", r.month, r.process ?? "ALL", r.q ?? ""],
    queryFn: () => consolidatedPayrollFn({ data: registerArgs(r) }),
    enabled: /^\d{4}-\d{2}$/.test(r.month),
    staleTime: 10_000,
  });
}

export function useCalculateAllPayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: RegisterQuery) => calculateAllPayrollFn({ data: registerArgs(r) }),
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
