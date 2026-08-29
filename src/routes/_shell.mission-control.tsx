import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCheck, ListChecks, Radio, Target, Users2 } from "lucide-react";
import {
  Area,
  AreaChart,
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
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  ActivityTimeline,
  ChartCard,
  MetricCard,
  SectionCard,
} from "@/components/officeverse/primitives";
import { FloatingPanel } from "@/components/officeverse/floating-panel";
import { OfficeverseRoom } from "@/components/officeverse/officeverse-room";
import { TeamPods } from "@/components/officeverse/team-pods";
import {
  AGENT_ACTIVITY,
  AUDIT,
  EMPLOYEES,
  FILE_PERFORMANCE,
  FOLLOWUP_HEALTH,
  LEAD_STATUS_MIX,
  SUBMISSION_TREND,
} from "@/lib/officeverse/data";

export const Route = createFileRoute("/_shell/mission-control")({
  head: () => ({
    meta: [
      { title: "Mission Control — TeleMaster India" },
      {
        name: "description",
        content: "Command center for leads, follow-ups, agents and closers across every process.",
      },
      { property: "og:title", content: "Mission Control — TeleMaster India" },
      { property: "og:description", content: "Live operational view of the whole floor." },
    ],
  }),
  component: MissionControl,
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

function MissionControl() {
  return (
    <OfficeverseRoom
      room="command"
      title="Command Center"
      pose="focused"
      tagline="Good to see the floor, Admin. Here's how everything is running right now."
      eyebrow={
        <span className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
          <Radio className="h-3.5 w-3.5" /> Floor live
        </span>
      }
      actions={
        <>
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/assignments">Assignment control</Link>
          </Button>
          <Button asChild className="rounded-full">
            <Link to="/reports">Open reports</Link>
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard label="Active agents" value={12} icon={Users2} />
        <MetricCard label="Online now" value={8} icon={Radio} tone="success" />
        <MetricCard label="Leads today" value={143} icon={Target} tone="accent" />
        <MetricCard label="Follow-ups today" value={86} icon={ListChecks} />
        <MetricCard label="Overdue" value={17} icon={AlertTriangle} tone="warning" />
        <MetricCard label="Pending acceptance" value={9} icon={CheckCheck} tone="danger" />
      </div>

      <FloatingPanel
        title="On the floor"
        description={`${EMPLOYEES.filter((e) => e.presence === "online").length} online now · ${EMPLOYEES.length} on the team`}
        icon={Users2}
        bodyClassName="p-4 sm:p-5"
      >
        <TeamPods employees={EMPLOYEES} />
      </FloatingPanel>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <ChartCard
          title="Lead submissions"
          subtitle="Leads, follow-ups and accepted over the last 7 days"
        >
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={SUBMISSION_TREND}>
              <defs>
                <linearGradient id="mcA" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
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
              <Area
                type="monotone"
                dataKey="leads"
                stroke="var(--chart-1)"
                fill="url(#mcA)"
                strokeWidth={2}
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
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Lead status" subtitle="Current distribution">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={LEAD_STATUS_MIX}
                dataKey="value"
                nameKey="name"
                innerRadius={56}
                outerRadius={88}
                paddingAngle={3}
              >
                {LEAD_STATUS_MIX.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="mt-2 space-y-1.5 text-xs">
            {LEAD_STATUS_MIX.map((s, i) => (
              <li key={s.name} className="flex items-center gap-2 text-muted-foreground">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: COLORS[i % COLORS.length] }}
                />
                <span className="truncate">{s.name}</span>
                <span className="ml-auto font-semibold text-foreground">{s.value}</span>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Agent activity" subtitle="Leads vs follow-ups vs accepted">
          <ResponsiveContainer width="100%" height={280}>
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
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "var(--muted)", opacity: 0.35 }}
              />
              <Bar dataKey="leads" fill="var(--chart-1)" radius={[8, 8, 0, 0]} />
              <Bar dataKey="followUps" fill="var(--chart-2)" radius={[8, 8, 0, 0]} />
              <Bar dataKey="accepted" fill="var(--chart-3)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Follow-up health" subtitle="100 follow-ups need attention">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={FOLLOWUP_HEALTH} layout="vertical" margin={{ left: 12 }}>
              <CartesianGrid stroke="var(--border)" horizontal={false} />
              <XAxis
                type="number"
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                width={72}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "var(--muted)", opacity: 0.35 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="d12"
                name="1–2 days"
                stackId="a"
                fill="var(--chart-3)"
                radius={[0, 0, 0, 0]}
              />
              <Bar dataKey="d37" name="3–7 days" stackId="a" fill="var(--chart-4)" />
              <Bar
                dataKey="d8"
                name="8+ days"
                stackId="a"
                fill="var(--chart-5)"
                radius={[0, 8, 8, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <SectionCard title="File performance" description="Operational attribution only">
          <ul className="space-y-4">
            {FILE_PERFORMANCE.map((f) => (
              <li key={f.name}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold">{f.name}</p>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {f.leads} leads · {f.followUps} follow-ups · {f.accepted} accepted
                  </p>
                </div>
                <Progress value={(f.accepted / f.leads) * 100} className="mt-2 h-2" />
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Latest activity" description="Across the floor">
          <ActivityTimeline items={AUDIT.slice(0, 6)} />
        </SectionCard>
      </div>

      <Card className="surface-panel rounded-2xl border-border/70 p-6">
        <h2 className="font-display text-lg font-bold">Quick actions</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/assignments">Reassign leads</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/followups">Chase overdue follow-ups</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/exports">Export today&apos;s data</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/audit">Review audit trail</Link>
          </Button>
        </div>
      </Card>
    </OfficeverseRoom>
  );
}
