import { createFileRoute } from "@tanstack/react-router";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { fieldsForMode, type ImportMode } from "@/lib/officeverse/import/fields";
import {
  analyzeMapping,
  autoDetectMapping,
  isMappingComplete,
  type ColumnMapping,
} from "@/lib/officeverse/import/mapping";
import { ImportFileError, parseImportFile, type ParsedFile } from "@/lib/officeverse/import/parse";
import { templateCsv, templateFileName } from "@/lib/officeverse/import/template";
import type { CommitResult, PreviewResult, RowIssue } from "@/lib/officeverse/import/types";
import { useCommitImport, usePreviewImport } from "@/lib/officeverse/use-import";
import { useSession } from "@/lib/officeverse/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/imports")({
  head: () => ({ meta: [{ title: "Bulk Import — TeleMaster India" }] }),
  component: ImportsPage,
});

const MODE_LABEL: Record<ImportMode, string> = {
  leads: "Leads only",
  leads_followups: "Leads + Follow-ups",
  followups: "Follow-ups for existing Leads",
};

type Step = "upload" | "map" | "preview" | "done";

function downloadCsv(name: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function issuesToCsv(issues: RowIssue[]): string {
  const head = "row,field,code,severity,message\r\n";
  const body = issues
    .map((i) =>
      [i.rowNumber, i.field ?? "", i.code, i.severity, `"${i.message.replace(/"/g, '""')}"`].join(
        ",",
      ),
    )
    .join("\r\n");
  return head + body + "\r\n";
}

function ImportsPage() {
  const { user } = useSession();
  const [step, setStep] = useState<Step>("upload");
  const [mode, setMode] = useState<ImportMode>("leads_followups");
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  const previewMut = usePreviewImport();
  const commitMut = useCommitImport();

  const fields = useMemo(() => fieldsForMode(mode), [mode]);
  const mappingReport = useMemo(
    () => (parsed ? analyzeMapping(mapping, parsed.headers, mode) : null),
    [mapping, parsed, mode],
  );

  const authorized = user?.role === "admin" || user?.role === "agent";

  if (!authorized) {
    return (
      <div className="space-y-6">
        <PageHeader title="Bulk Import" description="Upload existing Leads and Follow-ups." />
        <EmptyState
          emoji="🔒"
          title="Not available"
          message="Bulk import is for Agents and Admins."
        />
      </div>
    );
  }

  const reset = () => {
    setStep("upload");
    setParsed(null);
    setMapping({});
    setPreview(null);
    setResult(null);
    setParseErr(null);
    previewMut.reset();
    commitMut.reset();
  };

  const onFile = async (file: File) => {
    setParseErr(null);
    try {
      const p = await parseImportFile(file);
      setParsed(p);
      setMapping(autoDetectMapping(p.headers, mode));
      setStep("map");
      if (p.truncated) toast.warning(`Only the first ${p.rowCount} rows were read.`);
    } catch (e) {
      setParseErr(e instanceof ImportFileError ? e.message : "Could not read this file.");
    }
  };

  const runPreview = () => {
    if (!parsed) return;
    previewMut.mutate(
      { mode, fileName: parsed.fileName, mapping, rows: parsed.rows },
      {
        onSuccess: (r) => {
          setPreview(r);
          setStep("preview");
        },
        onError: () => toast.error("Preview failed — check your session and try again."),
      },
    );
  };

  const runCommit = () => {
    if (!parsed) return;
    commitMut.mutate(
      { mode, fileName: parsed.fileName, mapping, rows: parsed.rows },
      {
        onSuccess: (r) => {
          setResult(r);
          setStep("done");
        },
        onError: () => toast.error("Import failed."),
      },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bulk Import"
        description="Upload existing Leads and their Follow-ups from a .csv or .xlsx file."
        actions={
          <Button
            variant="outline"
            className="rounded-lg"
            onClick={() => downloadCsv(templateFileName(mode), templateCsv(mode))}
          >
            <Download className="mr-1.5 h-4 w-4" /> Template
          </Button>
        }
      />

      <ol className="flex flex-wrap gap-2 text-xs font-semibold">
        {(["upload", "map", "preview", "done"] as Step[]).map((s, i) => (
          <li
            key={s}
            className={cn(
              "rounded-full border px-3 py-1 capitalize",
              step === s
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground",
            )}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === "upload" ? (
        <SectionCard title="1 · Choose a file">
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold">Import type</label>
              <select
                className="w-full max-w-sm rounded-lg border border-border bg-card px-3 py-2 text-sm"
                value={mode}
                onChange={(e) => setMode(e.target.value as ImportMode)}
              >
                {(Object.keys(MODE_LABEL) as ImportMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-secondary/30 px-6 py-10 text-center hover:bg-secondary/50">
              <Upload className="h-6 w-6" aria-hidden />
              <span className="mt-2 text-sm font-semibold">Select a .csv or .xlsx file</span>
              <span className="mt-1 text-xs text-muted-foreground">Max 8 MB / 20,000 rows</span>
              <input
                type="file"
                accept=".csv,.xlsx"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </label>
            {parseErr ? <p className="text-sm font-semibold text-destructive">{parseErr}</p> : null}
          </div>
        </SectionCard>
      ) : null}

      {step === "map" && parsed && mappingReport ? (
        <SectionCard title={`2 · Map columns — ${parsed.fileName} (${parsed.rowCount} rows)`}>
          <div className="space-y-4">
            <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-secondary/60 text-left text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2">Officeverse field</th>
                    <th className="px-3 py-2">Spreadsheet column</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => {
                    const required = f.requiredIn.includes(mode);
                    return (
                      <tr key={f.key} className="border-t border-border/60">
                        <td className="px-3 py-2">
                          <span className="font-medium">{f.label}</span>
                          {required ? <span className="ml-1 text-destructive">*</span> : null}
                          {f.note ? (
                            <span className="block text-[11px] text-muted-foreground">
                              {f.note}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="w-full rounded-md border border-border bg-card px-2 py-1"
                            value={mapping[f.key] ?? ""}
                            onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                          >
                            <option value="">— not mapped —</option>
                            {parsed.headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {mappingReport.missingRequired.length ? (
              <p className="text-sm font-semibold text-destructive">
                Map the required fields: {mappingReport.missingRequired.join(", ")}
              </p>
            ) : null}
            {mappingReport.duplicateHeaders.length ? (
              <p className="text-sm text-warning">
                Column mapped twice: {mappingReport.duplicateHeaders.join(", ")}
              </p>
            ) : null}
            {mappingReport.unmappedHeaders.length ? (
              <p className="text-xs text-muted-foreground">
                Unmapped columns (ignored): {mappingReport.unmappedHeaders.join(", ")}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button variant="outline" className="rounded-lg" onClick={reset}>
                Start over
              </Button>
              <Button
                className="rounded-lg"
                disabled={!isMappingComplete(mappingReport) || previewMut.isPending}
                onClick={runPreview}
              >
                {previewMut.isPending ? "Validating…" : "Preview import"}
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {step === "preview" && preview ? (
        <SectionCard title="3 · Preview">
          <div className="space-y-4">
            <CountGrid preview={preview} />
            {preview.truncated ? (
              <p className="text-xs text-muted-foreground">
                Showing the first {preview.rows.length} rows.
              </p>
            ) : null}
            <div className="max-h-[380px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-secondary/60 text-left text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Outcome</th>
                    <th className="px-3 py-2">Lead</th>
                    <th className="px-3 py-2">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-border/60 align-top">
                      <td className="px-3 py-2">{r.rowNumber}</td>
                      <td className="px-3 py-2">
                        <DecisionBadge decision={r.decision} />
                      </td>
                      <td className="px-3 py-2">{r.leadName ?? r.leadCode ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.issues.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          r.issues.map((i, idx) => (
                            <span
                              key={idx}
                              className={cn(
                                "block",
                                i.severity === "error" ? "text-destructive" : "text-warning",
                              )}
                            >
                              {i.field ? `${i.field}: ` : ""}
                              {i.message}
                            </span>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-lg" onClick={() => setStep("map")}>
                Back
              </Button>
              <Button
                className="rounded-lg"
                disabled={!preview.canCommit || commitMut.isPending}
                onClick={runCommit}
              >
                {commitMut.isPending ? "Importing…" : "Commit import"}
              </Button>
            </div>
            {!preview.canCommit ? (
              <p className="text-sm text-muted-foreground">
                Nothing valid to import — fix the file and re-upload.
              </p>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {step === "done" && result ? (
        <SectionCard title="4 · Result">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Rows processed" value={result.rowsProcessed} />
              <Stat label="Leads created" value={result.leadsCreated} />
              <Stat label="Existing (skipped)" value={result.leadsSkippedExisting} />
              <Stat label="Leads rejected" value={result.leadsRejected} />
              <Stat label="Follow-ups created" value={result.followUpsCreated} />
              <Stat label="Follow-ups skipped" value={result.followUpsSkipped} />
              <Stat label="Duplicates" value={result.duplicates} />
              <Stat label="Errors" value={result.errors} tone={result.errors ? "bad" : "ok"} />
            </div>
            <div className="flex flex-wrap gap-2">
              {result.errorReport.length ? (
                <Button
                  variant="outline"
                  className="rounded-lg"
                  onClick={() =>
                    downloadCsv(
                      `import-${result.importId}-errors.csv`,
                      issuesToCsv(result.errorReport),
                    )
                  }
                >
                  <Download className="mr-1.5 h-4 w-4" /> Error report
                </Button>
              ) : null}
              <Button className="rounded-lg" onClick={reset}>
                <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Import another file
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}

function CountGrid({ preview }: { preview: PreviewResult }) {
  const c = preview.counts;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Stat label="Total rows" value={c.totalRows} />
      <Stat label="Valid" value={c.validRows} tone="ok" />
      <Stat label="Invalid" value={c.invalidRows} tone={c.invalidRows ? "bad" : "ok"} />
      <Stat label="New Leads" value={c.newLeads} />
      <Stat label="Existing Leads" value={c.existingLeads} />
      <Stat label="Duplicate rows" value={c.duplicateRows} />
      <Stat label="Follow-ups" value={c.followUpsToCreate} />
      <Stat
        label="Invalid Follow-ups"
        value={c.invalidFollowUps}
        tone={c.invalidFollowUps ? "bad" : "ok"}
      />
      <Stat
        label="Ownership issues"
        value={c.ownershipIssues}
        tone={c.ownershipIssues ? "bad" : "ok"}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "bad" }) {
  return (
    <Card className="rounded-xl border-border bg-card p-3 shadow-sm">
      <p
        className={cn(
          "font-display text-xl font-black",
          tone === "bad" && value > 0 && "text-destructive",
          tone === "ok" && "text-success",
        )}
      >
        {value}
      </p>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </Card>
  );
}

function DecisionBadge({ decision }: { decision: PreviewResult["rows"][number]["decision"] }) {
  const map: Record<string, string> = {
    new: "bg-success/15 text-success",
    existing: "bg-secondary text-foreground",
    duplicate: "bg-warning/15 text-warning",
    error: "bg-destructive/15 text-destructive",
    skip: "bg-secondary text-muted-foreground",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold uppercase", map[decision])}>
      {decision}
    </span>
  );
}
