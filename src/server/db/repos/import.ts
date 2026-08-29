/**
 * Officeverse — bulk-import persistence (Phase 7). DATA ACCESS ONLY.
 *
 * Writes to the pre-existing `imports` / `import_rows` / `import_errors`
 * tables (Phase 1). Also provides the batch existing-Lead lookups the planner
 * needs (identity = normalised phone; plus lead-code lookup for follow-up
 * imports). No authorization here.
 */
import { eq, inArray } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  imports,
  importErrors,
  importRows,
  leads,
  type ImportBatch,
  type NewImportBatch,
  type NewImportError,
  type NewImportRow,
} from "@/lib/db/schema";

export async function createImportBatch(
  values: NewImportBatch,
  ex: DBX = getDb(),
): Promise<ImportBatch> {
  const res = await ex.insert(imports).values(values);
  const insertId = Number((res as unknown as { insertId?: number | string }).insertId ?? 0);
  const rows = await ex
    .select()
    .from(imports)
    .where(inArray(imports.id, [insertId]));
  if (!rows[0]) throw new Error("Import batch insert did not return a row");
  return rows[0];
}

export async function updateImportBatch(
  id: number,
  patch: Partial<NewImportBatch>,
  ex: DBX = getDb(),
): Promise<void> {
  await ex.update(imports).set(patch).where(eq(imports.id, id));
}

export async function insertImportRows(rows: NewImportRow[], ex: DBX = getDb()): Promise<void> {
  if (!rows.length) return;
  // chunk to keep the statement size sane for large files
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await ex.insert(importRows).values(rows.slice(i, i + CHUNK));
  }
}

export async function insertImportErrors(rows: NewImportError[], ex: DBX = getDb()): Promise<void> {
  if (!rows.length) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await ex.insert(importErrors).values(rows.slice(i, i + CHUNK));
  }
}

export interface ExistingLeadRow {
  id: number;
  code: string;
  agentId: number | null;
  /** customer snapshot — used when a follow-up import attaches to this Lead */
  customerName: string;
  phone: string;
  phoneNormalized: string | null;
  email: string | null;
  emailNormalized: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  debtAmount: string;
  creditStatus: string | null;
  currentDebts: "Current" | "Late";
}

const EXISTING_LEAD_COLS = {
  id: leads.id,
  code: leads.leadCode,
  agentId: leads.agentId,
  customerName: leads.customerName,
  phone: leads.phone,
  phoneNormalized: leads.phoneNormalized,
  email: leads.email,
  emailNormalized: leads.emailNormalized,
  address: leads.address,
  city: leads.city,
  state: leads.state,
  zip: leads.zip,
  debtAmount: leads.debtAmount,
  creditStatus: leads.creditStatus,
  currentDebts: leads.currentDebts,
} as const;

/** Existing leads whose normalised phone is in `phones` (Lead identity key). */
export async function findLeadsByPhones(
  phones: string[],
  ex: DBX = getDb(),
): Promise<ExistingLeadRow[]> {
  const unique = [...new Set(phones.filter(Boolean))];
  if (!unique.length) return [];
  return ex.select(EXISTING_LEAD_COLS).from(leads).where(inArray(leads.phoneNormalized, unique));
}

export async function findLeadsByCodes(
  codes: string[],
  ex: DBX = getDb(),
): Promise<ExistingLeadRow[]> {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return [];
  return ex.select(EXISTING_LEAD_COLS).from(leads).where(inArray(leads.leadCode, unique));
}
