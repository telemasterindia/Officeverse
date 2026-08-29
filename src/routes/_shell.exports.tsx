import { createFileRoute } from "@tanstack/react-router";
import { Download, FileSpreadsheet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import {
  EXPORT_DATASETS,
  EXPORT_DATASET_KEYS,
  MAX_EXPORT_ROWS,
  type ExportDatasetKey,
  type ExportFormat,
  type FilterKey,
} from "@/lib/officeverse/export/datasets";
import {
  useExportDownload,
  useExportPreview,
  type ExportFilters,
} from "@/lib/officeverse/use-export";
import { useSession } from "@/lib/officeverse/session";

export const Route = createFileRoute("/_shell/exports")({
  head: () => ({ meta: [{ title: "Data Export — TeleMaster India" }] }),
  component: ExportsPage,
});

const TEXT_FILTERS: Partial<Record<FilterKey, { label: string; placeholder: string }>> = {
  status: { label: "Status", placeholder: "e.g. NEW" },
  followUpStatus: { label: "Follow-up status", placeholder: "e.g. SCHEDULED" },
  outcome: { label: "Outcome", placeholder: "e.g. RESCHEDULED" },
  action: { label: "Action", placeholder: "assign / reassign / unassign" },
  type: { label: "Import type", placeholder: "leads / follow_ups / workbook" },
  ownerRole: { label: "Owner role", placeholder: "agent / closer" },
  agentCode: { label: "Agent ID", placeholder: "AG-00001" },
  closerCode: { label: "Closer ID", placeholder: "CL-00001" },
  state: { label: "State", placeholder: "TX" },
  zip: { label: "ZIP", placeholder: "78701" },
  source: { label: "Source", placeholder: "app / import / conversion" },
  leadCode: { label: "Lead ID", placeholder: "TMI_00012007" },
  followUpCode: { label: "Follow-up ID", placeholder: "FU_00004415" },
};

function ExportsPage() {
  const { user } = useSession();
  const [dataset, setDataset] = useState<ExportDatasetKey>("leads");
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [filters, setFilters] = useState<ExportFilters>({});

  const preview = useExportPreview();
  const download = useExportDownload();

  const def = EXPORT_DATASETS[dataset];
  const dateFields = def.dateFields;

  const setF = (k: keyof ExportFilters, v: string) =>
    setFilters((prev) => {
      const next = { ...prev };
      if (v.trim()) next[k] = v.trim();
      else delete next[k];
      return next;
    });

  const changeDataset = (d: ExportDatasetKey) => {
    setDataset(d);
    setFilters({});
    preview.reset();
    download.reset();
  };

  const textFilterKeys = useMemo(
    () => def.filters.filter((k): k is FilterKey => k in TEXT_FILTERS),
    [def.filters],
  );

  if (user?.role !== "admin") {
    return (
      <div className="space-y-6">
        <PageHeader title="Data Export" description="Download Officeverse operational data." />
        <EmptyState
          emoji="🔒"
          title="Admins only"
          message="Data export is restricted to Admin accounts."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Export"
        description="Filtered XLSX / CSV exports of Officeverse operational data. Admin only."
      />

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <SectionCard title="Build an export">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-semibold">Dataset</span>
                <select
                  className="w-full rounded-lg border border-border bg-card px-3 py-2"
                  value={dataset}
                  onChange={(e) => changeDataset(e.target.value as ExportDatasetKey)}
                >
                  {EXPORT_DATASET_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {EXPORT_DATASETS[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold">Format</span>
                <select
                  className="w-full rounded-lg border border-border bg-card px-3 py-2"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as ExportFormat)}
                >
                  <option value="xlsx">Excel (.xlsx) — recommended</option>
                  <option value="csv">CSV (.csv)</option>
                </select>
              </label>
            </div>

            {def.filters.includes("dateFrom") ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-sm">
                  <span className="font-semibold">Date field</span>
                  <select
                    className="w-full rounded-lg border border-border bg-card px-3 py-2"
                    value={filters.dateField ?? dateFields[0]?.value ?? ""}
                    onChange={(e) => setF("dateField", e.target.value)}
                  >
                    {dateFields.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-semibold">From</span>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2"
                    value={filters.dateFrom ?? ""}
                    onChange={(e) => setF("dateFrom", e.target.value)}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-semibold">To</span>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2"
                    value={filters.dateTo ?? ""}
                    onChange={(e) => setF("dateTo", e.target.value)}
                  />
                </label>
              </div>
            ) : null}

            {textFilterKeys.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {textFilterKeys.map((k) => {
                  const cfg = TEXT_FILTERS[k]!;
                  return (
                    <label key={k} className="space-y-1 text-sm">
                      <span className="font-semibold">{cfg.label}</span>
                      <input
                        className="w-full rounded-lg border border-border bg-card px-3 py-2"
                        placeholder={cfg.placeholder}
                        value={(filters[k as keyof ExportFilters] as string) ?? ""}
                        onChange={(e) => setF(k as keyof ExportFilters, e.target.value)}
                      />
                    </label>
                  );
                })}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="outline"
                className="rounded-lg"
                disabled={preview.isPending}
                onClick={() =>
                  preview.mutate(
                    { dataset, filters },
                    { onError: () => toast.error("Could not count matching rows.") },
                  )
                }
              >
                {preview.isPending ? "Counting…" : "Preview count"}
              </Button>
              <Button
                className="rounded-lg"
                disabled={download.isPending}
                onClick={() =>
                  download.mutate(
                    { dataset, format, filters },
                    {
                      onSuccess: (r) =>
                        toast.success("Export ready", {
                          description: `${r.fileName} · ${r.rowCount} rows`,
                        }),
                      onError: (e) => toast.error(e.message || "Export failed"),
                    },
                  )
                }
              >
                <Download className="mr-1.5 h-4 w-4" />
                {download.isPending ? "Preparing…" : `Download ${format.toUpperCase()}`}
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Summary">
          <div className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Export type: </span>
              <span className="font-semibold">{def.label}</span>
            </p>
            <p className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">{def.columns.length} columns</span>
            </p>
            {preview.data ? (
              <div className="rounded-xl border border-border bg-secondary/40 p-3">
                <p className="font-display text-2xl font-black">
                  {preview.data.capped
                    ? `${MAX_EXPORT_ROWS.toLocaleString()}+`
                    : preview.data.count.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  matching rows
                  {preview.data.capped
                    ? ` — over the ${MAX_EXPORT_ROWS.toLocaleString()} limit; narrow the filters`
                    : ""}
                </p>
                {Object.keys(preview.data.filters).length ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Filters:{" "}
                    {Object.entries(preview.data.filters)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" · ")}
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">No filters applied.</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Run “Preview count” to see how many rows match before downloading. Exports are
                capped at {MAX_EXPORT_ROWS.toLocaleString()} rows.
              </p>
            )}
            {download.isError ? (
              <p className="text-xs font-semibold text-destructive">{download.error.message}</p>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
