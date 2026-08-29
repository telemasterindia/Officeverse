/**
 * Officeverse — bulk-import mutation hooks (Phase 7). React Query wrappers over
 * the preview/commit server functions.
 */
import { useMutation } from "@tanstack/react-query";
import { commitImportFn, previewImportFn } from "./import-fns";
import type { ImportMode } from "./import/fields";
import type { ColumnMapping } from "./import/mapping";
import type { CommitResult, PreviewResult } from "./import/types";

export interface ImportRequest {
  mode: ImportMode;
  fileName: string;
  mapping: ColumnMapping;
  rows: Array<Record<string, string>>;
}

export function usePreviewImport() {
  return useMutation<PreviewResult, Error, ImportRequest>({
    mutationFn: (req) => previewImportFn({ data: req }),
  });
}

export function useCommitImport() {
  return useMutation<CommitResult, Error, ImportRequest>({
    mutationFn: (req) => commitImportFn({ data: req }),
  });
}
