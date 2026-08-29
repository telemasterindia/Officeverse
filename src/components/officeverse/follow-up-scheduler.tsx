import { CalendarClock, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
import {
  buildScheduledAt,
  createFollowUp,
  customerFromLead,
  ownerOptions,
  shiftDateIST,
  todayIST,
  type FollowUpRecord,
} from "@/lib/officeverse/followups";
import { useSession } from "@/lib/officeverse/session";
import type { Lead } from "@/lib/officeverse/types";

function money(n: number) {
  return n > 0 ? `$${n.toLocaleString()}` : "—";
}

/** Read-only summary of the Lead a follow-up is being scheduled against. */
function LeadSummary({ lead }: { lead: Lead }) {
  const rows: [string, string][] = [
    ["Lead ID", lead.lead_id],
    ["Customer", lead.customer_name],
    ["Phone", lead.phone],
    ["Email", lead.email || "—"],
    ["Debt", money(lead.debt_amount)],
    ["Assigned closer", lead.assigned_closer || "—"],
  ];
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-success">
        <CheckCircle2 className="h-3.5 w-3.5" /> Scheduling against this Lead — customer is read
        only
      </p>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 py-0.5 text-sm">
            <span className="text-muted-foreground">{k}</span>
            <span className="min-w-0 truncate font-medium">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Schedules a follow-up AGAINST an already-transferred Lead — used from the Lead
 * detail page (closers / admin only). The agent-owned "capture then schedule my
 * own callback" flow lives on the common New-Lead form, not here.
 */
export function FollowUpScheduler({
  open,
  onOpenChange,
  lead,
  defaultDate,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead;
  defaultDate?: string;
  onCreated?: (rec: FollowUpRecord) => void;
}) {
  const { user } = useSession();
  const [date, setDate] = useState(defaultDate ?? todayIST());
  const [time, setTime] = useState("");
  const [comment, setComment] = useState("");
  const [ownerId, setOwnerId] = useState("");

  const owners = useMemo(() => (user ? ownerOptions(user, lead) : []), [user, lead]);
  const owner = owners.find((o) => o.id === ownerId) ?? owners[0];
  const canSave = Boolean(user && owner && date && time);

  const save = () => {
    if (!user || !owner || !date || !time) return;
    const rec = createFollowUp({
      lead_id: lead.lead_id,
      customer: customerFromLead(lead, shiftDateIST()),
      scheduled_at: buildScheduledAt(date, time),
      comment,
      owner: { id: owner.id, name: owner.name, role: owner.role },
      created_by: user.name,
    });
    toast("✅ Follow-up scheduled", { description: `${rec.customer_name} · ${rec.lead_id}` });
    onCreated?.(rec);
    onOpenChange(false);
    setDate(defaultDate ?? todayIST());
    setTime("");
    setComment("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto rounded-2xl">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/12 text-primary">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold">Schedule follow-up</h2>
            <p className="text-xs text-muted-foreground">
              Attached to this Lead · times are IST (your operational shift)
            </p>
          </div>
        </div>

        {open ? (
          <div className="mt-4 space-y-4">
            <LeadSummary lead={lead} />

            <div className="space-y-1.5">
              <Label htmlFor="fu-owner">Follow-up owner</Label>
              <Select value={owner?.id ?? ""} onValueChange={setOwnerId}>
                <SelectTrigger id="fu-owner">
                  <SelectValue placeholder="Select owner" />
                </SelectTrigger>
                <SelectContent>
                  {owners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fu-date">Follow-up date</Label>
                <Input
                  id="fu-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fu-time">Follow-up time (IST)</Label>
                <Input
                  id="fu-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fu-note">Follow-up comment / notes</Label>
              <Textarea
                id="fu-note"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Why are we calling back? Anything the owner should know."
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" className="rounded-lg" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button className="rounded-lg" disabled={!canSave} onClick={save}>
                Schedule follow-up
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
