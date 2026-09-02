import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, ClipboardList, Clock, Inbox } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ChartCard,
  EmptyState,
  LeadIdChip,
  MetricCard,
  StatusBadge,
} from "@/components/officeverse/primitives";
import { OfficeverseRoom } from "@/components/officeverse/officeverse-room";
import {
  useServerFollowUps,
  useServerLeads,
  useUpdateServerLead,
} from "@/lib/officeverse/use-lead-lifecycle";
import { bucketOf } from "@/lib/officeverse/followups";
import { useSession } from "@/lib/officeverse/session";

export const Route = createFileRoute("/_shell/closer-hub")({
  head: () => ({
    meta: [
      { title: "Closer Hub — TMI Officeverse CRM" },
      {
        name: "description",
        content: "Your pipeline: assigned leads, follow-ups and pending actions.",
      },
      { property: "og:title", content: "Closer Hub — TMI Officeverse CRM" },
      {
        property: "og:description",
        content: "Accept, reject and progress leads from one pipeline view.",
      },
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
  const { leads } = useServerLeads({ pageSize: 100 });
  const { followUps } = useServerFollowUps({ pageSize: 100 });
  const updateLead = useUpdateServerLead();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const assigned = leads.filter((l) => l.status === "ASSIGNED" || l.status === "ACCEPTED");
  const newForYou = leads.filter((l) => l.status === "ASSIGNED");
  const pending = leads.filter((l) => l.status === "ACCEPTED");
  const dueFollowUps = followUps.filter(
    (f) => f.status !== "CANCELLED" && (bucketOf(f) === "TODAY" || bucketOf(f) === "OVERDUE"),
  );
  const pipeline = assigned.slice(0, 8);

  const agentContribution = useMemo(() => {
    const m = new Map<string, { leads: number; accepted: number }>();
    for (const l of leads) {
      const k = l.submitted_by || "—";
      const e = m.get(k) ?? { leads: 0, accepted: 0 };
      e.leads += 1;
      if (l.status === "ACCEPTED" || l.status === "COMPLETED") e.accepted += 1;
      m.set(k, e);
    }
    return [...m.entries()]
      .map(([name, v]) => ({ name: name.split(" ")[0] ?? name, ...v }))
      .slice(0, 8);
  }, [leads]);

  if (!user) return null;

  const setStatus = async (code: string, status: "ACCEPTED" | "REJECTED") => {
    try {
      await updateLead.mutateAsync({ code, patch: { status } });
      toast.success(status === "ACCEPTED" ? "Lead accepted" : "Lead rejected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  return (
    <OfficeverseRoom
      room="deal"
      title="Deal Room"
      tagline={`Good to see you, ${user.name.split(" ")[0]}. Accept what's ready, reject what isn't, keep the queue moving.`}
      actions={
        <Button asChild variant="outline" className="rounded-full">
          <Link to="/leads">All my leads</Link>
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Assigned leads" value={assigned.length} icon={ClipboardList} />
        <MetricCard
          label="New"
          value={newForYou.length}
          icon={Inbox}
          tone="accent"
          hint="Waiting for your call"
        />
        <MetricCard
          label="Follow-ups due"
          value={dueFollowUps.length}
          icon={Clock}
          tone="warning"
        />
        <MetricCard label="Accepted" value={pending.length} icon={CheckCircle2} tone="success" />
      </div>

      <ChartCard title="Agent contribution" subtitle="Leads sent to you, by agent">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={agentContribution}>
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
            <Bar dataKey="leads" fill="var(--chart-1)" radius={[8, 8, 0, 0]} />
            <Bar dataKey="accepted" fill="var(--chart-3)" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold">My leads</h2>
        {pipeline.length === 0 ? (
          <EmptyState
            emoji="📥"
            title="No leads assigned yet"
            message="Leads transferred to you by agents will show up here."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {pipeline.map((l) => (
              <Card key={l.lead_id} className="surface-panel rounded-2xl border-border/70 p-5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-lg font-bold">{l.customer_name}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <LeadIdChip id={l.lead_id} />
                      <StatusBadge status={l.status} />
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
                      <dd className="mt-0.5 truncate font-medium">{v || "—"}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="rounded-full"
                    onClick={() => setStatus(l.lead_id, "ACCEPTED")}
                    disabled={l.status === "ACCEPTED" || updateLead.isPending}
                  >
                    {l.status === "ACCEPTED" ? "Accepted" : "Accept"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      setReason("");
                      setRejecting(l.lead_id);
                    }}
                    disabled={l.status === "ACCEPTED"}
                  >
                    Reject
                  </Button>
                  <Button asChild size="sm" variant="ghost" className="rounded-full">
                    <Link to="/leads/$leadId" params={{ leadId: l.lead_id }}>
                      Open
                    </Link>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Dialog open={rejecting !== null} onOpenChange={(v) => !v && setRejecting(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display">Why are you rejecting this lead?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Give the agent something actionable."
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={updateLead.isPending}
              onClick={async () => {
                if (rejecting) await setStatus(rejecting, "REJECTED");
                setRejecting(null);
              }}
            >
              Confirm rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OfficeverseRoom>
  );
}
