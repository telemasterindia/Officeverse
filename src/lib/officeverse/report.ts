/**
 * Officeverse — Reports export shared types. PURE (no server imports), so both
 * the server service and the client hooks/route can use them.
 */

export const REPORT_PROCESSES = ["ALL", "US", "UK", "IN", "AU"] as const;
export type ReportProcess = (typeof REPORT_PROCESSES)[number];

export interface ReportEmployee {
  code: string;
  name: string;
  role: "agent" | "closer";
}

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  process: ReportProcess;
  /** "ALL" or an Agent ID / Closer ID */
  employee: string;
}
