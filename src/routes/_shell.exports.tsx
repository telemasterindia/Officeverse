import { createFileRoute } from "@tanstack/react-router";
import { Download, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, SectionCard } from "@/components/officeverse/primitives";

export const Route = createFileRoute("/_shell/exports")({
  head: () => ({
    meta: [
      { title: "Exports — TeleMaster India" },
      { name: "description", content: "Build a filtered export of leads or follow-ups and download it as CSV." },
      { property: "og:title", content: "Exports — TeleMaster India" },
      { property: "og:description", content: "Filtered CSV exports with a full download history." },
    ],
  }),
  component: ExportsPage,
});

const COLUMNS = [
  "Lead ID",
  "Customer name",
  "Phone",
  "Debt amount",
  "File name",
  "Submitted by",
  "Assigned closer",
  "Status",
  "Created at",
];

const HISTORY = [
  { file: "leads_us_march.csv", rows: 1284, by: "Amit Chadha", when: "Today, 09:40" },
  { file: "followups_overdue.csv", rows: 217, by: "Amit Chadha", when: "Yesterday, 18:12" },
  { file: "leads_uk_week10.csv", rows: 903, by: "Neha Kapoor", when: "10 Mar, 11:05" },
];

function ExportsPage() {
  const [cols, setCols] = useState<string[]>(COLUMNS.slice(0, 6));
  const toggle = (c: string) => setCols((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  return (
    <div className="space-y-7">
      <PageHeader title="Exports" description="Pick your columns, pick your filters, take the file." />

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <SectionCard title="Build an export">
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Dataset</Label>
                <Select defaultValue="leads">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="leads">Leads</SelectItem>
                    <SelectItem value="followups">Follow-ups</SelectItem>
                    <SelectItem value="attendance">Attendance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Range</Label>
                <Select defaultValue="30">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last quarter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3">
              <Label>Columns ({cols.length})</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {COLUMNS.map((c) => (
                  <label key={c} className="flex items-center gap-2.5 rounded-xl bg-secondary/40 px-3 py-2 text-sm">
                    <Checkbox checked={cols.includes(c)} onCheckedChange={() => toggle(c)} />
                    <span className="min-w-0 truncate">{c}</span>
                  </label>
                ))}
              </div>
            </div>

            <Button
              className="w-full rounded-full py-6 font-bold"
              onClick={() => toast.success("Export ready", { description: `${cols.length} columns · CSV downloaded` })}
            >
              <Download className="mr-2 h-4 w-4" /> Generate CSV
            </Button>
          </div>
        </SectionCard>

        <div className="space-y-5">
          <Card className="surface-panel rounded-2xl border-border/70 p-6">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
              <FileSpreadsheet className="h-8 w-8 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="font-display font-bold">Preview</p>
                <p className="truncate text-xs text-muted-foreground">{cols.join(" · ") || "No columns selected"}</p>
              </div>
            </div>
          </Card>

          <SectionCard title="Export history">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {HISTORY.map((h) => (
                    <TableRow key={h.file}>
                      <TableCell className="font-medium">{h.file}</TableCell>
                      <TableCell>{h.rows}</TableCell>
                      <TableCell className="text-muted-foreground">{h.by}</TableCell>
                      <TableCell className="text-muted-foreground">{h.when}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
