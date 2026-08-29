/**
 * Officeverse — Zod schemas for the Admin export server functions (Phase 8).
 *
 * The client picks a dataset + format + filter values only. It can NEVER pick a
 * table, a column list, or a raw query. Unknown keys (e.g. an injected role /
 * user id) are stripped by Zod.
 */
import { z } from "zod";
import { EXPORT_DATASET_KEYS } from "@/lib/officeverse/export/datasets";

export const exportDatasetSchema = z.enum(EXPORT_DATASET_KEYS as unknown as [string, ...string[]]);
export const exportFormatSchema = z.enum(["xlsx", "csv"]);

const s = (max: number) => z.string().trim().max(max).optional();

export const exportFiltersSchema = z
  .object({
    dateFrom: s(10),
    dateTo: s(10),
    dateField: s(20),
    status: s(40),
    followUpStatus: s(40),
    outcome: s(40),
    action: s(40),
    type: s(40),
    ownerRole: s(10),
    agentCode: s(24),
    closerCode: s(24),
    state: s(120),
    zip: s(20),
    source: s(40),
    leadCode: s(32),
    followUpCode: s(32),
  })
  .partial()
  .default({});

export const exportRequestSchema = z.object({
  dataset: exportDatasetSchema,
  format: exportFormatSchema,
  filters: exportFiltersSchema,
});
export type ExportRequestInput = z.infer<typeof exportRequestSchema>;

export const exportCountSchema = z.object({
  dataset: exportDatasetSchema,
  filters: exportFiltersSchema,
});
export type ExportCountInput = z.infer<typeof exportCountSchema>;
