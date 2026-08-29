/**
 * Officeverse — Admin export catalog (Phase 8). PURE, server-authoritative.
 *
 * The SERVER defines every exportable dataset and its exact columns. The client
 * chooses only { dataset, format, filters } — never a table or a column list.
 *
 * Columns are hand-picked business fields that EXIST on the current schema.
 * Secrets / auth material (password_hash, session data, tokens) are never
 * listed here and never selected by the queries.
 */

export type ExportDatasetKey =
  | "leads"
  | "followups"
  | "combined"
  | "lead_assignments"
  | "followup_history"
  | "imports"
  | "agents"
  | "closers"
  | "clients";

export type ExportFormat = "xlsx" | "csv";

export interface ColumnDef {
  key: string;
  header: string;
  /** render + store as TEXT (codes, phones, ZIPs — no numeric coercion) */
  text?: boolean;
}

export type FilterKey =
  | "dateFrom"
  | "dateTo"
  | "dateField"
  | "status"
  | "followUpStatus"
  | "outcome"
  | "action"
  | "type"
  | "ownerRole"
  | "agentCode"
  | "closerCode"
  | "state"
  | "zip"
  | "source"
  | "leadCode"
  | "followUpCode";

export interface DatasetDef {
  key: ExportDatasetKey;
  label: string;
  sheetName: string;
  columns: ColumnDef[];
  filters: FilterKey[];
  /** which date column a dateFrom/dateTo range applies to */
  dateFields: Array<{ value: string; label: string; kind: "calendar" | "shift" }>;
}

const LEAD_COLUMNS: ColumnDef[] = [
  { key: "lead_id", header: "Lead ID", text: true },
  { key: "customer_name", header: "Customer name" },
  { key: "phone", header: "Phone", text: true },
  { key: "email", header: "Email" },
  { key: "address", header: "Address" },
  { key: "city", header: "City" },
  { key: "state", header: "State" },
  { key: "zip", header: "ZIP", text: true },
  { key: "debt_amount", header: "Debt amount" },
  { key: "credit_status", header: "Credit status" },
  { key: "current_debts", header: "Current / Late" },
  { key: "status", header: "Status" },
  { key: "source", header: "Source" },
  { key: "agent_code", header: "Agent ID", text: true },
  { key: "agent_name", header: "Agent" },
  { key: "closer_code", header: "Closer ID", text: true },
  { key: "closer_name", header: "Closer" },
  { key: "shift_date", header: "Shift date (operational)" },
  { key: "converted_from_follow_up", header: "Converted from Follow-up", text: true },
  { key: "created_at", header: "Created at" },
  { key: "updated_at", header: "Updated at" },
];

const FOLLOWUP_COLUMNS: ColumnDef[] = [
  { key: "follow_up_id", header: "Follow-up ID", text: true },
  { key: "lead_id", header: "Lead ID", text: true },
  { key: "owner_role", header: "Owner role" },
  { key: "owner_name", header: "Owner" },
  { key: "customer_name", header: "Customer name" },
  { key: "phone", header: "Phone", text: true },
  { key: "email", header: "Email" },
  { key: "state", header: "State" },
  { key: "zip", header: "ZIP", text: true },
  { key: "scheduled_date", header: "Follow-up date" },
  { key: "scheduled_time", header: "Follow-up time", text: true },
  { key: "status", header: "Status" },
  { key: "comment", header: "Notes" },
  { key: "capture_date", header: "Capture date (shift)" },
  { key: "converted_lead_code", header: "Converted Lead ID", text: true },
  { key: "converted_at", header: "Converted at" },
  { key: "completed_at", header: "Completed at" },
  { key: "cancelled_at", header: "Cancelled at" },
  { key: "source", header: "Source" },
  { key: "created_at", header: "Created at" },
  { key: "updated_at", header: "Updated at" },
];

