/**
 * Officeverse — Reports hooks. React Query wrappers around the Reports server
 * functions. The download mutation decodes the base64 payload into a Blob and
 * saves it directly — no extra prompt.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { reportEmployeesFn, reportExportFn } from "./report-fns";
import type { ReportEmployee, ReportFilters, ReportProcess } from "./report";

export type { ReportEmployee, ReportFilters, ReportProcess };

function saveBase64(fileName: string, mime: string, base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function useReportEmployees(enabled = true) {
  return useQuery<ReportEmployee[]>({
    queryKey: ["report-employees"],
    queryFn: () => reportEmployeesFn(),
    enabled,
    staleTime: 60_000,
  });
}

export function useReportDownload() {
  return useMutation<
    { fileName: string; rowCount: number },
    Error,
    ReportFilters & { format?: "xlsx" | "csv" }
  >({
    mutationFn: async (v) => {
      const res = await reportExportFn({
        data: {
          ...(v.dateFrom ? { dateFrom: v.dateFrom } : {}),
          ...(v.dateTo ? { dateTo: v.dateTo } : {}),
          process: v.process,
          employee: v.employee || "ALL",
          format: v.format ?? "xlsx",
        },
      });
      saveBase64(res.fileName, res.mime, res.base64);
      return { fileName: res.fileName, rowCount: res.rowCount };
    },
  });
}
