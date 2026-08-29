import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  ListChecks,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  UserCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { EmptyState, MetricCard, StatusBadge } from "@/components/officeverse/primitives";
import { FloatingPanel } from "@/components/officeverse/floating-panel";
import { WorkspaceHero } from "@/components/officeverse/workspace-hero";
import { LEADS, LEAD_STATUS_MIX, SUBMISSION_TREND } from "@/lib/officeverse/data";
import { bucketOf, displayTime, visibleFollowUps } from "@/lib/officeverse/followups";
import { useFollowUps } from "@/lib/officeverse/use-crm";
import { useSession } from "@/lib/officeverse/session";

export const Route = createFileRoute("/_shell/workspace")({
  head: () => ({
    meta: [
      { title: "My Workspace — TeleMaster India" },
      {
        name: "description",
        content: "Your leads, follow-ups and daily mission in one workspace.",
      },
      { property: "og:title", content: "My Workspace — TeleMaster India" },
      {
        property: "og:description",
        content: "Today's mission, your leads and follow-ups at a glance.",
      },
    ],
  }),
  component: WorkspacePage,
});

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--popover-foreground)",
} as const;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function WorkspacePage() {
  const { user } = useSession();
  const allFollowUps = useFollowUps();
  if (!user) return null;
  const first = user.name.split(" ")[0] ?? user.name;

  // This agent's own follow-ups, bucketed by the live schedule vs now.
  const mine = visibleFollowUps(allFollowUps, user).filter((f) => f.status !== "CANCELLED");
  const todays = mine.filter((f) => bucketOf(f) === "TODAY");
  const upcoming = mine.filter((f) => bucketOf(f) === "UPCOMING");
  const overdue = mine.filter((f) => bucketOf(f) === "OVERDUE");
  const completed = mine.filter((f) => bucketOf(f) === "COMPLETED");
  const newLeads = LEADS.filter((l) => l.status === "NEW");
  const pipeline = LEADS.slice(0, 6);

  // Pose reflects what's already on screen — no business event, no new state.
  const pose = overdue.length > 0 ? "concerned" : todays.length > 0 ? "working" : "happy";
  const message =
    overdue.length > 0
      ? `${overdue.length} follow-up${overdue.length > 1 ? "s" : ""} slipped past due. Clear those first, then work today's board.`
      : todays.length > 0
        ? `${todays.length} follow-up${todays.length > 1 ? "s" : ""} on today's board and ${newLeads.length} new leads waiting. Let's move.`
        : "Board's clear. Good time to work fresh leads and get ahead of tomorrow.";

  return (
    <div className="space-y-6 lg:space-y-8">
      <WorkspaceHero
        greeting={greeting()}
        name={first}
        process={user.process}
        pose={pose}
        message={message}
      />

      {/* TODAY — headline numbers, all from FOLLOW_UPS / LEADS */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.16em] text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" /> Today
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="New leads"
            value={newLeads.length}
            icon={Target}
            tone="accent"
            hint="Waiting to be worked"
          />
          <MetricCard
            label="Follow-ups"
            value={todays.length}
            icon={CalendarClock}
            tone="default"
            hint="On today's board"
          />
          <MetricCard
            label="Overdue"
            value={overdue.length}
            icon={AlertTriangle}
            tone="warning"
            hint={overdue.length ? "Needs attention" : "All clear"}
          />
          <MetricCard
            label="Completed"
            value={completed.length}
            icon={CheckCircle2}
            tone="success"
            hint="Cleared this cycle"
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Today's Schedule */}
        <FloatingPanel
          title="Today's schedule"
          description="Follow-ups due today, by time"
          icon={Clock}
          action={
            <Button asChild size="sm" variant="ghost">
              <Link to="/followups">View all</Link>
            </Button>
          }
        >
          {todays.length === 0 ? (
            <EmptyState
              emoji="🗓️"
              title="Nothing scheduled"
              message="No follow-ups are due today."
            />
          ) : (
            <ul className="space-y-2.5">
              {todays.map((f) => (
                <li
                  key={f.follow_up_id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border/50 bg-secondary/20 p-3"
                >
                  <span className="shrink-0 rounded-lg bg-accent/12 px-2 py-1 font-mono text-xs font-bold text-accent">
                    {displayTime(f.scheduled_at)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{f.customer_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {f.comment}
                    </span>
                  </span>
                  <StatusBadge status="TODAY" />
                </li>
              ))}
            </ul>
          )}
        </FloatingPanel>

        {/* Status Mix */}
        <FloatingPanel title="Status mix" description="Leads you've submitted" icon={TrendingUp}>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={LEAD_STATUS_MIX}
                dataKey="value"
                nameKey="name"
                innerRadius={48}
                outerRadius={78}
                paddingAngle={3}
              >
                {LEAD_STATUS_MIX.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="transparent" />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
            {LEAD_STATUS_MIX.map((s, i) => (
              <li key={s.name} className="flex items-center gap-2 text-muted-foreground">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                <span className="truncate">{s.name}</span>
                <span className="ml-auto font-semibold text-foreground">{s.value}</span>
              </li>
            ))}
          </ul>
        </FloatingPanel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming follow-ups */}
        <FloatingPanel
          title="Follow-ups"
          description="Coming up after today"
          icon={ListChecks}
          action={
            <Button asChild size="sm" variant="ghost">
              <Link to="/followups">View all</Link>
            </Button>
          }
        >
          {upcoming.length === 0 ? (
            <EmptyState emoji="🌤️" title="Nothing queued" message="No upcoming follow-ups yet." />
          ) : (
            <ul className="space-y-2.5">
              {upcoming.slice(0, 5).map((f) => (
                <li
                  key={f.follow_up_id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border/50 bg-secondary/20 p-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{f.customer_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {displayTime(f.scheduled_at)} · {f.comment}
                    </span>
                  </span>
                  <StatusBadge status="UPCOMING" />
                </li>
              ))}
            </ul>
          )}
        </FloatingPanel>

        {/* Overdue */}
        <FloatingPanel
          title="Overdue"
          description="Past due — clear these first"
          icon={AlertTriangle}
          tone="warning"
          action={
            <Button asChild size="sm" variant="ghost">
              <Link to="/followups">View all</Link>
            </Button>
          }
        >
          {overdue.length === 0 ? (
            <EmptyState
              emoji="✅"
              title="Nothing overdue"
              message="Every follow-up is on schedule."
            />
          ) : (
            <ul className="space-y-2.5">
              {overdue.slice(0, 5).map((f) => (
                <li
                  key={f.follow_up_id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-warning/25 bg-warning/8 p-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{f.customer_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {f.comment}
                    </span>
                  </span>
                  <StatusBadge status="OVERDUE" />
                </li>
              ))}
            </ul>
          )}
        </FloatingPanel>
      </div>

      {/* Leads in pipeline */}
      <FloatingPanel
        title="Leads in pipeline"
        description="Your latest submissions"
        icon={Target}
        action={
          <Button asChild size="sm" variant="ghost">
            <Link to="/leads">View all</Link>
          </Button>
        }
      >
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {pipeline.map((l) => (
            <li
              key={l.lead_id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border/50 bg-secondary/20 p-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{l.customer_name}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {l.lead_id}
                </span>
              </span>
              <StatusBadge status={l.status} />
            </li>
          ))}
        </ul>
      </FloatingPanel>

      {/* Quick actions */}
      <FloatingPanel title="Quick actions" description="Jump straight in" icon={Plus}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { to: "/leads/new", label: "New lead", sub: "Submit a verified lead", icon: Target },
            { to: "/followups", label: "Follow-ups", sub: "Work your board", icon: ListChecks },
            { to: "/leads", label: "My leads", sub: "Full pipeline", icon: Activity },
            { to: "/profile", label: "My profile", sub: "Identity & shift", icon: UserCircle },
          ].map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="group flex items-center gap-3 rounded-xl border border-border/50 bg-secondary/20 p-3.5 transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                <a.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{a.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{a.sub}</span>
              </span>
            </Link>
          ))}
        </div>
      </FloatingPanel>

      {/* Your week */}
      <FloatingPanel
        title="Your week"
        description="Leads submitted vs follow-ups completed"
        icon={Activity}
      >
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={SUBMISSION_TREND}>
            <defs>
              <linearGradient id="wsA" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="wsB" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
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
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Area
              type="monotone"
              dataKey="leads"
              stroke="var(--chart-1)"
              fill="url(#wsA)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="followUps"
              stroke="var(--chart-2)"
              fill="url(#wsB)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </FloatingPanel>
    </div>
  );
}
