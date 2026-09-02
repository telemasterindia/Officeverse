import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, UserCheck, UserPlus, Users } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { ChartCard, MetricCard, SectionCard } from "@/components/officeverse/primitives";
import { FloatingPanel } from "@/components/officeverse/floating-panel";
import { OfficeverseRoom } from "@/components/officeverse/officeverse-room";
import { StaffAvatar } from "@/components/officeverse/staff-avatar";
import { useMemo } from "react";
import { ATTENDANCE_TREND, PROCESSES } from "@/lib/officeverse/data";
import { useServerStaff } from "@/lib/officeverse/use-staff";

export const Route = createFileRoute("/_shell/people")({
  head: () => ({
    meta: [
      { title: "People Hub — TeleMaster India" },
      {
        name: "description",
        content: "Headcount, attendance and leave at a glance for the whole floor.",
      },
      { property: "og:title", content: "People Hub — TeleMaster India" },
      { property: "og:description", content: "HR command center for attendance and employees." },
    ],
  }),
  component: PeopleHub,
});

function PeopleHub() {
  const { staff: agents } = useServerStaff("agent");
  const { staff: closers } = useServerStaff("closer");

  const { floor, present, onLeave, joinedThisMonth, joiners } = useMemo(() => {
    const roster = [
      ...agents.map((a) => ({ ...a, designation: "Sales Agent" })),
      ...closers.map((c) => ({ ...c, designation: "Closer" })),
    ];
    const ym = new Date().toISOString().slice(0, 7);
    return {
      floor: roster,
      present: roster.filter((e) => e.status === "active").length,
      onLeave: roster.filter((e) => e.status === "on_leave").length,
      joinedThisMonth: roster.filter((e) => (e.registered_on ?? "").slice(0, 7) === ym).length,
      joiners: [...roster]
        .sort((a, b) => (b.registered_on ?? "").localeCompare(a.registered_on ?? ""))
        .slice(0, 5),
    };
  }, [agents, closers]);

  return (
    <OfficeverseRoom
      room="people"
      title="People Hub"
      tagline="The human side of the TeleMaster India — who's in, who's out, who's new."
      actions={
        <Button asChild className="rounded-full">
          <Link to="/employees">Employee directory</Link>
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Headcount" value={floor.length} icon={Users} />
        <MetricCard label="Present today" value={present} icon={UserCheck} tone="success" />
        <MetricCard label="On leave" value={onLeave} icon={CalendarDays} tone="warning" />
        <MetricCard
          label="Joined this month"
          value={joinedThisMonth}
          icon={UserPlus}
          tone="accent"
        />
      </div>

      <FloatingPanel title="On the floor" description={`${floor.length} on the team`} icon={Users}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {floor.map((e) => (
            <div
              key={e.code}
              className="flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/20 p-3"
            >
              <StaffAvatar
                userId={e.user_id}
                name={e.full_name}
                hasPhoto={e.photo_available}
                size="medium"
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
      </FloatingPanel>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <ChartCard
          title="Attendance trend"
          subtitle="Illustrative — live attendance analytics land with the reporting phase"
        >
          <ResponsiveContainer width="100%" height={290}>
            <AreaChart data={ATTENDANCE_TREND}>
              <defs>
                <linearGradient id="pres" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
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
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  color: "var(--popover-foreground)",
                }}
              />
              <Area
                type="monotone"
                dataKey="present"
                stroke="var(--chart-3)"
                fill="url(#pres)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="late"
                stroke="var(--chart-4)"
                fill="transparent"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="leave"
                stroke="var(--chart-5)"
                fill="transparent"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <SectionCard title="New joiners" description="Say hello 👋">
          <ul className="space-y-3">
            {joiners.map((e) => (
              <li
                key={e.code}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"
              >
                <StaffAvatar
                  userId={e.user_id}
                  name={e.full_name}
                  hasPhoto={e.photo_available}
                  size="medium"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{e.designation}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{e.registered_on}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Recent additions" description="Newest agents & closers">
          <ul className="space-y-3 text-sm">
            {joiners.map((e) => (
              <li key={e.code} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{e.full_name}</span>{" "}
                  <span className="text-muted-foreground">joined as {e.designation}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{e.registered_on}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title="Shortcuts" description="Common HR jobs">
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="rounded-full">
              <Link to="/attendance">Attendance</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link to="/leave">Leave requests</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link to="/employees">Employees</Link>
            </Button>
          </div>
        </SectionCard>
      </div>
    </OfficeverseRoom>
  );
}
