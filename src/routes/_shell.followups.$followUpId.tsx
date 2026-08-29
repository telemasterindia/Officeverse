import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRightLeft, Ban, CheckCircle2, Clock, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LeadIdChip, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { FollowUpStatusBadge } from "@/components/officeverse/follow-up-detail";
import { addNotification } from "@/lib/officeverse/alerts";
import { CLOSERS } from "@/lib/officeverse/data";
import {
  buildScheduledAt,
  cancelFollowUp,
  completeFollowUp,
  convertFollowUpToLead,
  displayDate,
  displayDateTime,
  displayTime,
  rescheduleFollowUp,
  scheduledParts,
  updateFollowUpCustomer,
  type FollowUpAttempt,
  type FollowUpCustomer,
} from "@/lib/officeverse/followups";
import { useFollowUps } from "@/lib/officeverse/use-crm";
import { useSession } from "@/lib/officeverse/session";

export const Route = createFileRoute("/_shell/followups/$followUpId")({
  head: ({ params }) => ({
    meta: [{ title: `Follow-up ${params.followUpId} — TeleMaster India` }],
  }),
  component: FollowUpRecordPage,
});

const OUTCOME_LABEL: Record<FollowUpAttempt["outcome"], string> = {
  RESCHEDULED: "Not Reached / Rescheduled",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

function EditRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center sm:gap-4">
      <Label className="text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ReadRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 font-medium">{value || "—"}</span>
    </div>
  );
}

