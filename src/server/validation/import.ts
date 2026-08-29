/**
 * Officeverse — Zod schemas for the bulk-import server functions (Phase 7).
 *
 * The client sends already-parsed rows (header-keyed strings) + the chosen
 * column mapping + the mode. The SERVER re-normalises and re-validates every
 * cell — this schema only bounds the payload shape and size.
 */
import { z } from "zod";
import type { ImportMode } from "@/lib/officeverse/import/fields";

export const MAX_IMPORT_ROWS = 20_000;

export const importModeSchema: z.ZodType<ImportMode> = z.enum([
  "leads",
  "leads_followups",
  "followups",
]);

/** field key → source header */
const mappingSchema = z.record(z.string().min(1).max(80), z.string().max(255));

/** one raw row: header → cell text (already stringified client-side) */
const rawRowSchema = z.record(z.string().max(255), z.string().max(2000));

export const previewImportSchema = z.object({
  mode: importModeSchema,
  fileName: z.string().trim().min(1).max(255),
  mapping: mappingSchema,
  rows: z.array(rawRowSchema).min(1).max(MAX_IMPORT_ROWS),
});
export type PreviewImportInput = z.infer<typeof previewImportSchema>;

export const commitImportSchema = previewImportSchema;
export type CommitImportInput = z.infer<typeof commitImportSchema>;
