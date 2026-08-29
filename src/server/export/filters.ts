/**
 * Officeverse — export filter normalisation (Phase 8). PURE. No DB, no SQL.
 *
 * Takes the raw client filter object and returns a typed filter keeping ONLY
 * the keys the chosen dataset allows. Values are validated/trimmed here;
 * the query layer feeds them to drizzle helpers (eq / gte / lte / like) which
 * bind them as parameters — user input is never concatenated into SQL.
 */
import {
  EXPORT_DATASETS,
  type ExportDatasetKey,
  type FilterKey,
} from "@/lib/officeverse/export/datasets";

export interface ExportFilters {
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  dateField?: string;
  status?: string;
  followUpStatus?: string;
  outcome?: string;
  action?: string;
  type?: string;
  ownerRole?: "agent" | "closer";
  agentCode?: string;
  closerCode?: string;
  state?: string;
  zip?: string;
  source?: string;
  leadCode?: string;
  followUpCode?: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown, max = 120): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

export function normalizeExportFilters(
  dataset: ExportDatasetKey,
  raw: Record<string, unknown> = {},
): ExportFilters {
  const allowed = new Set<FilterKey>(EXPORT_DATASETS[dataset].filters);
  const out: ExportFilters = {};

  if (allowed.has("dateFrom")) {
    const v = str(raw["dateFrom"]);
    if (v && YMD.test(v)) out.dateFrom = v;
  }
  if (allowed.has("dateTo")) {
    const v = str(raw["dateTo"]);
    if (v && YMD.test(v)) out.dateTo = v;
  }
  if (allowed.has("dateField")) {
    const v = str(raw["dateField"], 20);
    const valid = EXPORT_DATASETS[dataset].dateFields.map((d) => d.value);
    if (v && valid.includes(v)) out.dateField = v;
  }
  const put = (key: keyof ExportFilters, filterKey: FilterKey, max: number, upper = false) => {
    if (!allowed.has(filterKey)) return;
    const v = str(raw[filterKey], max);
    if (v) (out[key] as string | undefined) = upper ? v.toUpperCase() : v;
  };

  put("status", "status", 40);
  put("followUpStatus", "followUpStatus", 40);
  put("outcome", "outcome", 40);
  put("action", "action", 40);
  put("type", "type", 40);
  if (allowed.has("ownerRole")) {
    const v = str(raw["ownerRole"], 10);
    if (v === "agent" || v === "closer") out.ownerRole = v;
  }
  put("agentCode", "agentCode", 24, true);
  put("closerCode", "closerCode", 24, true);
  put("state", "state", 120);
  put("zip", "zip", 20);
  put("source", "source", 40);
  put("leadCode", "leadCode", 32, true);
  put("followUpCode", "followUpCode", 32, true);

  return out;
}

/** Human-readable summary of the applied filters (for the audit log + UI). */
export function describeFilters(f: ExportFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v) out[k] = String(v);
  return out;
}