function FollowUpRecordPage() {
  const { followUpId } = Route.useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const all = useFollowUps();
  const fu = all.find((f) => f.follow_up_id === followUpId) ?? null;

  const [cust, setCust] = useState<FollowUpCustomer | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<"view" | "reschedule" | "convert">("view");
  const [rsDate, setRsDate] = useState("");
  const [rsTime, setRsTime] = useState("");
  const [rsNote, setRsNote] = useState("");
  const [convCloser, setConvCloser] = useState("");

  useEffect(() => {
    if (!fu) return;
    setCust({ ...fu.customer });
    const p = scheduledParts(fu.scheduled_at);
    setRsDate(p.date);
    setRsTime(p.time);
    setRsNote("");
    setMode("view");
    setDirty(false);
  }, [fu]);

  if (!user) return null;

  if (!fu) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Follow-up not found"
          description={`No follow-up matches ${followUpId}.`}
        />
        <Button asChild variant="outline" className="rounded-lg">
          <Link to="/followups">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Follow-ups
          </Link>
        </Button>
      </div>
    );
  }

  const c = cust ?? fu.customer;
  const isOwner = fu.owner_id === user.id || fu.owner_name === user.name;
  const isAdmin = user.role === "admin" || user.role === "hr";
  const canManage = isOwner && fu.status === "SCHEDULED";

  const set = <K extends keyof FollowUpCustomer>(k: K, v: FollowUpCustomer[K]) => {
    setCust((prev) => ({ ...(prev ?? fu.customer), [k]: v }));
    setDirty(true);
  };

  const saveCustomer = () => {
    if (!cust) return;
    updateFollowUpCustomer(fu.follow_up_id, cust);
    setDirty(false);
    toast("Customer details updated");
  };

  const doReschedule = () => {
    if (!rsDate || !rsTime) return;
    const at = buildScheduledAt(rsDate, rsTime);
    rescheduleFollowUp(fu.follow_up_id, at, rsNote);
    addNotification({
      category: "Follow-ups",
      title: "Follow-up rescheduled",
      body: `${fu.customer_name} — now ${displayDate(at)} ${displayTime(at)}`,
    });
    toast("Follow-up rescheduled — reminders re-armed", {
      description: "The previous callback is kept in the history.",
    });
    setMode("view");
  };

  const doComplete = () => {
    completeFollowUp(fu.follow_up_id);
    addNotification({
      category: "Follow-ups",
      title: "Follow-up completed",
      body: `${fu.customer_name} · ${fu.follow_up_id}`,
    });
    toast("✅ Follow-up completed");
    navigate({ to: "/followups" });
  };

  const doCancel = () => {
    cancelFollowUp(fu.follow_up_id);
    addNotification({
      category: "Follow-ups",
      title: "Follow-up cancelled",
      body: `${fu.customer_name} · ${fu.follow_up_id}`,
    });
    toast("Follow-up cancelled");
    navigate({ to: "/followups" });
  };

  const doConvert = () => {
    if (!convCloser) return;
    const res = convertFollowUpToLead(fu.follow_up_id, {
      closer: convCloser,
      actor: user.name,
      process: user.process,
    });
    if (!res) return;
    addNotification({
      category: "Leads",
      title: "Follow-up converted to Lead",
      body: `${res.lead.customer_name} · ${res.lead.lead_id} — transferred to ${convCloser}`,
    });
    toast("✅ Converted & assigned", {
      description: `${res.lead.lead_id} → ${convCloser}`,
    });
    navigate({ to: "/leads/$leadId", params: { leadId: res.lead.lead_id } });
  };

  const attempts = fu.attempts;
  const currentLabel =
    fu.status === "SCHEDULED"
      ? "Scheduled"
      : fu.status === "COMPLETED"
        ? "Completed"
        : fu.status === "CANCELLED"
          ? "Cancelled"
          : "Converted to Lead";

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/followups"
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Follow-ups
        </Link>
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{fu.follow_up_id}</span>
              <FollowUpStatusBadge fu={fu} />
            </span>
          }
          title={c.full_name || fu.customer_name}
          description={`${fu.owner_name} · ${fu.owner_role === "closer" ? "Closer" : "Agent"} follow-up · scheduled ${displayDateTime(fu.scheduled_at)}`}
          actions={
            canManage && mode === "view" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => setMode("reschedule")}
                >
                  <Clock className="mr-1.5 h-4 w-4" /> Reschedule
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => setMode("convert")}
                >
                  <ArrowRightLeft className="mr-1.5 h-4 w-4" /> Convert to Lead
                </Button>
                <Button size="sm" className="rounded-lg" onClick={doComplete}>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Complete
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg text-destructive"
                  onClick={doCancel}
                >
                  <Ban className="mr-1.5 h-4 w-4" /> Cancel
                </Button>
              </div>
            ) : null
          }
        />
      </div>

      {!canManage && fu.status !== "SCHEDULED" ? (
        <Card className="rounded-xl border-border bg-secondary/30 p-4 text-sm text-muted-foreground shadow-sm">
          This follow-up is <strong>{currentLabel.toLowerCase()}</strong> and can no longer be
          edited.
          {fu.converted_lead_id ? (
            <>
              {" "}
              It became Lead{" "}
              <Link
                to="/leads/$leadId"
                params={{ leadId: fu.converted_lead_id }}
                className="font-mono text-accent hover:underline"
              >
                {fu.converted_lead_id}
              </Link>
              .
            </>
          ) : null}
        </Card>
      ) : null}

      {mode === "reschedule" ? (
        <SectionCard
          title="Reschedule follow-up"
          description="Pick the new callback time. The current one is kept in the history as “Not Reached / Rescheduled”."
        >
          <div className="grid max-w-md gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rs-date">New date</Label>
                <Input
                  id="rs-date"
                  type="date"
                  value={rsDate}
                  onChange={(e) => setRsDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rs-time">New time (IST)</Label>
                <Input
                  id="rs-time"
                  type="time"
                  value={rsTime}
                  onChange={(e) => setRsTime(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rs-note">Reason (optional)</Label>
              <Textarea
                id="rs-note"
                rows={2}
                value={rsNote}
                onChange={(e) => setRsNote(e.target.value)}
                placeholder="e.g. Customer unavailable, asked to try again."
              />
            </div>
            <div className="flex gap-2">
              <Button className="rounded-lg" onClick={doReschedule} disabled={!rsDate || !rsTime}>
                Save new time
              </Button>
              <Button variant="ghost" className="rounded-lg" onClick={() => setMode("view")}>
                Cancel
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {mode === "convert" ? (
        <SectionCard
          title="Convert to Lead"
          description="The customer information below is used as-is — no duplicate customer is created. The follow-up closes and the Lead is transferred to the Closer you pick."
        >
          <div className="grid max-w-md gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="conv-closer">Transfer to Closer</Label>
              <Select value={convCloser} onValueChange={setConvCloser}>
                <SelectTrigger id="conv-closer">
                  <SelectValue placeholder="Select Closer" />
                </SelectTrigger>
                <SelectContent>
                  {CLOSERS.map((cl) => (
                    <SelectItem key={cl} value={cl}>
                      {cl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button className="rounded-lg" onClick={doConvert} disabled={!convCloser}>
                Convert &amp; Assign Lead
              </Button>
              <Button variant="ghost" className="rounded-lg" onClick={() => setMode("view")}>
                Cancel
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <SectionCard
          title="Customer information"
          description={
            canManage
              ? "You own this follow-up — keep the customer details up to date before you call."
              : "Captured when this follow-up was created."
          }
          action={
            canManage && dirty ? (
              <Button size="sm" className="rounded-lg" onClick={saveCustomer}>
                Save changes
              </Button>
            ) : null
          }
        >
          {canManage ? (
            <div className="space-y-3">
              <EditRow label="Full name">
                <Input value={c.full_name} onChange={(e) => set("full_name", e.target.value)} />
              </EditRow>
              <EditRow label="Phone">
                <Input value={c.phone} onChange={(e) => set("phone", e.target.value)} />
              </EditRow>
              <EditRow label="Email">
                <Input value={c.email} onChange={(e) => set("email", e.target.value)} />
              </EditRow>
              <EditRow label="Street address">
                <Input value={c.address} onChange={(e) => set("address", e.target.value)} />
              </EditRow>
              <EditRow label="City">
                <Input value={c.city} onChange={(e) => set("city", e.target.value)} />
              </EditRow>
              <EditRow label="State">
                <Input value={c.state} onChange={(e) => set("state", e.target.value)} />
              </EditRow>
              <EditRow label="ZIP">
                <Input value={c.zip} onChange={(e) => set("zip", e.target.value)} />
              </EditRow>
              <EditRow label="Debt amount">
                <Input
                  inputMode="numeric"
                  value={c.debt_amount ? String(c.debt_amount) : ""}
                  onChange={(e) =>
                    set("debt_amount", Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)
                  }
                />
              </EditRow>
              <EditRow label="Credit status">
                <Select value={c.credit} onValueChange={(v) => set("credit", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {["Excellent", "Good", "Fair", "Poor"].map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </EditRow>
              <EditRow label="Current debts">
                <Select
                  value={c.current_late || ""}
                  onValueChange={(v) => set("current_late", v as FollowUpCustomer["current_late"])}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Current">Current</SelectItem>
                    <SelectItem value="Late">Late</SelectItem>
                  </SelectContent>
                </Select>
              </EditRow>
              <EditRow label="Comments / notes">
                <Textarea
                  rows={3}
                  value={c.comment}
                  onChange={(e) => set("comment", e.target.value)}
                />
              </EditRow>
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              <ReadRow label="Full name" value={c.full_name} />
              <ReadRow label="Phone" value={c.phone} />
              <ReadRow label="Email" value={c.email} />
              <ReadRow label="Street address" value={c.address} />
              <ReadRow label="City" value={c.city} />
              <ReadRow label="State" value={c.state} />
              <ReadRow label="ZIP" value={c.zip} />
              <ReadRow
                label="Debt amount"
                value={c.debt_amount ? `$${c.debt_amount.toLocaleString()}` : "—"}
              />
              <ReadRow label="Credit status" value={c.credit} />
              <ReadRow label="Current debts" value={c.current_late} />
              <ReadRow label="Comments / notes" value={c.comment} />
            </div>
          )}
        </SectionCard>

        <div className="space-y-6">
          <SectionCard title="This callback" description="Current schedule and reason">
            <div className="divide-y divide-border/70">
              <ReadRow label="Scheduled" value={displayDateTime(fu.scheduled_at)} />
              <ReadRow
                label="Owner"
                value={`${fu.owner_name} (${fu.owner_role === "closer" ? "Closer" : "Agent"})`}
              />
              <ReadRow label="Comment" value={fu.comment} />
              <ReadRow label="Created by" value={`${fu.created_by} · ${fu.customer.date}`} />
              {fu.converted_lead_id ? (
                <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-4 py-1.5 text-sm">
                  <span className="text-muted-foreground">Converted to</span>
                  <Link
                    to="/leads/$leadId"
                    params={{ leadId: fu.converted_lead_id }}
                    className="inline-flex items-center gap-1 font-mono text-accent hover:underline"
                  >
                    <LeadIdChip id={fu.converted_lead_id} />
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            title="Follow-up history"
            description={`${attempts.length + 1} callback${attempts.length ? "s" : ""} on record`}
          >
            <ol className="space-y-3">
              {attempts.map((a, i) => (
                <li
                  key={`${a.recorded_at}-${i}`}
                  className="rounded-lg border border-border bg-secondary/30 p-3 text-sm"
                >
                  <p className="font-semibold">
                    Follow-up #{i + 1}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {displayDateTime(a.scheduled_at)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {OUTCOME_LABEL[a.outcome]}
                  </p>
                  {a.note ? <p className="mt-1 text-xs text-muted-foreground">{a.note}</p> : null}
                </li>
              ))}
              <li className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
                <p className="font-semibold">
                  Follow-up #{attempts.length + 1}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {displayDateTime(fu.scheduled_at)}
                  </span>
                </p>
                <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-primary">
                  {currentLabel}
                </p>
              </li>
            </ol>
          </SectionCard>

          {isAdmin && !isOwner ? (
            <Card className="rounded-xl border-border bg-secondary/30 p-4 text-xs text-muted-foreground shadow-sm">
              Admin view — read only. Owner {fu.owner_name} manages this follow-up.
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
