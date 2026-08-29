import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRightLeft, CalendarPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  EmptyState,
  LeadIdChip,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/officeverse/primitives";
import { FollowUpScheduler } from "@/components/officeverse/follow-up-scheduler";
import { FollowUpStatusBadge } from "@/components/officeverse/follow-up-detail";
import { displayDateTime } from "@/lib/officeverse/followups";
import { useFollowUps, useLeads } from "@/lib/officeverse/use-crm";
import { useSession } from "@/lib/officeverse/session";
import type { FollowUpRecord } from "@/lib/officeverse/followups";

export const Route = createFileRoute("/_shell/leads/$leadId")({
  head: ({ params }) => ({
    meta: [{ title: `Lead ${params.leadId} — TeleMaster India` }],
  }),
  component: LeadDetailPage,
});

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 font-medium">{value}</span>
    </div>
  );
}

function FuRow({ f }: { f: FollowUpRecord }) {
  return (
    <Link
      to="/followups/$followUpId"
      params={{ followUpId: f.follow_up_id }}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-left transition-colors hover:border-primary/40"
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{f.follow_up_id}</span>
          <FollowUpStatusBadge fu={f} />
        </span>
        <span className="mt-1 block text-sm font-semibold">{displayDateTime(f.scheduled_at)}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {f.owner_name} · {f.owner_role === "closer" ? "Closer" : "Agent"} follow-up · “
          {f.comment || "—"}”
        </span>
      </span>
      <span className="shrink-0 text-xs font-semibold text-accent">Open</span>
    </Link>
  );
}

function LeadDetailPage() {
  const { leadId } = Route.useParams();
  const { user } = useSession();
  const leads = useLeads();
  const lead = leads.find((l) => l.lead_id === leadId);
  const all = useFollowUps();
  const [schedulerOpen, setSchedulerOpen] = useState(false);

  const isAgent = user?.role === "agent";
  const convertedFrom = useMemo(
    () => all.find((f) => f.converted_lead_id === leadId) ?? null,
    [all, leadId],
  );

  const groups = useMemo(() => {
    const mine = all.filter((f) => f.lead_id === leadId || f.converted_lead_id === leadId);
    return {
      upcoming: mine
        .filter((f) => f.status === "SCHEDULED")
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
      completed: mine
        .filter((f) => f.status === "COMPLETED" || f.status === "CONVERTED")
        .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)),
      cancelled: mine
        .filter((f) => f.status === "CANCELLED")
        .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)),
      total: mine.length,
    };
  }, [all, leadId]);

  if (!lead) {
    return (
      <div className="space-y-6">
        <PageHeader title="Lead not found" description={`No lead matches ${leadId}.`} />
        <Button asChild variant="outline" className="rounded-lg">
          <Link to="/leads">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to My Leads
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/leads"
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> My Leads
        </Link>
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2">
              <LeadIdChip id={lead.lead_id} />
              <StatusBadge status={lead.status} />
            </span>
          }
          title={lead.customer_name}
          description={
            [[lead.city, lead.state].filter(Boolean).join(", "), lead.file_name]
              .filter(Boolean)
              .join(" · ") || "New customer Lead"
          }
          actions={
            !isAgent ? (
              <Button className="rounded-lg" onClick={() => setSchedulerOpen(true)}>
                <CalendarPlus className="mr-1.5 h-4 w-4" /> Schedule follow-up
              </Button>
            ) : null
          }
        />
      </div>

      {convertedFrom ? (
        <Card className="flex flex-wrap items-center gap-2 rounded-xl border-accent/30 bg-accent/8 p-4 text-sm shadow-sm">
          <ArrowRightLeft className="h-4 w-4 text-accent" />
          <span>
            This Lead was <strong>converted from follow-up</strong>{" "}
            <Link
              to="/followups/$followUpId"
              params={{ followUpId: convertedFrom.follow_up_id }}
              className="font-mono text-accent hover:underline"
            >
              {convertedFrom.follow_up_id}
            </Link>{" "}
            by {convertedFrom.created_by}
            {convertedFrom.converted_at
              ? ` · ${new Date(convertedFrom.converted_at).toLocaleDateString()}`
              : ""}
            .
          </span>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Customer" description="The master record — follow-ups attach here">
          <div className="divide-y divide-border/70">
            <Field label="Customer name" value={lead.customer_name} />
            <Field label="Phone" value={lead.phone} />
            <Field label="Email" value={lead.email} />
            <Field label="Address" value={lead.address} />
            <Field label="City" value={lead.city} />
            <Field label="State" value={lead.state} />
            <Field label="ZIP" value={lead.zip} />
          </div>
        </SectionCard>

        <SectionCard title="Routing & status" description="Ownership and pipeline state">
          <div className="divide-y divide-border/70">
            <Field label="Date" value={lead.created_at} />
            <Field label="Lead file" value={lead.file_name} />
            <Field label="Assigned agent" value={lead.submitted_by} />
            <Field label="Assigned closer" value={lead.assigned_closer} />
            <Field label="Status" value={<StatusBadge status={lead.status} />} />
            <Field label="Debt amount" value={`$${lead.debt_amount.toLocaleString()}`} />
            <Field label="Credit status" value={lead.credit} />
            <Field label="Current debts" value={lead.current_late} />
            <Field label="Process" value={lead.process} />
          </div>
        </SectionCard>
      </div>

      {lead.comment ? (
        <SectionCard title="Lead notes" description="Captured when the Lead was created">
          <p className="text-sm">{lead.comment}</p>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Follow-ups for this Lead"
        description={`${groups.total} attached · one Lead, many follow-ups`}
        action={
          !isAgent ? (
            <Button size="sm" className="rounded-lg" onClick={() => setSchedulerOpen(true)}>
              <CalendarPlus className="mr-1.5 h-4 w-4" /> Schedule follow-up
            </Button>
          ) : null
        }
      >
        {groups.total === 0 ? (
          <EmptyState
            emoji="🗓️"
            title="No follow-ups yet"
            message="Schedule the next conversation — the customer details are already here."
          />
        ) : (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Upcoming ({groups.upcoming.length})
              </p>
              {groups.upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <ul className="space-y-2.5">
                  {groups.upcoming.map((f) => (
                    <li key={f.follow_up_id}>
                      <FuRow f={f} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {groups.completed.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Completed ({groups.completed.length})
                </p>
                <ul className="space-y-2.5">
                  {groups.completed.map((f) => (
                    <li key={f.follow_up_id}>
                      <FuRow f={f} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {groups.cancelled.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Cancelled ({groups.cancelled.length})
                </p>
                <ul className="space-y-2.5">
                  {groups.cancelled.map((f) => (
                    <li key={f.follow_up_id}>
                      <FuRow f={f} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>

      <Card className="rounded-xl border-border bg-secondary/30 p-4 text-xs text-muted-foreground shadow-sm">
        Follow-ups always reference this Lead by ID (
        <span className="font-mono">{lead.lead_id}</span>
        ). Customer details, email and the Lead file come from here — they are never re-entered on a
        follow-up.
      </Card>

      <FollowUpScheduler open={schedulerOpen} onOpenChange={setSchedulerOpen} lead={lead} />
    </div>
  );
}
