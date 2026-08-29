import { createFileRoute } from "@tanstack/react-router";
import { CalendarX, Clock4, UserCheck, Users } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartCard,
  MetricCard,
  PageHeader,
  SectionCard,
} from "@/components/officeverse/primitives";
import { PeerAvatar } from "@/components/officeverse/peer-avatar";
import { AttendanceCheckIn } from "@/components/officeverse/attendance-check-in";
import { ATTENDANCE_TREND, EMPLOYEES } from "@/lib/officeverse/data";

export const Route = createFileRoute("/_shell/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — TeleMaster India" },
      {
        name: "description",
        content: "Daily attendance, punctuality and shift coverage for the floor.",
      },
      { property: "og:title", content: "Attendance — TeleMaster India" },
      {
        property: "og:description",
        content: "Track present, late and on-leave employees day by day.",
      },
    ],
  }),
  component: AttendancePage,
});

function AttendancePage() {
  const present = EMPLOYEES.filter((e) => e.status === "Present").length;
  const late = EMPLOYEES.filter((e) => e.status === "Late").length;
  const leave = EMPLOYEES.filter((e) => e.status === "On Leave").length;

  return (
    <div className="space-y-7">
      <PageHeader
        title="Attendance"
        description="Coverage for today, and how the week is trending."
      />

      <AttendanceCheckIn />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Headcount" value={EMPLOYEES.length} icon={Users} />
        <MetricCard label="Present" value={present} icon={UserCheck} tone="success" />
        <MetricCard label="Late" value={late} icon={Clock4} tone="warning" />
        <MetricCard label="On leave" value={leave} icon={CalendarX} tone="danger" />
      </div>

      <ChartCard title="This week" subtitle="Present, late and on leave">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={ATTENDANCE_TREND}>
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
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.35 }}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                color: "var(--popover-foreground)",
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="present" stackId="a" fill="var(--chart-3)" />
            <Bar dataKey="late" stackId="a" fill="var(--chart-4)" />
            <Bar dataKey="leave" stackId="a" fill="var(--chart-5)" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <SectionCard title="Today's register">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Check-in</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EMPLOYEES.map((e, i) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                      <PeerAvatar
                        name={e.name}
                        size="small"
                        presence={e.presence}
                        process={e.process}
                      />
                      <span className="min-w-0 truncate font-medium">{e.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.department}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.status === "On Leave"
                      ? "—"
                      : `0${8 + (i % 2)}:${(10 + i * 3) % 60 < 10 ? "0" : ""}${(10 + i * 3) % 60}`}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="rounded-full">
                      {e.status}
                    </Badge>
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
