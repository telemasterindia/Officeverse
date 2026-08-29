/**
 * Officeverse — salary-slip hooks (Phase 14 + Phase 15 monthly delivery).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminSalarySlipsFn,
  downloadSalarySlipFn,
  generateSalarySlipFn,
  mySalarySlipsFn,
  salarySlipHistoryFn,
  sendSalarySlipFn,
} from "./salary-slip-fns";
import { monthlyDeliveryPreviewFn, runMonthlyDeliveryFn } from "./salary-batch-fns";

export type ProcessCode = "US" | "UK" | "IN" | "AU";

export type SalarySlipStatus = "GENERATED" | "SENT" | "FAILED";

export interface AdminSlipFilters {
  month?: string;
  employee?: string;
  status?: SalarySlipStatus;
}

export function useAdminSalarySlips(filters: AdminSlipFilters = {}) {
  return useQuery({
    queryKey: ["salary-slip", "admin", filters],
    queryFn: () => adminSalarySlipsFn({ data: filters }),
    staleTime: 15_000,
  });
}

export function useMySalarySlips(month?: string) {
  return useQuery({
    queryKey: ["salary-slip", "me", month ?? "all"],
    queryFn: () => mySalarySlipsFn({ data: month ? { month } : {} }),
    staleTime: 20_000,
  });
}

export function useSalarySlipHistory(salarySlipId: number | null) {
  return useQuery({
    queryKey: ["salary-slip", "history", salarySlipId],
    queryFn: () => salarySlipHistoryFn({ data: { salarySlipId: salarySlipId as number } }),
    enabled: salarySlipId != null,
    staleTime: 10_000,
  });
}

export function useGenerateSalarySlip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { payrollRunId: number; allowPreview?: boolean }) =>
      generateSalarySlipFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary-slip"] }),
  });
}

export function useSendSalarySlip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { salarySlipId: number }) => sendSalarySlipFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary-slip"] }),
  });
}

export interface MonthlyDeliveryInput {
  month: string;
  process?: ProcessCode;
}

export function useMonthlyDeliveryPreview() {
  return useMutation({
    mutationFn: (v: MonthlyDeliveryInput) => monthlyDeliveryPreviewFn({ data: v }),
  });
}

export function useRunMonthlyDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: MonthlyDeliveryInput) => runMonthlyDeliveryFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary-slip"] }),
  });
}

export function useDownloadSalarySlip() {
  return useMutation({
    mutationFn: (v: { salarySlipId: number }) => downloadSalarySlipFn({ data: v }),
    onSuccess: (res: { fileName: string; contentType: string; contentBase64: string }) => {
      const bin = atob(res.contentBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: res.contentType }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
}
