/**
 * Officeverse — Admin export service (Phase 8).
 *
 * assertCanExport (ADMIN only) → normalise filters (pure) → parameterised
 * dataset query (bounded, paged) → XLSX / CSV → base64 in an authenticated RPC
 * response. One `export.run` audit row; NO notification, NO per-row events.
 * The generated file is never written to disk or a public folder.
 */
import { recordAudit } from "../audit";
import { assertCanExport } from "../authz/export";
import { HttpError } from "../http-error";
import { nowIST } from "../time";
import { EXPORT_DATASETS, MAX_EXPORT_ROWS } from "@/lib/officeverse/export/datasets";
import { toCsv } from "@/lib/officeverse/export/csv";
import { describeFilters, normalizeExportFilters } from "./filters";
import { cellText } from "@/lib/officeverse/export/format";
import { EXPORT_QUERY } from "./queries";
import { buildXlsx } from "./xlsx";
import type { User } from "@/lib/db/schema";
import type { ExportCountInput, ExportRequestInput } from "../validation/export";

type Meta = { ip?: string | null; userAgent?: string | null };

export interface ExportPreview {
  dataset: string;
  count: number;
  capped: boolean;
  maxRows: number;
  filters: Record<string, string>;
}

export interface ExportFile {
  fileName: string;
  mime: string;
  /** base64 of the file bytes — delivered inside the authenticated RPC response */
  base64: string;
  rowCount: number;
  dataset: string;
  format: "xlsx" | "csv";
}

export async function runExportPreview(
  user: Pick<User, "role">,
  input: ExportCountInput,
): Promise<ExportPreview> {
  assertCanExport(user.role);
  const f = normalizeExportFilters(input.dataset as never, input.filters ?? {});
  const res = await EXPORT_QUERY[input.dataset as keyof typeof EXPORT_QUERY](f);
  return {
    dataset: input.dataset,
    count: res.count,
    capped: res.capped,
    maxRows: MAX_EXPORT_ROWS,
    filters: describeFilters(f),
  };
}

export async function runExport(
  user: Pick<User, "id" | "role">,
  input: ExportRequestInput,
  meta: Meta = {},
): Promise<ExportFile> {
  assertCanExport(user.role);
  const ds = EXPORT_DATASETS[input.dataset as keyof typeof EXPORT_DATASETS];
  const f = normalizeExportFilters(input.dataset as never, input.filters ?? {});
  const res = await EXPORT_QUERY[input.dataset as keyof typeof EXPORT_QUERY](f);

  if (res.capped) {
    throw new HttpError(
      413,
      `This export exceeds ${MAX_EXPORT_ROWS.toLocaleString()} rows. Narrow the filters (date range, status, owner) and try again.`,
      "too_many_rows",
    );
  }

  const stamp = nowIST().slice(0, 10);
  const fileBase = `officeverse-${input.dataset}-${stamp}`;

  let base64: string;
  let mime: string;
  let fileName: string;

  if (input.format === "csv") {
    const headers = ds.columns.map((c) => c.header);
    const rows = res.rows.map((r) => ds.columns.map((c) => cellText(r[c.key])));
    base64 = Buffer.from(toCsv(headers, rows), "utf8").toString("base64");
    mime = "text/csv;charset=utf-8";
    fileName = `${fileBase}.csv`;
  } else {
    const buf = await buildXlsx(ds.sheetName, ds.columns, res.rows);
    base64 = buf.toString("base64");
    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    fileName = `${fileBase}.xlsx`;
  }

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "export.run",
    entityType: "export",
    metadata: {
      dataset: input.dataset,
      format: input.format,
      row_count: res.rows.length,
      filters: describeFilters(f),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return {
    fileName,
    mime,
    base64,
    rowCount: res.rows.length,
    dataset: input.dataset,
    format: input.format,
  };
}
