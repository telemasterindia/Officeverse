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
import {
  ActivityTimeline,
  ChartCard,
  MetricCard,
  SectionCard,
} from "@/components/officeverse/primitives";
import { FloatingPanel } from "@/components/officeverse/floating-panel";
import { OfficeverseRoom } from "@/components/officeverse/officeverse-room";
import { EmployeeIdentity } from "@/components/officeverse/employee-identity";
import { IdentityToggle } from "@/components/officeverse/identity-controls";
import { useIdentityMode } from "@/lib/officeverse/identity";
import { ATTENDANCE_TREND, AUDIT, EMPLOYEES, PROCESSES } from "@/lib/officeverse/data";

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

const PRESENCE_ORDER = { online: 0, away: 1, offline: 2 } as const;

function PeopleHub() {
  const [idMode, setIdMode] = useIdentityMode();
  const present = EMPLOYEES.filter((e) => e.status === "Present").length;
  const onLeave = EMPLOYEES.filter((e) => e.status === "On Leave").length;
  const onlineNow = EMPLOYEES.filter((e) => e.presence === "online").length;
  const floor = [...EMPLOYEES].sort(
    (a, b) => PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence],
  );

  return (
    <OfficeverseRoom
      room="people"
      title="People Hub"
      pose="happy"
      tagline="The human side of the TeleMaster India — who's in, who's out, who's new."
      actions={
        <Button asChild className="rounded-full">
          <Link to="/employees">Employee directory</Link>
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Headcount" value={EMPLOYEES.length} icon={Users} />
        <MetricCard label="Present today" value={present} icon={UserCheck} tone="success" />
        <MetricCard label="On leave" value={onLeave} icon={CalendarDays} tone="warning" />
        <MetricCard label="Joined this month" value={3} icon={UserPlus} tone="accent" />
      </div>

      <FloatingPanel
        title="On the floor"
        description={`${onlineNow} online now · ${EMPLOYEES.length} on the team`}
        icon={Users}
        action={<IdentityToggle mode={idMode} onChange={setIdMode} />}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {floor.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/20 p-3"
            >
              <EmployeeIdentity name={e.name} mode={idMode} size="medium" presence={e.presence} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{e.name}</p>
                <p className="truncate text-xs text-muted-foreground">{e.designation}</p>
              </div>
              <span
                className="shrink-0 text-sm leading-none"
                title={PROCESSES[e.process].label}
                aria-label={PROCESSES[e.process].label}
              >
                {PROCESSES[e.process].flags}
              </span>
            </div>
          ))}
        </div>
      </FloatingPanel>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <ChartCard title="Attendance trend" subtitle="Present vs late vs leave across the week">
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
            {EMPLOYEES.slice(0, 5).map((e) => (
              <li
                key={e.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"
              >
                <EmployeeIdentity name={e.name} mode={idMode} size="small" presence={e.presence} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{e.designation}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{e.joining_date}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Recent HR activity">
          <ActivityTimeline items={AUDIT.slice(0, 5)} />
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