const COMBINED_COLUMNS: ColumnDef[] = [
  { key: "lead_id", header: "Lead ID", text: true },
  { key: "lead_customer_name", header: "Lead customer" },
  { key: "lead_phone", header: "Lead phone", text: true },
  { key: "lead_email", header: "Lead email" },
  { key: "lead_state", header: "State" },
  { key: "lead_zip", header: "ZIP", text: true },
  { key: "lead_status", header: "Lead status" },
  { key: "lead_source", header: "Lead source" },
  { key: "agent_code", header: "Agent ID", text: true },
  { key: "agent_name", header: "Agent" },
  { key: "closer_code", header: "Closer ID", text: true },
  { key: "closer_name", header: "Closer" },
  { key: "lead_shift_date", header: "Lead shift date" },
  { key: "lead_created_at", header: "Lead created at" },
  { key: "follow_up_id", header: "Follow-up ID", text: true },
  { key: "follow_up_owner_role", header: "Follow-up owner role" },
  { key: "follow_up_owner_name", header: "Follow-up owner" },
  { key: "follow_up_scheduled_date", header: "Follow-up date" },
  { key: "follow_up_scheduled_time", header: "Follow-up time", text: true },
  { key: "follow_up_status", header: "Follow-up status" },
  { key: "follow_up_comment", header: "Follow-up notes" },
  { key: "follow_up_created_at", header: "Follow-up created at" },
];

const LEAD_ASSIGNMENT_COLUMNS: ColumnDef[] = [
  { key: "lead_id", header: "Lead ID", text: true },
  { key: "action", header: "Action" },
  { key: "from_closer_code", header: "From closer", text: true },
  { key: "to_closer_code", header: "To closer", text: true },
  { key: "by_user_name", header: "By" },
  { key: "note", header: "Note" },
  { key: "created_at", header: "When" },
];

const FOLLOWUP_HISTORY_COLUMNS: ColumnDef[] = [
  { key: "follow_up_id", header: "Follow-up ID", text: true },
  { key: "attempt_no", header: "Attempt #" },
  { key: "scheduled_at", header: "Scheduled at" },
  { key: "outcome", header: "Outcome" },
  { key: "note", header: "Note" },
  { key: "related_lead_code", header: "Related Lead ID", text: true },
  { key: "recorded_by_name", header: "Recorded by" },
  { key: "recorded_at", header: "Recorded at" },
];

const IMPORT_COLUMNS: ColumnDef[] = [
  { key: "import_id", header: "Import ID", text: true },
  { key: "file_name", header: "File name" },
  { key: "type", header: "Type" },
  { key: "uploaded_by_name", header: "Imported by" },
  { key: "status", header: "Status" },
  { key: "total_rows", header: "Total rows" },
  { key: "valid_rows", header: "Valid rows" },
  { key: "invalid_rows", header: "Invalid rows" },
  { key: "new_rows", header: "New" },
  { key: "duplicate_rows", header: "Duplicates" },
  { key: "skipped_rows", header: "Skipped" },
  { key: "error_rows", header: "Error rows" },
  { key: "success_count", header: "Records created" },
  { key: "error_count", header: "Errors" },
  { key: "created_at", header: "Started" },
  { key: "committed_at", header: "Completed" },
];

const STAFF_COLUMNS = (codeHeader: string): ColumnDef[] => [
  { key: "code", header: codeHeader, text: true },
  { key: "name", header: "Name" },
  { key: "email", header: "Email" },
  { key: "role", header: "Role" },
  { key: "status", header: "Status" },
  { key: "process", header: "Process" },
  { key: "phone", header: "Phone", text: true },
  { key: "registered_on", header: "Registered on (shift date)" },
  { key: "created_at", header: "Created at" },
];

const CLIENT_COLUMNS: ColumnDef[] = [
  { key: "client_code", header: "Client ID", text: true },
  { key: "name", header: "Name" },
  { key: "contact_name", header: "Contact" },
  { key: "email", header: "Email" },
  { key: "phone", header: "Phone", text: true },
  { key: "address", header: "Address" },
  { key: "status", header: "Status" },
  { key: "registered_on", header: "Registered on" },
  { key: "created_at", header: "Created at" },
];

const CAL = { value: "created", label: "Created date (calendar)", kind: "calendar" as const };
const SHIFT = { value: "shift", label: "Shift date (operational)", kind: "shift" as const };

