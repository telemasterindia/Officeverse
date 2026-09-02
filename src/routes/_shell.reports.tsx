import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartCard, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import {
  AGENT_ACTIVITY,
  FILE_PERFORMANCE,
  LEAD_STATUS_MIX,
  SUBMISSION_TREND,
} from "@/lib/officeverse/data";
import { REPORT_PROCESSES } from "@/lib/officeverse/report";
import { useReportDownload, useReportEmployees } from "@/lib/officeverse/use-report";

export const Route = createFileRoute("/_shell/reports")({
  head: () => ({
    meta: [
      { title: "Reports — TeleMaster India" },
      {
        name: "description",
        content: "Operational reporting on leads, follow-ups, files and agent output.",
      },
      { property: "og:title", content: "Reports — TeleMaster India" },
      {
        property: "og:description",
        content: "Slice performance by file, agent, process and date.",
      },
    ],
  }),
  component: ReportsPage,
});

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--popover-foreground)",
};
const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const PROCESS_LABEL: Record<string, string> = {
  ALL: "All processes",
  US: "US",
  UK: "UK",
  IN: "India",
  AU: "Australia",
};

function ReportsPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [process, setProcess] = useState<(typeof REPORT_PROCESSES)[number]>("ALL");
  const [employee, setEmployee] = useState("ALL");

  const employees = useReportEmployees();
  const download = useReportDownload();

  const runDownload = () => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      toast.error("The start date is after the end date.");
      return;
    }
    download.mutate(
      {
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        process,
        employee,
      },
      {
        onSuccess: (r) =>
          toast.success("Report downloaded", { description: `${r.fileName} · ${r.rowCount} rows` }),
        onError: (e) => toast.error(e.message || "Could not build the report"),
      },
    );
  };

  return (
    <div className="space-y-7">
      <PageHeader
        title="Reports"
        description="Operational performance only — no financial outcomes."
        actions={
          <Button className="rounded-full" onClick={runDownload} disabled={download.isPending}>
            <Download className="mr-2 h-4 w-4" />
            {download.isPending ? "Preparing…" : "Download report"}
          </Button>
        }
      />

      <SectionCard
        title="Filters"
        description="The downloaded report respects the date range, process and employee selected here."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold">From</span>
            <input
              type="date"
              className="w-full rounded-full border border-border bg-card px-3 py-2"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">To</span>
            <input
              type="date"
              className="w-full rounded-full border border-border bg-card px-3 py-2"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Process</span>
            <Select value={process} onValueChange={(v) => setProcess(v as typeof process)}>
              <SelectTrigger className="rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_PROCESSES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROCESS_LABEL[p] ?? p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Employee</span>
            <Select value={employee} onValueChange={setEmployee}>
              <SelectTrigger className="rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Everyone</SelectItem>
                {(employees.data ?? []).map((emp) => (
                  <SelectItem key={emp.code} value={emp.code}>
                    {emp.name} · {emp.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Submission trend" subtitle="Leads and follow-ups per day">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={SUBMISSION_TREND}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="day"
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="leads"
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="followUps"
                stroke="var(--chart-2)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="accepted"
                stroke="var(--chart-3)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Status distribution" subtitle="Where leads currently sit">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={LEAD_STATUS_MIX}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={95}
                paddingAngle={3}
              >
                {LEAD_STATUS_MIX.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />
                ))}
              </Pie>
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title="Agent output" subtitle="Leads vs accepted">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={AGENT_ACTIVITY}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="name"
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="leads" fill="var(--chart-1)" radius={[8, 8, 0, 0]} />
            <Bar dataKey="accepted" fill="var(--chart-3)" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <SectionCard title="File performance" description="Operational attribution by source file">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Follow-ups</TableHead>
                <TableHead>Accepted</TableHead>
                <TableHead>Acceptance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FILE_PERFORMANCE.map((f) => (
                <TableRow key={f.name}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell>{f.leads}</TableCell>
                  <TableCell>{f.followUps}</TableCell>
                  <TableCell>{f.accepted}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {Math.round((f.accepted / f.leads) * 100)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </div>
  );
}
