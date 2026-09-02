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
  EmptyState,
  MetricCard,
  SectionCard,
} from "@/components/officeverse/primitives";
import { FloatingPanel } from "@/components/officeverse/floating-panel";
import { OfficeverseRoom } from "@/components/officeverse/officeverse-room";
import { StaffAvatar } from "@/components/officeverse/staff-avatar";
import { useMemo, useState } from "react";
import { PROCESSES } from "@/lib/officeverse/data";
import { bucketOf, minutesUntil, todayIST } from "@/lib/officeverse/followups";
import { useServerFollowUps, useServerLeads } from "@/lib/officeverse/use-lead-lifecycle";
import { useServerStaff } from "@/lib/officeverse/use-staff";

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

/**
 * "On the floor" process/shift filter. `id` is either "ALL" or an authoritative
 * `PROCESS_CODES` value (US / UK / IN / AU) — the exact string stored on
 * `users.process` and surfaced by the staff DTO. Filtering compares against that
 * server field only, never display text / emoji / guessed values.
 */
const FLOOR_FILTERS = [
  { id: "ALL", label: "All" },
  { id: "US", label: "US" },
  { id: "UK", label: "UK" },
  { id: "IN", label: "India" },
  { id: "AU", label: "Australia" },
] as const;
type FloorFilter = (typeof FLOOR_FILTERS)[number]["id"];

