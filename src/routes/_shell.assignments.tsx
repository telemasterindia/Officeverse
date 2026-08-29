import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/officeverse/session";
import {
  useAssignmentHistory,
  useAssignmentRoster,
  useAssignmentWorkload,
  useReassignBulk,
} from "@/lib/officeverse/use-assignments";

export const Route = createFileRoute("/_shell/assignments")({
  head: () => ({ meta: [{ title: "Assignment Control — TeleMaster India" }] }),
  component: AssignmentsPage,
});

type WorkType = "AGENT_FOLLOWUPS" | "CLOSER_LEADS" | "CLOSER_FOLLOWUPS";

const WORK_TYPES: {
  id: WorkType;
  label: string;
  blurb: string;
  role: "agent" | "closer";
  noun: string;
}[] = [
  {
    id: "AGENT_FOLLOWUPS",
    label: "Agent follow-ups",
    blurb:
      "Move an agent's follow-up ownership to another agent. The lead's closer is not changed.",
    role: "agent",
    noun: "follow-ups",
  },
  {
    id: "CLOSER_LEADS",
    label: "Closer leads",
    blurb:
      "Move a closer's lead ownership to another closer. The agent's follow-up owner is not changed.",
    role: "closer",
    noun: "leads",
  },
  {
    id: "CLOSER_FOLLOWUPS",
    label: "Closer follow-ups",
    blurb:
      "Move a closer's follow-up ownership to another closer. The lead's closer is not changed.",
    role: "closer",
    noun: "follow-ups",
  },
];

function AssignmentsPage() {
  const { user } = useSession();
  if (user?.role !== "admin") {
    return (
      <div className="space-y-6">
        <PageHeader title="Assignment Control" description="Reassign leads and follow-ups." />
        <EmptyState
          emoji="🔒"
          title="Admins only"
          message="Only an Admin can bulk-reassign work."
        />
      </div>
    );
  }
  return <AssignmentsInner />;
}

