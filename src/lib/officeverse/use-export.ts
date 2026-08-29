/**
 * Officeverse — Admin export hooks (Phase 8). React Query wrappers.
 * The download mutation decodes the base64 payload into a Blob and saves it.
 */
import { useMutation } from "@tanstack/react-query";
import { exportDownloadFn, exportPreviewFn } from "./export-fns";
import type { ExportDatasetKey, ExportFormat } from "@/lib/officeverse/export/datasets";

export interface ExportFilters {
  dateFrom?: string;
  dateTo?: string;
  dateField?: string;
  status?: string;
  followUpStatus?: string;
  outcome?: string;
  action?: string;
  type?: string;
  ownerRole?: string;
  agentCode?: string;
  closerCode?: string;
  state?: string;
  zip?: string;
  source?: string;
  leadCode?: string;
  followUpCode?: string;
}

export interface ExportPreview {
  dataset: string;
  count: number;
  capped: boolean;
  maxRows: number;
  filters: Record<string, string>;
}

export function useExportPreview() {
  return useMutation<ExportPreview, Error, { dataset: ExportDatasetKey; filters: ExportFilters }>({
    mutationFn: (v) => exportPreviewFn({ data: v }),
  });
}

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

export function useExportDownload() {
  return useMutation<
    { fileName: string; rowCount: number },
    Error,
    { dataset: ExportDatasetKey; format: ExportFormat; filters: ExportFilters }
  >({
    mutationFn: async (v) => {
      const res = await exportDownloadFn({ data: v });
      saveBase64(res.fileName, res.mime, res.base64);
      return { fileName: res.fileName, rowCount: res.rowCount };
    },
  });
}