function MissionControl() {
  // Authoritative floor view — Admin sees every process. OPERATIONAL roster:
  // only current-role + active staff (promoted / removed employees excluded).
  const { leads } = useServerLeads({ pageSize: 300 });
  const { followUps } = useServerFollowUps({ pageSize: 300 });
  const { staff: agents } = useServerStaff("agent", undefined, undefined, { activeOnly: true });
  const { staff: closers } = useServerStaff("closer", undefined, undefined, { activeOnly: true });

  const m = useMemo(() => {
    const today = todayIST();
    const live = followUps.filter((f) => f.status !== "CANCELLED");
    const first = (s: string) => s.split(" ")[0] ?? s;

    // KPI row
    const activeAgents = agents.filter((a) => a.status === "active").length;
    const onlineNow = agents.filter((a) => a.status === "active").length; // presence not tracked here
    const leadsToday = leads.filter((l) => (l.created_at ?? "").slice(0, 10) === today).length;
    const followupsToday = live.filter((f) => bucketOf(f) === "TODAY").length;
    const overdue = live.filter((f) => bucketOf(f) === "OVERDUE").length;
    const pendingAcceptance = leads.filter((l) => l.status === "ASSIGNED").length;

    // Lead status distribution
    const smMap = new Map<string, number>();
    for (const l of leads) smMap.set(l.status, (smMap.get(l.status) ?? 0) + 1);
    const statusMix = [...smMap.entries()].map(([name, value]) => ({ name, value }));

    // 7-day submission trend
    const trend: { day: string; leads: number; followUps: number; accepted: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      trend.push({
        day: d.toLocaleDateString("en-GB", { weekday: "short" }),
        leads: leads.filter((l) => (l.created_at ?? "").slice(0, 10) === key).length,
        followUps: followUps.filter((f) => (f.created_at ?? "").slice(0, 10) === key).length,
        accepted: leads.filter(
          (l) =>
            (l.status === "ACCEPTED" || l.status === "COMPLETED") &&
            (l.last_activity ?? "").slice(0, 10) === key,
        ).length,
      });
    }

    // Per-agent activity + acceptance
    const aMap = new Map<string, { leads: number; followUps: number; accepted: number }>();
    for (const l of leads) {
      const k = l.submitted_by || "—";
      const e = aMap.get(k) ?? { leads: 0, followUps: 0, accepted: 0 };
      e.leads += 1;
      if (l.status === "ACCEPTED" || l.status === "COMPLETED") e.accepted += 1;
      aMap.set(k, e);
    }
    for (const f of followUps) {
      const k = f.owner_name || "—";
      const e = aMap.get(k) ?? { leads: 0, followUps: 0, accepted: 0 };
      e.followUps += 1;
      aMap.set(k, e);
    }
    const agentActivity = [...aMap.entries()]
      .map(([name, v]) => ({ name: first(name), ...v }))
      .slice(0, 8);

    // Follow-up ageing (overdue only)
    const od = live.filter((f) => bucketOf(f) === "OVERDUE");
    const daysOverdue = (f: (typeof od)[number]) => -minutesUntil(f.scheduled_at) / 1440;
    const followupHealth = [
      {
        name: "Overdue",
        d12: od.filter((f) => daysOverdue(f) <= 2).length,
        d37: od.filter((f) => daysOverdue(f) > 2 && daysOverdue(f) <= 7).length,
        d8: od.filter((f) => daysOverdue(f) > 7).length,
      },
    ];

    const filePerf = agentActivity
      .filter((a) => a.leads > 0)
      .map((a) => ({ name: a.name, leads: a.leads, followUps: a.followUps, accepted: a.accepted }));

    const latestActivity = [...leads]
      .sort((a, b) => (b.last_activity ?? "").localeCompare(a.last_activity ?? ""))
      .slice(0, 6)
      .map((l) => ({
        actor: l.submitted_by || "—",
        action: `lead ${l.status.toLowerCase()}`,
        target: l.lead_id,
        time: l.last_activity ?? l.created_at ?? "",
      }));

    return {
      activeAgents,
      onlineNow,
      leadsToday,
      followupsToday,
      overdue,
      pendingAcceptance,
      statusMix,
      trend,
      agentActivity,
      followupHealth,
      filePerf,
      latestActivity,
    };
  }, [leads, followUps, agents]);

  const roster = useMemo(
    () => [
      ...agents.map((a) => ({ ...a, designation: "Sales Agent" })),
      ...closers.map((c) => ({ ...c, designation: "Closer" })),
    ],
    [agents, closers],
  );

  // "On the floor" — process/shift filter (default ALL, no reload). Narrows the
  // AUTHORITATIVE server roster by the staff DTO's `process` field; agents and
  // closers are filtered together and the header counts follow the selection.
  const [floorFilter, setFloorFilter] = useState<FloorFilter>("ALL");
  const floor = useMemo(() => {
    const rows = floorFilter === "ALL" ? roster : roster.filter((e) => e.process === floorFilter);
    return {
      rows,
      agents: rows.filter((e) => e.kind === "agent").length,
      closers: rows.filter((e) => e.kind === "closer").length,
    };
  }, [roster, floorFilter]);
  const floorFilterLabel = FLOOR_FILTERS.find((f) => f.id === floorFilter)?.label ?? "All";

  return (
    <OfficeverseRoom
      room="command"
      title="Command Center"
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
        <MetricCard label="Active agents" value={m.activeAgents} icon={Users2} />
        <MetricCard label="Active now" value={m.onlineNow} icon={Radio} tone="success" />
        <MetricCard label="Leads today" value={m.leadsToday} icon={Target} tone="accent" />
        <MetricCard label="Follow-ups today" value={m.followupsToday} icon={ListChecks} />
        <MetricCard label="Overdue" value={m.overdue} icon={AlertTriangle} tone="warning" />
        <MetricCard
          label="Pending acceptance"
          value={m.pendingAcceptance}
          icon={CheckCheck}
          tone="danger"
        />
      </div>

      <FloatingPanel
        title="On the floor"
        description={`${floor.rows.length} on the team · ${floor.agents} agents · ${floor.closers} closers`}
        icon={Users2}
        bodyClassName="p-4 sm:p-5"
        action={
          <div
            role="group"
            aria-label="Filter the floor by process / shift"
            className="flex flex-wrap justify-end gap-1.5"
          >
            {FLOOR_FILTERS.map((f) => (
              <Button
                key={f.id}
                type="button"
                size="sm"
                variant={floorFilter === f.id ? "default" : "outline"}
                aria-pressed={floorFilter === f.id}
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => setFloorFilter(f.id)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        }
      >
        {floor.rows.length === 0 ? (
          <EmptyState
            emoji="👥"
            title={`No staff in ${floorFilterLabel}`}
            message="No active agents or closers are assigned to this process / shift."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {floor.rows.map((e) => (
              <div
                key={e.code}
                className="flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/20 p-3"
              >
                <StaffAvatar
                  userId={e.user_id}
                  name={e.full_name}
                  hasPhoto={e.photo_available}
                  size="roster"
                  process={e.process as never}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{e.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {e.designation} · {e.code}
                  </p>
                </div>
                <span
                  className="shrink-0 text-sm leading-none"
                  title={PROCESSES[e.process as keyof typeof PROCESSES]?.label ?? e.process}
                  aria-label={e.process}
                >
                  {PROCESSES[e.process as keyof typeof PROCESSES]?.flags ?? e.process}
                </span>
              </div>
            ))}
          </div>
        )}
      </FloatingPanel>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <ChartCard
          title="Lead submissions"
          subtitle="Leads, follow-ups and accepted over the last 7 days"
        >
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={m.trend}>
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
                data={m.statusMix}
                dataKey="value"
                nameKey="name"
                innerRadius={56}
                outerRadius={88}
                paddingAngle={3}
              >
                {m.statusMix.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="mt-2 space-y-1.5 text-xs">
            {m.statusMix.map((s, i) => (
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
            <BarChart data={m.agentActivity}>
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
            <BarChart data={m.followupHealth} layout="vertical" margin={{ left: 12 }}>
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
            {m.filePerf.map((f) => (
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
          <ActivityTimeline items={m.latestActivity} />
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
