import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, ClipboardList, Clock, Inbox } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ChartCard,
  LeadIdChip,
  MetricCard,
  SectionCard,
  StatusBadge,
} from "@/components/officeverse/primitives";
import { OfficeverseRoom } from "@/components/officeverse/officeverse-room";
import { PeerAvatar } from "@/components/officeverse/peer-avatar";
import { AGENT_ACTIVITY, LEADS, TEAM_STATUS } from "@/lib/officeverse/data";
import { useSession } from "@/lib/officeverse/session";

export const Route = createFileRoute("/_shell/closer-hub")({
  head: () => ({
    meta: [
      { title: "Closer Hub — TeleMaster India" },
      { name: "description", content: "Your pipeline: assigned leads, follow-ups and pending actions." },
      { property: "og:title", content: "Closer Hub — TeleMaster India" },
      { property: "og:description", content: "Accept, reject and progress leads from one pipeline view." },
    ],
  }),
  component: CloserHubPage,
});

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--popover-foreground)",
};

function CloserHubPage() {
  const { user } = useSession();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  if (!user) return null;
  const pipeline = LEADS.slice(0, 6);

  return (
    <OfficeverseRoom
      room="deal"
      title="Deal Room"
      pose="focused"
      tagline={`Good to see you, ${user.name.split(" ")[0]}. Accept what's ready, reject what isn't, keep the queue moving.`}
      actions={
        <Button asChild variant="outline" className="rounded-full">
          <Link to="/team">Team status</Link>
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Assigned leads" value={32} icon={ClipboardList} />
        <MetricCard label="New" value={8} icon={Inbox} tone="accent" hint="Waiting for your call" />
        <MetricCard label="Follow-ups" value={14} icon={Clock} tone="warning" />
        <MetricCard label="Pending action" value={6} icon={CheckCircle2} tone="success" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <ChartCard title="Agent contribution" subtitle="Leads sent to you this week">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={AGENT_ACTIVITY}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
              <Bar dataKey="leads" fill="var(--chart-1)" radius={[8, 8, 0, 0]} />
              <Bar dataKey="accepted" fill="var(--chart-3)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <SectionCard title="Team status" description="Who's on shift right now">
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
      </div>

      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold">My leads</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {pipeline.map((l) => (
            <Card key={l.lead_id} className="surface-panel rounded-2xl border-border/70 p-5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-lg font-bold">{l.customer_name}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <LeadIdChip id={l.lead_id} />
                    <StatusBadge status={accepted.includes(l.lead_id) ? "ACCEPTED" : l.status} />
                  </div>
                </div>
                <span className="shrink-0 rounded-xl bg-secondary/60 px-3 py-1.5 text-sm font-bold">
                  ${l.debt_amount.toLocaleString()}
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                {[
                  ["Agent", l.submitted_by],
                  ["File", l.file_name],
                  ["Created", l.created_at],
                  ["Last activity", l.last_activity],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="mt-0.5 truncate font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="rounded-full"
                  onClick={() => setAccepted((prev) => [...prev, l.lead_id])}
                  disabled={accepted.includes(l.lead_id)}
                >
                  {accepted.includes(l.lead_id) ? "Accepted" : "Accept"}
                </Button>
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => setRejecting(l.lead_id)}>
                  Reject
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <Dialog open={rejecting !== null} onOpenChange={(v) => !v && setRejecting(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display">Why are you rejecting this lead?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (required)</Label>
            <Textarea id="reason" rows={4} placeholder="Give the agent something actionable." />
            <p className="text-xs text-muted-foreground">The agent will be notified with your reason.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" className="rounded-full" onClick={() => setRejecting(null)}>
              Confirm rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OfficeverseRoom>
  );
}
