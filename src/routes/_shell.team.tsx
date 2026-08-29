import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { ChartCard, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { PeerAvatar } from "@/components/officeverse/peer-avatar";
import { AGENT_ACTIVITY, EMPLOYEES, PROCESSES, TEAM_STATUS } from "@/lib/officeverse/data";

export const Route = createFileRoute("/_shell/team")({
  head: () => ({
    meta: [
      { title: "Team — TeleMaster India" },
      { name: "description", content: "See who's on shift and how the team is performing today." },
      { property: "og:title", content: "Team — TeleMaster India" },
      { property: "og:description", content: "Live team presence and shift performance." },
    ],
  }),
  component: TeamPage,
});

function TeamPage() {
  const sales = EMPLOYEES.filter((e) => e.department === "Sales" || e.department === "Closing");

  return (
    <div className="space-y-7">
      <PageHeader title="Team" description="Presence and performance for the people you work with." />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.5fr]">
        <SectionCard title="Team status" description="Live presence">
          <ul className="space-y-3">
            {TEAM_STATUS.map((m) => (
              <li key={m.name} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                <PeerAvatar name={m.name} size="small" presence={m.presence} />
                <span className="min-w-0 truncate text-sm font-medium">{m.name}</span>
                <span className="shrink-0 text-xs capitalize text-muted-foreground">{m.presence}</span>
              </li>
            ))}
          </ul>
        </SectionCard>

        <ChartCard title="Shift performance" subtitle="Leads, follow-ups and accepted this week">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={AGENT_ACTIVITY}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
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
              <Bar dataKey="followUps" fill="var(--chart-2)" radius={[8, 8, 0, 0]} />
              <Bar dataKey="accepted" fill="var(--chart-3)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {sales.map((e) => (
          <Card key={e.id} className="surface-panel rounded-2xl border-border/70 p-5 text-center">
            <div className="flex justify-center">
              <PeerAvatar name={e.name} size="large" presence={e.presence} process={e.process} />
            </div>
            <p className="mt-3 truncate font-display font-semibold">{e.name}</p>
            <p className="truncate text-xs text-muted-foreground">{e.designation}</p>
            <p className="mt-2 text-xs">{PROCESSES[e.process].flags}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