function AssignmentsInner() {
  const [workType, setWorkType] = useState<WorkType>("AGENT_FOLLOWUPS");
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allEligible, setAllEligible] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const wt = WORK_TYPES.find((w) => w.id === workType)!;
  const roster = useAssignmentRoster();
  const workload = useAssignmentWorkload(workType, fromId, search);
  const history = useAssignmentHistory();
  const reassign = useReassignBulk();

  const people = useMemo(() => {
    const d = roster.data;
    if (!d || d.dbUnavailable) return [];
    return wt.role === "agent" ? d.agents : d.closers;
  }, [roster.data, wt.role]);

  function ownerIdOf(p: (typeof people)[number]): number {
    // follow-up ownership keys on the user id; closer-lead ownership keys on closers.id
    return workType === "CLOSER_LEADS" ? p.staffId : p.userId;
  }
  function countOf(p: (typeof people)[number]): number {
    return workType === "CLOSER_LEADS" ? p.leads : p.followUps;
  }

  function resetWork(next: Partial<{ workType: WorkType; fromId: number | null }>) {
    if (next.workType !== undefined) setWorkType(next.workType);
    if (next.fromId !== undefined) setFromId(next.fromId);
    setToId(null);
    setSelected(new Set());
    setAllEligible(false);
    setSearch("");
  }

  const rows = workload.data?.dbUnavailable ? [] : (workload.data?.rows ?? []);
  const eligibleCount = workload.data?.count ?? 0;
  const selectionCount = allEligible ? eligibleCount : selected.size;
  const fromLabel = people.find((p) => ownerIdOf(p) === fromId)?.name ?? "—";
  const toLabel = people.find((p) => ownerIdOf(p) === toId)?.name ?? "—";

  function toggleRow(id: number) {
    setAllEligible(false);
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const canSubmit =
    fromId != null && toId != null && fromId !== toId && selectionCount > 0 && !reassign.isPending;

  function submit() {
    if (fromId == null || toId == null) return;
    reassign.mutate(
      {
        workType,
        fromOwnerId: fromId,
        toOwnerId: toId,
        selection: allEligible ? "ALL" : [...selected],
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      },
      {
        onSuccess: (res) => {
          setConfirmOpen(false);
          setSelected(new Set());
          setAllEligible(false);
          if (res.ok && res.failed === 0) {
            toast.success(`Reassigned ${res.reassigned}`, {
              description: `${fromLabel} → ${toLabel}${res.skipped ? ` · ${res.skipped} skipped` : ""}`,
            });
          } else {
            toast.warning(
              `${res.reassigned} reassigned · ${res.skipped} skipped · ${res.failed} failed`,
              { description: `${res.requested} requested · ${fromLabel} → ${toLabel}` },
            );
          }
        },
        onError: () => {
          setConfirmOpen(false);
          toast.error("Reassignment failed", { description: "No records were changed." });
        },
      },
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assignment Control"
        description="Reassign leads and follow-ups when someone leaves or workload needs to move. Lead ownership and follow-up ownership are independent — changing one never changes the other."
      />

      {roster.data?.dbUnavailable ? (
        <EmptyState
          emoji="🗄️"
          title="Database not connected"
          message="Assignment Control needs the database. Roster and workload will appear once the DB is configured."
        />
      ) : null}

      <SectionCard title="1 · What do you want to reassign?">
        <RadioGroup
          className="grid gap-2 sm:grid-cols-3"
          value={workType}
          onValueChange={(v) => resetWork({ workType: v as WorkType })}
        >
          {WORK_TYPES.map((w) => (
            <label
              key={w.id}
              className={cn(
                "flex cursor-pointer gap-2 rounded-lg border p-3 text-sm",
                workType === w.id ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <RadioGroupItem value={w.id} className="mt-0.5" />
              <span>
                <span className="font-semibold">{w.label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{w.blurb}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </SectionCard>

      <SectionCard title="2 · Current owner">
        <div className="max-w-md">
          <Label className="text-xs text-muted-foreground">
            {wt.role === "agent" ? "Agent" : "Closer"} whose {wt.noun} you are moving
          </Label>
          <Select
            value={fromId != null ? String(fromId) : ""}
            onValueChange={(v) => resetWork({ fromId: Number(v) })}
          >
            <SelectTrigger className="mt-1">
              <SelectValue placeholder={`Select ${wt.role}`} />
            </SelectTrigger>
            <SelectContent>
              {people.map((p) => (
                <SelectItem key={ownerIdOf(p)} value={String(ownerIdOf(p))}>
                  {p.name} — {countOf(p)} {wt.noun}
                  {p.status !== "active" ? ` · ${p.status}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </SectionCard>

      {fromId != null ? (
        <SectionCard
          title={`3 · Select ${wt.noun}`}
          description={`Eligible ${wt.noun} for ${fromLabel} (${workload.data?.eligibleStatuses.join(" / ") ?? ""})`}
        >
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code / customer…"
              className="h-9 w-64"
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={allEligible}
                onCheckedChange={(c) => {
                  setAllEligible(!!c);
                  setSelected(new Set());
                }}
              />
              Select all {eligibleCount} eligible {wt.noun}
            </label>
            {selected.size > 0 ? (
              <button
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => {
                  setSelected(new Set());
                  setAllEligible(false);
                }}
              >
                Clear selection
              </button>
            ) : null}
            <span className="ml-auto text-sm font-semibold">Selected: {selectionCount}</span>
          </div>

          {workload.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading workload…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {workload.data?.dbUnavailable
                ? "Database not connected."
                : `No eligible ${wt.noun} for this owner.`}
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-secondary/60 text-left text-xs uppercase">
                  <tr>
                    <th className="w-10 px-3 py-2"></th>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Stays put</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const on = allEligible || selected.has(r.id);
                    return (
                      <tr
                        key={r.id}
                        className={cn("border-t border-border/60", on && "bg-primary/5")}
                      >
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={on}
                            disabled={allEligible}
                            onCheckedChange={() => toggleRow(r.id)}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                        <td className="px-3 py-2">{r.customerName}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.status}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.context}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {allEligible && rows.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              “Select all” moves every one of the {eligibleCount} eligible {wt.noun} for {fromLabel}
              , recomputed on the server at reassignment time — not just the visible rows.
            </p>
          ) : null}
        </SectionCard>
      ) : null}

      {fromId != null ? (
        <SectionCard title={`4 · Assign selected to`}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem]">
              <Label className="text-xs text-muted-foreground">Destination {wt.role}</Label>
              <Select
                value={toId != null ? String(toId) : ""}
                onValueChange={(v) => setToId(Number(v))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={`Select ${wt.role}`} />
                </SelectTrigger>
                <SelectContent>
                  {people
                    .filter((p) => ownerIdOf(p) !== fromId)
                    .map((p) => (
                      <SelectItem key={ownerIdOf(p)} value={String(ownerIdOf(p))}>
                        {p.name} — {countOf(p)} {wt.noun}
                        {p.status !== "active" ? ` · ${p.status}` : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[18rem] flex-1">
              <Label className="text-xs text-muted-foreground">Reason (optional, audited)</Label>
              <Input
                className="mt-1"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Employee left company"
              />
            </div>
            <Button disabled={!canSubmit} onClick={() => setConfirmOpen(true)}>
              Assign selected
            </Button>
          </div>
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            {fromLabel} <ArrowRight className="h-3 w-3" /> {toLabel} · {selectionCount} {wt.noun}
          </p>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Assignment history"
        description="Every bulk reassignment (from the audit log)"
      >
        {history.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : history.data?.dbUnavailable ? (
          <p className="text-sm text-muted-foreground">Database not connected.</p>
        ) : (history.data?.rows.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No reassignments yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {history.data!.rows.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap justify-between gap-3 border-b border-border/50 py-1.5"
              >
                <span>
                  <span className="font-medium">
                    {h.action.replace("assignment.", "").replace(/_/g, " ")}
                  </span>
                  {h.reason ? (
                    <span className="ml-2 text-muted-foreground">“{h.reason}”</span>
                  ) : null}
                </span>
                <span className="text-muted-foreground">
                  {h.reassigned != null ? `${h.reassigned} moved` : ""}
                  {h.actorName ? ` · ${h.actorName}` : ""} · {h.createdAt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reassign {selectionCount} {wt.noun}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">Operation:</span> {wt.label}
                </div>
                <div>
                  <span className="text-muted-foreground">From:</span> {fromLabel}
                </div>
                <div>
                  <span className="text-muted-foreground">To:</span> {toLabel}
                </div>
                <div className="font-semibold">
                  {selectionCount} record{selectionCount === 1 ? "" : "s"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {workType === "CLOSER_LEADS"
                    ? "Only the lead's closer changes. Agent follow-up owners are untouched."
                    : "Only the follow-up owner changes. The lead's closer is untouched."}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                submit();
              }}
              disabled={reassign.isPending}
            >
              {reassign.isPending ? "Reassigning…" : "Confirm reassignment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
