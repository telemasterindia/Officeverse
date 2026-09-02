import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import {
  ChartCard,
  EmptyState,
  PageHeader,
  SectionCard,
} from "@/components/officeverse/primitives";
import { StaffAvatar } from "@/components/officeverse/staff-avatar";
import { RoleGate } from "@/components/officeverse/role-gate";
import { PROCESSES } from "@/lib/officeverse/data";
import { useServerLeads } from "@/lib/officeverse/use-lead-lifecycle";
import { useServerStaff } from "@/lib/officeverse/use-staff";

export const Route = createFileRoute("/_shell/team")({
  head: () => ({
    meta: [
      { title: "Team — TMI Officeverse CRM" },
      { name: "description", content: "See who's on the team and how it's performing." },
    ],
  }),
  // UAT #8: the Team roster is a Closer / management view. Agents do not see
  // other agents' rosters or lead activity.
  component: () => (
    <RoleGate allow={["closer", "admin", "hr"]}>
      <TeamPage />
    </RoleGate>
  ),
});

function TeamPage() {
  // A Closer sees agents / closers in their own process (server-scoped).
  const { staff: agents } = useServerStaff("agent");
  const { staff: closers } = useServerStaff("closer");
  const { leads } = useServerLeads({ pageSize: 200 });

  const roster = useMemo(
    () => [
      ...agents.map((a) => ({ ...a, designation: "Sales Agent" })),
      ...closers.map((c) => ({ ...c, designation: "Closer" })),
    ],
    [agents, closers],
  );

  const activity = useMemo(() => {
    const map = new Map<string, { leads: number; accepted: number }>();
    for (const l of leads) {
      const k = l.submitted_by || "—";
      const e = map.get(k) ?? { leads: 0, accepted: 0 };
      e.leads += 1;
      if (l.status === "ACCEPTED" || l.status === "COMPLETED") e.accepted += 1;
      map.set(k, e);
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name: name.split(" ")[0] ?? name, ...v }))
      .slice(0, 10);
  }, [leads]);

  return (
    <div className="space-y-7">
      <PageHeader
        title="Team"
        description="The people you work with and how the floor is performing."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.5fr]">
        <SectionCard title="Roster" description={`${roster.length} on the team`}>
          {roster.length === 0 ? (
            <EmptyState
              title="No teammates yet"
              message="Agents and closers appear here as they're onboarded."
            />
          ) : (
            <ul className="space-y-3">
              {roster.map((m) => (
                <li
                  key={m.code}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"
                >
                  <StaffAvatar
                    userId={m.user_id}
                    name={m.full_name}
                    hasPhoto={m.photo_available}
                    size="medium"
                    process={m.process as never}
                  />
                  <span className="min-w-0 truncate text-sm font-medium">{m.full_name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{m.designation}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <ChartCard title="Lead flow by agent" subtitle="Submitted vs accepted">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={activity}>
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
                cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  color: "var(--popover-foreground)",
                }}
              />
              <Bar dataKey="leads" fill="var(--chart-1)" radius={[8, 8, 0, 0]} />
              <Bar dataKey="accepted" fill="var(--chart-3)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {roster.map((e) => (
          <Card key={e.code} className="surface-panel rounded-2xl border-border/70 p-5 text-center">
            <div className="flex justify-center">
              <StaffAvatar
                userId={e.user_id}
                name={e.full_name}
                hasPhoto={e.photo_available}
                size="large"
                process={e.process as never}
              />
            </div>
            <p className="mt-3 truncate font-display font-semibold">{e.full_name}</p>
            <p className="truncate text-xs text-muted-foreground">{e.designation}</p>
            <p className="mt-2 text-xs">
              {PROCESSES[e.process as keyof typeof PROCESSES]?.flags ?? e.process}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
