import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { LeadIdChip, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { addNotification } from "@/lib/officeverse/alerts";
import { CLOSERS, DUPLICATE_PHONES } from "@/lib/officeverse/data";
import {
  buildScheduledAt,
  createFollowUp,
  displayDate,
  displayDateTime,
  shiftDateIST,
  todayIST,
  type FollowUpCustomer,
  type FollowUpRecord,
} from "@/lib/officeverse/followups";
import { createLead } from "@/lib/officeverse/leads";
import { useSession } from "@/lib/officeverse/session";
import type { Lead } from "@/lib/officeverse/types";

type Action = "" | "lead" | "followup";

export const Route = createFileRoute("/_shell/leads/new")({
  validateSearch: (s: Record<string, unknown>): { action?: "followup"; date?: string } => {
    const out: { action?: "followup"; date?: string } = {};
    if (s["action"] === "followup") out.action = "followup";
    if (typeof s["date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s["date"]))
      out.date = s["date"];
    return out;
  },
  head: () => ({
    meta: [
      { title: "New Customer — TeleMaster India" },
      {
        name: "description",
        content: "Capture the customer once, then create a Lead or schedule a follow-up.",
      },
    ],
  }),
  component: NewLeadPage,
});

type DupState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "clear" }
  | { kind: "duplicate"; lead_id: string; submitted_by: string; status: string };

function DuplicateNotice({ state }: { state: DupState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "checking")
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
      </p>
    );
  if (state.kind === "clear")
    return (
      <p className="mt-2 flex items-center gap-2 text-xs font-medium text-success">
        <CheckCircle2 className="h-3.5 w-3.5" /> No duplicate found — you&apos;re good to go.
      </p>
    );
  return (
    <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-warning">
        <AlertTriangle className="h-4 w-4" /> Duplicate lead
      </p>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Lead ID</dt>
          <dd className="mt-0.5 font-mono">{state.lead_id}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Submitted by</dt>
          <dd className="mt-0.5">{state.submitted_by}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="mt-0.5">{state.status}</dd>
        </div>
      </dl>
    </div>
  );
}

function NewLeadPage() {
  const { user } = useSession();
  const search = Route.useSearch();
  const formRef = useRef<HTMLFormElement>(null);

  const [action, setAction] = useState<Action>(search.action === "followup" ? "followup" : "");
  const [phone, setPhone] = useState("");
  const [credit, setCredit] = useState("");
  const [currentLate, setCurrentLate] = useState("");
  const [closer, setCloser] = useState("");
  const [fuDate, setFuDate] = useState(search.date ?? "");
  const [fuTime, setFuTime] = useState("");
  const [fuComment, setFuComment] = useState("");
  const [dup, setDup] = useState<DupState>({ kind: "idle" });
  const [createdLead, setCreatedLead] = useState<Lead | null>(null);
  const [createdFu, setCreatedFu] = useState<FollowUpRecord | null>(null);

  const success = createdLead != null || createdFu != null;

  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setDup({ kind: "idle" });
      return;
    }
    setDup({ kind: "checking" });
    const t = setTimeout(() => {
      const hit = DUPLICATE_PHONES[digits.slice(-10)];
      setDup(hit ? { kind: "duplicate", ...hit } : { kind: "clear" });
    }, 700);
    return () => clearTimeout(t);
  }, [phone]);

  const readCustomer = (): FollowUpCustomer | null => {
    if (!formRef.current) return null;
    const fd = new FormData(formRef.current);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    if (!s("customer_name") || !s("phone")) return null;
    return {
      date: s("lead_date") || shiftDateIST(),
      full_name: s("customer_name"),
      phone: s("phone"),
      email: s("email"),
      address: s("address"),
      city: s("city"),
      state: s("state"),
      zip: s("zip"),
      debt_amount: Number(s("debt_amount").replace(/[^0-9.]/g, "")) || 0,
      credit,
      current_late: currentLate === "Current" || currentLate === "Late" ? currentLate : "",
      comment: s("comment"),
    };
  };

  const submitLead = (c: FollowUpCustomer) => {
    if (!user || !closer) return;
    const lead = createLead({
      customer_name: c.full_name,
      email: c.email,
      phone: c.phone,
      ...(c.date ? { date: c.date } : {}),
      address: c.address,
      city: c.city,
      state: c.state,
      zip: c.zip,
      debt_amount: c.debt_amount,
      ...(c.credit ? { credit: c.credit } : {}),
      ...(c.current_late ? { current_late: c.current_late } : {}),
      comment: c.comment,
      submitted_by: user.name,
      assigned_closer: closer,
      process: user.process,
    });
    addNotification({
      category: "Leads",
      title: "Lead created",
      body: `${lead.customer_name} · ${lead.lead_id} — transferred to ${closer}`,
    });
    setCreatedLead(lead);
  };

  const submitFollowUp = (c: FollowUpCustomer) => {
    if (!user || !fuDate || !fuTime) return;
    const rec = createFollowUp({
      customer: c,
      scheduled_at: buildScheduledAt(fuDate, fuTime),
      comment: fuComment,
      owner: {
        id: user.id,
        name: user.name,
        role: user.role === "closer" ? "closer" : "agent",
      },
      created_by: user.name,
    });
    addNotification({
      category: "Follow-ups",
      title: "Follow-up scheduled",
      body: `${rec.customer_name} · ${displayDateTime(rec.scheduled_at)}`,
    });
    toast("✅ Follow-up scheduled", {
      description: `${rec.customer_name} · ${displayDate(rec.scheduled_at)}`,
    });
    setCreatedFu(rec);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const c = readCustomer();
    if (!c) return;
    if (action === "lead") submitLead(c);
    else if (action === "followup") submitFollowUp(c);
  };

  const reset = () => {
    setCreatedLead(null);
    setCreatedFu(null);
    setAction("");
    setPhone("");
    setCredit("");
    setCurrentLate("");
    setCloser("");
    setFuDate("");
    setFuTime("");
    setFuComment("");
    formRef.current?.reset();
  };

  const ownerLabel = user ? `${user.name} — ${user.role === "closer" ? "Closer" : "Agent"}` : "you";
  const canSubmit =
    action === "lead" ? Boolean(closer) : action === "followup" ? Boolean(fuDate && fuTime) : false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="New customer"
        description="Capture the customer's details once. Then choose what to do with them — create a Lead and transfer it to a Closer, or schedule your own follow-up callback."
      />

      <form ref={formRef} className="mx-auto max-w-2xl space-y-6" onSubmit={submit}>
        <SectionCard
          title="Customer information"
          description="Copy the customer's details from the dialer. The same information is used whether this becomes a Lead or a follow-up."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lead_date">Date</Label>
              <Input id="lead_date" name="lead_date" type="date" defaultValue={shiftDateIST()} />
              <p className="text-xs text-muted-foreground">Operational shift date (IST)</p>
            </div>
            <div className="hidden sm:block" aria-hidden />
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" name="customer_name" placeholder="Enter customer name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone number</Label>
              <Input
                id="phone"
                name="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter phone number"
                inputMode="tel"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="Enter email address"
                autoComplete="off"
              />
            </div>
            <div className="sm:col-span-2">
              <DuplicateNotice state={dup} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Street address</Label>
              <Input id="address" name="address" placeholder="Enter street address" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" placeholder="Enter city" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="state">State</Label>
                <Input id="state" name="state" placeholder="State" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="zip">ZIP</Label>
                <Input id="zip" name="zip" placeholder="ZIP" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="debt">Debt amount</Label>
              <Input id="debt" name="debt_amount" placeholder="Enter amount" inputMode="numeric" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="credit">Credit status</Label>
                <Select value={credit} onValueChange={setCredit}>
                  <SelectTrigger id="credit">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {["Excellent", "Good", "Fair", "Poor"].map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cl">Current debts</Label>
                <Select value={currentLate} onValueChange={setCurrentLate}>
                  <SelectTrigger id="cl">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Current">Current</SelectItem>
                    <SelectItem value="Late">Late</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="comment">Comments / notes</Label>
              <Textarea
                id="comment"
                name="comment"
                rows={4}
                placeholder="What did the customer say on the call?"
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Action"
          description="Choose what happens next. The customer information above stays attached either way."
        >
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="action">Select Lead or Follow-up</Label>
              <Select value={action} onValueChange={(v) => setAction(v as Action)}>
                <SelectTrigger id="action">
                  <SelectValue placeholder="Select an action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead — transfer this customer to a Closer</SelectItem>
                  <SelectItem value="followup">Follow-up — schedule my own callback</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {action === "" ? (
              <p className="rounded-lg border border-dashed border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
                Pick an action to continue. <strong>Lead</strong> creates a customer record and
                transfers it to a Closer — you won&apos;t be able to edit it afterwards.{" "}
                <strong>Follow-up</strong> keeps the customer with you and schedules a callback you
                own.
              </p>
            ) : null}

            {action === "lead" ? (
              <div className="space-y-4 rounded-lg border border-border bg-secondary/20 p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="closer">Transfer to Closer</Label>
                  <Select value={closer} onValueChange={setCloser}>
                    <SelectTrigger id="closer">
                      <SelectValue placeholder="Select Closer" />
                    </SelectTrigger>
                    <SelectContent>
                      {CLOSERS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  The Lead is created with a unique Lead ID, transferred to the selected Closer, and
                  becomes read-only for you.
                </p>
              </div>
            ) : null}

            {action === "followup" ? (
              <div className="space-y-4 rounded-lg border border-border bg-secondary/20 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="fu_date">Follow-up date</Label>
                    <Input
                      id="fu_date"
                      type="date"
                      value={fuDate}
                      min={todayIST()}
                      onChange={(e) => setFuDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fu_time">Follow-up time (IST)</Label>
                    <Input
                      id="fu_time"
                      type="time"
                      value={fuTime}
                      onChange={(e) => setFuTime(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fu_comment">Follow-up comment / reason</Label>
                  <Textarea
                    id="fu_comment"
                    rows={3}
                    value={fuComment}
                    onChange={(e) => setFuComment(e.target.value)}
                    placeholder="e.g. Customer interested but busy. Requested callback on this date."
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  This callback is yours — owner <strong>{ownerLabel}</strong>. You&apos;ll get
                  in-app reminders 15, 3 and 1 minutes before, and it appears on your Follow-ups
                  list and calendar.
                </p>
              </div>
            ) : null}
          </div>
        </SectionCard>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg px-6 py-5 text-base font-semibold"
          >
            {action === "followup" ? "Schedule Follow-up" : "Create Lead"}
          </Button>
        </div>
      </form>

      <Dialog open={success} onOpenChange={(v) => !v && reset()}>
        <DialogContent className="max-w-sm rounded-2xl text-center">
          <div className="py-4">
            <span
              className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success/12 text-success"
              aria-hidden
            >
              <CheckCircle2 className="h-6 w-6" />
            </span>

            {createdLead ? (
              <>
                <h2 className="mt-4 font-display text-xl font-bold">Lead created</h2>
                <div className="mt-3 flex justify-center">
                  <LeadIdChip id={createdLead.lead_id} />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {createdLead.customer_name} · transferred to {closer}
                </p>
                <div className="mt-6 flex flex-col gap-2">
                  <Button asChild className="rounded-lg">
                    <Link to="/leads">Go to my Leads</Link>
                  </Button>
                  <Button variant="ghost" className="rounded-lg" onClick={reset}>
                    Add another customer
                  </Button>
                </div>
              </>
            ) : createdFu ? (
              <>
                <h2 className="mt-4 font-display text-xl font-bold">Follow-up scheduled</h2>
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {createdFu.follow_up_id}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {createdFu.customer_name} · {displayDateTime(createdFu.scheduled_at)}
                </p>
                <div className="mt-6 flex flex-col gap-2">
                  <Button asChild className="rounded-lg">
                    <Link
                      to="/followups/$followUpId"
                      params={{ followUpId: createdFu.follow_up_id }}
                    >
                      Open follow-up
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-lg">
                    <Link to="/followups">Go to my Follow-ups</Link>
                  </Button>
                  <Button variant="ghost" className="rounded-lg" onClick={reset}>
                    Add another customer
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
