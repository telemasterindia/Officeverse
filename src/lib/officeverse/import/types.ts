/**
 * Officeverse — shared bulk-import DTO types (Phase 7). PURE.
 * Used by the client wizard and returned by the server preview/commit fns.
 */
import type { ImportMode } from "./fields";

export type { ImportMode };

export type RowDecision = "new" | "existing" | "duplicate" | "error" | "skip";

export interface RowIssue {
  rowNumber: number;
  field: string | null;
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface RowPlanSummary {
  rowNumber: number;
  decision: RowDecision;
  leadCode: string | null;
  /** the follow-up(s) this row would create (0 or 1 in Phase 7) */
  createsFollowUp: boolean;
  leadName: string | null;
  issues: RowIssue[];
}

export interface ImportCounts {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  newLeads: number;
  existingLeads: number;
  duplicateRows: number;
  followUpsToCreate: number;
  invalidFollowUps: number;
  ownershipIssues: number;
}

export interface PreviewResult {
  fileName: string;
  mode: ImportMode;
  counts: ImportCounts;
  /** bounded sample of row plans (errors first) */
  rows: RowPlanSummary[];
  issues: RowIssue[];
  truncated: boolean;
  canCommit: boolean;
}

export interface CommitResult {
  importId: number;
  fileName: string;
  mode: ImportMode;
  status: "committed" | "failed";
  rowsProcessed: number;
  leadsCreated: number;
  leadsSkippedExisting: number;
  leadsRejected: number;
  followUpsCreated: number;
  followUpsSkipped: number;
  duplicates: number;
  errors: number;
  warnings: number;
  /** downloadable error report rows */
  errorReport: RowIssue[];
}