export const EXPORT_DATASETS: Record<ExportDatasetKey, DatasetDef> = {
  leads: {
    key: "leads",
    label: "Leads",
    sheetName: "Leads",
    columns: LEAD_COLUMNS,
    filters: [
      "dateFrom",
      "dateTo",
      "dateField",
      "status",
      "agentCode",
      "closerCode",
      "state",
      "zip",
      "source",
    ],
    dateFields: [
      CAL,
      SHIFT,
      { value: "updated", label: "Updated date (calendar)", kind: "calendar" },
    ],
  },
  followups: {
    key: "followups",
    label: "Follow-ups",
    sheetName: "Follow-ups",
    columns: FOLLOWUP_COLUMNS,
    filters: [
      "dateFrom",
      "dateTo",
      "dateField",
      "followUpStatus",
      "ownerRole",
      "agentCode",
      "closerCode",
      "leadCode",
    ],
    dateFields: [
      { value: "scheduled", label: "Scheduled date (calendar)", kind: "calendar" },
      { value: "capture", label: "Capture date (shift)", kind: "shift" },
      CAL,
    ],
  },
  combined: {
    key: "combined",
    label: "Leads + Follow-ups (combined)",
    sheetName: "Leads+FollowUps",
    columns: COMBINED_COLUMNS,
    filters: [
      "dateFrom",
      "dateTo",
      "dateField",
      "status",
      "followUpStatus",
      "agentCode",
      "closerCode",
      "state",
      "zip",
      "source",
    ],
    dateFields: [CAL, SHIFT],
  },
  lead_assignments: {
    key: "lead_assignments",
    label: "Lead assignment history",
    sheetName: "LeadAssignments",
    columns: LEAD_ASSIGNMENT_COLUMNS,
    filters: ["dateFrom", "dateTo", "action", "leadCode", "closerCode"],
    dateFields: [{ value: "created", label: "When (calendar)", kind: "calendar" }],
  },
  followup_history: {
    key: "followup_history",
    label: "Follow-up history (attempts)",
    sheetName: "FollowUpHistory",
    columns: FOLLOWUP_HISTORY_COLUMNS,
    filters: ["dateFrom", "dateTo", "outcome", "followUpCode"],
    dateFields: [{ value: "recorded", label: "Recorded at (calendar)", kind: "calendar" }],
  },
  imports: {
    key: "imports",
    label: "Import history",
    sheetName: "Imports",
    columns: IMPORT_COLUMNS,
    filters: ["dateFrom", "dateTo", "type", "status"],
    dateFields: [{ value: "created", label: "Started (calendar)", kind: "calendar" }],
  },
  agents: {
    key: "agents",
    label: "Agents",
    sheetName: "Agents",
    columns: STAFF_COLUMNS("Agent ID"),
    filters: ["dateFrom", "dateTo", "status"],
    dateFields: [{ value: "registered", label: "Registered on (shift date)", kind: "shift" }, CAL],
  },
  closers: {
    key: "closers",
    label: "Closers",
    sheetName: "Closers",
    columns: STAFF_COLUMNS("Closer ID"),
    filters: ["dateFrom", "dateTo", "status"],
    dateFields: [{ value: "registered", label: "Registered on (shift date)", kind: "shift" }, CAL],
  },
  clients: {
    key: "clients",
    label: "Clients",
    sheetName: "Clients",
    columns: CLIENT_COLUMNS,
    filters: ["dateFrom", "dateTo", "status"],
    dateFields: [{ value: "registered", label: "Registered on", kind: "calendar" }, CAL],
  },
};

export const EXPORT_DATASET_KEYS = Object.keys(EXPORT_DATASETS) as ExportDatasetKey[];

/** hard ceiling on a single export (rows). Beyond this → narrow the filters. */
export const MAX_EXPORT_ROWS = 50_000;
/** rows fetched per internal DB page while assembling the file */
export const EXPORT_BATCH_SIZE = 1_000;

const SECRET_RE = /(password|passwd|pwd|hash|secret|token|salt|session|credential|api[_-]?key)/i;

/** guard: no column in the catalog may look like a secret */
export function catalogIsSafe(): boolean {
  return EXPORT_DATASET_KEYS.every((k) =>
    EXPORT_DATASETS[k].columns.every((c) => !SECRET_RE.test(c.key) && !SECRET_RE.test(c.header)),
  );
}
