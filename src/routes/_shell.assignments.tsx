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
import { displayDateTime } from "@/lib/officeverse/followups";
import { useSession } from "@/lib/officeverse/session";
import {
  useAssignmentHistory,
  useAssignmentRoster,
  useAssignmentWorkload,
  useLongDatedFollowUps,
  useReassignBulk,
  type TransferScope,
  type WorkType,
} from "@/lib/officeverse/use-assignments";

export const Route = createFileRoute("/_shell/assignments")({
  head: () => ({ meta: [{ title: "Assignment Control — TeleMaster India" }] }),
  component: AssignmentsPage,
});

const WORK_TYPES: {
  id: WorkType;
  label: string;
  blurb: string;
  /** whose work is being moved */
  sourceRole: "agent" | "closer";
  /** the new owner's role */
  destRole: "agent" | "closer";
  noun: string;
  subject: "follow_up" | "lead";
}[] = [
  {
    id: "AGENT_FOLLOWUPS",
    label: "Agent → Agent follow-ups",
    blurb:
      "Move an agent's follow-up ownership to another agent. The lead's primary owner is not changed.",
    sourceRole: "agent",
    destRole: "agent",
    noun: "follow-ups",
    subject: "follow_up",
  },
  {
    id: "CLOSER_LEADS",
    label: "Closer → Closer leads",
    blurb:
      "Move a closer's lead ownership to another closer. Agent follow-up owners are not changed.",
    sourceRole: "closer",
    destRole: "closer",
    noun: "leads",
    subject: "lead",
  },
  {
    id: "CLOSER_FOLLOWUPS",
    label: "Closer → Closer follow-ups",
    blurb:
      "Move a closer's follow-up ownership to another closer. The lead's closer is not changed.",
    sourceRole: "closer",
    destRole: "closer",
    noun: "follow-ups",
    subject: "follow_up",
  },
  {
    id: "CLOSER_FOLLOWUPS_TO_AGENT",
    label: "Closer → Agent follow-ups",
    blurb:
      "Move a closer's follow-up ownership to an eligible agent. The lead's closer is not changed.",
    sourceRole: "closer",
    destRole: "agent",
    noun: "follow-ups",
    subject: "follow_up",
  },
];

const SCOPES: { id: TransferScope; label: string }[] = [
  { id: "OVERDUE", label: "Overdue" },
  { id: "DUE_TODAY", label: "Due today" },
  { id: "UPCOMING", label: "Upcoming" },
  { id: "ALL_PENDING", label: "All pending" },
  { id: "SELECTED", label: "Selected" },
];

const BUCKET_STYLE: Record<string, string> = {
  OVERDUE: "bg-destructive/12 text-destructive border-destructive/25",
  DUE_TODAY: "bg-warning/12 text-warning border-warning/25",
  UPCOMING: "bg-info/12 text-info border-info/25",
};
const BUCKET_LABEL: Record<string, string> = {
  OVERDUE: "OVERDUE",
  DUE_TODAY: "DUE TODAY",
  UPCOMING: "UPCOMING",
};

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

const PROCESS_OPTS = ["US", "IN", "UK", "AU"] as const;

type RosterPerson = NonNullable<ReturnType<typeof useAssignmentRoster>["data"]>["agents"][number];

function AssignmentsInner() {
  const [workType, setWorkType] = useState<WorkType>("AGENT_FOLLOWUPS");
  const [processFilter, setProcessFilter] = useState<"" | (typeof PROCESS_OPTS)[number]>("");
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [scope, setScope] = useState<TransferScope>("SELECTED");
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const wt = WORK_TYPES.find((w) => w.id === workType)!;
  const isLeadWork = wt.subject === "lead";
  // Admin UAT §4 — roster scoped to the chosen process, SERVER-SIDE.
  const roster = useAssignmentRoster(processFilter || undefined);
  const workload = useAssignmentWorkload(workType, fromId, search);
  const history = useAssignmentHistory();
  const longDated = useLongDatedFollowUps(processFilter || undefined);
  const reassign = useReassignBulk();

  const [fromPeople, toPeople] = useMemo<[RosterPerson[], RosterPerson[]]>(() => {
    const d = roster.data;
    if (!d || d.dbUnavailable) return [[], []];
    const src = wt.sourceRole === "agent" ? d.agents : d.closers;
    const dst = wt.destRole === "agent" ? d.agents : d.closers;
    return [src, dst];
  }, [roster.data, wt.sourceRole, wt.destRole]);

  // follow-up ownership keys on users.id; closer-lead ownership keys on closers.id
  const ownerIdOf = (p: RosterPerson): number => (isLeadWork ? p.staffId : p.userId);
  const countOf = (p: RosterPerson): number => (isLeadWork ? p.leads : p.followUps);

  function resetWork(next: Partial<{ workType: WorkType; fromId: number | null }>) {
    if (next.workType !== undefined) setWorkType(next.workType);
    if (next.fromId !== undefined) setFromId(next.fromId);
    setToId(null);
    setSelected(new Set());
    setScope("SELECTED");
    setSearch("");
  }

  const rows = workload.data?.dbUnavailable ? [] : (workload.data?.rows ?? []);
  const eligibleCount = workload.data?.count ?? 0;
  const buckets = workload.data?.buckets ?? { overdue: 0, dueToday: 0, upcoming: 0 };
  const longDatedCount = workload.data?.longDatedCount ?? 0;

  // how many records the chosen scope will move (server recomputes at run time)
  const scopeCount =
    scope === "SELECTED"
      ? selected.size
      : scope === "OVERDUE"
        ? buckets.overdue
        : scope === "DUE_TODAY"
          ? buckets.dueToday
          : scope === "UPCOMING"
            ? buckets.upcoming
            : eligibleCount; // ALL_PENDING
  const selectionCount = scopeCount;

  const fromLabel = fromPeople.find((p) => ownerIdOf(p) === fromId)?.name ?? "—";
  const toPerson = toPeople.find((p) => ownerIdOf(p) === toId) ?? null;
  const toLabel = toPerson?.name ?? "—";

  function toggleRow(id: number) {
    setScope("SELECTED");
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
        // SELECTED → explicit ids; every other scope → server resolves the set
        selection: scope === "SELECTED" ? [...selected] : "ALL",
        ...(isLeadWork ? {} : { scope }),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      },
      {
        onSuccess: (res) => {
          setConfirmOpen(false);
          setSelected(new Set());
          setScope("SELECTED");
          if (res.ok && res.failed === 0) {
            toast.success(`Transferred ${res.reassigned}`, {
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

      <SectionCard
        title="1 · What do you want to reassign?"
        action={
          <div className="w-40">
            <Select
              value={processFilter || "all"}
              onValueChange={(v) => {
                setProcessFilter(v === "all" ? "" : (v as (typeof PROCESS_OPTS)[number]));
                resetWork({ fromId: null });
              }}
            >
              <SelectTrigger aria-label="Filter by process">
                <SelectValue placeholder="All processes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All processes</SelectItem>
                {PROCESS_OPTS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        <RadioGroup
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
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

      <SectionCard title="2 · FROM — current owner">
        <div className="max-w-md">
          <Label className="text-xs text-muted-foreground">
            {wt.sourceRole === "agent" ? "Agent" : "Closer"} whose {wt.noun} you are moving
          </Label>
          <Select
            value={fromId != null ? String(fromId) : ""}
            onValueChange={(v) => resetWork({ fromId: Number(v) })}
          >
            <SelectTrigger className="mt-1">
              <SelectValue placeholder={`Select ${wt.sourceRole}`} />
            </SelectTrigger>
            <SelectContent>
              {fromPeople.map((p) => (
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
          title={`3 · Choose what to transfer`}
          description={`Eligible ${wt.noun} for ${fromLabel} (${workload.data?.eligibleStatuses.join(" / ") ?? ""})`}
        >
          {!isLeadWork ? (
            <div className="mb-3 space-y-2">
              <Label className="text-xs text-muted-foreground">Transfer scope</Label>
              <div className="flex flex-wrap gap-1.5">
                {SCOPES.map((s) => {
                  const n =
                    s.id === "OVERDUE"
                      ? buckets.overdue
                      : s.id === "DUE_TODAY"
                        ? buckets.dueToday
                        : s.id === "UPCOMING"
                          ? buckets.upcoming
                          : s.id === "ALL_PENDING"
                            ? eligibleCount
                            : selected.size;
                  return (
                    <Button
                      key={s.id}
                      type="button"
                      size="sm"
                      variant={scope === s.id ? "default" : "outline"}
                      aria-pressed={scope === s.id}
                      className="h-7 rounded-full px-3 text-xs"
                      onClick={() => {
                        setScope(s.id);
                        if (s.id !== "SELECTED") setSelected(new Set());
                      }}
                    >
                      {s.label}
                      {s.id !== "SELECTED" ? ` · ${n}` : selected.size ? ` · ${selected.size}` : ""}
                    </Button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                OVERDUE ({buckets.overdue}) · DUE TODAY ({buckets.dueToday}) · UPCOMING (
                {buckets.upcoming}) · {longDatedCount} long-dated (2–3 months). Scope is recomputed
                on the server at transfer time.
              </p>
            </div>
          ) : null}

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code / customer…"
              className="h-9 w-64"
            />
            {selected.size > 0 ? (
              <button
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </button>
            ) : null}
            <span className="ml-auto text-sm font-semibold">
              {scope === "SELECTED" ? "Selected" : SCOPES.find((s) => s.id === scope)?.label}:{" "}
              {selectionCount}
            </span>
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
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Stays put</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const inScope =
                      scope === "SELECTED"
                        ? selected.has(r.id)
                        : scope === "ALL_PENDING"
                          ? true
                          : (scope === "OVERDUE" && r.bucket === "OVERDUE") ||
                            (scope === "DUE_TODAY" && r.bucket === "DUE_TODAY") ||
                            (scope === "UPCOMING" && r.bucket === "UPCOMING");
                    return (
                      <tr
                        key={r.id}
                        className={cn("border-t border-border/60", inScope && "bg-primary/5")}
                      >
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={inScope}
                            disabled={scope !== "SELECTED"}
                            onCheckedChange={() => toggleRow(r.id)}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                        <td className="px-3 py-2">{r.customerName}</td>
                        <td className="px-3 py-2">
                          {r.bucket ? (
                            <span
                              className={cn(
                                "rounded-full border px-1.5 py-0.5 text-[10px] font-bold",
                                BUCKET_STYLE[r.bucket],
                              )}
                            >
                              {BUCKET_LABEL[r.bucket]}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{r.status}</span>
                          )}
                          {r.longDated ? (
                            <span className="ml-1 rounded-full border border-info/25 bg-info/10 px-1.5 py-0.5 text-[10px] font-bold text-info">
                              LONG-DATED
                            </span>
                          ) : null}
                          {r.scheduledAt ? (
                            <span className="ml-1 text-[11px] text-muted-foreground">
                              {displayDateTime(r.scheduledAt)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.context}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {scope !== "SELECTED" && rows.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              This scope moves every matching {wt.noun} for {fromLabel} — recomputed on the server
              at transfer time, not just the visible rows. Completed / cancelled follow-ups are
              never included and their history is preserved.
            </p>
          ) : null}
        </SectionCard>
      ) : null}

      {fromId != null ? (
        <SectionCard title={`4 · TO — destination ${wt.destRole}`}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem]">
              <Label className="text-xs text-muted-foreground">
                Eligible {wt.destRole} (same process)
              </Label>
              <Select
                value={toId != null ? String(toId) : ""}
                onValueChange={(v) => setToId(Number(v))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={`Select ${wt.destRole}`} />
                </SelectTrigger>
                <SelectContent>
                  {toPeople
                    .filter((p) => ownerIdOf(p) !== fromId)
                    .map((p) => (
                      <SelectItem key={ownerIdOf(p)} value={String(ownerIdOf(p))}>
                        {p.name} — {p.pendingFollowUps} pending FU
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
              Transfer {selectionCount} {wt.noun}
            </Button>
          </div>

          {toPerson ? (
            <div className="mt-4 rounded-lg border border-border bg-secondary/20 p-3">
              <p className="text-sm font-semibold">
                {toPerson.name} — {wt.destRole === "agent" ? "Agent" : "Closer"}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <span className="text-muted-foreground">
                  Total Leads:{" "}
                  <span className="font-semibold text-foreground">{toPerson.leads}</span>
                </span>
                <span className="text-muted-foreground">
                  Pending Follow-ups:{" "}
                  <span className="font-semibold text-foreground">{toPerson.pendingFollowUps}</span>
                </span>
                <span className="text-destructive">Overdue: {toPerson.overdue}</span>
                <span className="text-warning">Due Today: {toPerson.dueToday}</span>
                <span className="text-info">Upcoming: {toPerson.upcoming}</span>
                <span className="text-muted-foreground">
                  Completed:{" "}
                  <span className="font-semibold text-foreground">
                    {toPerson.completedFollowUps}
                  </span>
                </span>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Workload is the destination's actual work — not just a total lead count.
              </p>
            </div>
          ) : null}

          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            {fromLabel} <ArrowRight className="h-3 w-3" /> {toLabel} · {selectionCount} {wt.noun}
          </p>
        </SectionCard>
      ) : null}

      {!isLeadWork ? (
        <SectionCard
          title="Long-dated follow-ups (2–3 months ahead)"
          description="SCHEDULED follow-ups far in the future — review and decide keep-or-transfer. Nothing is moved automatically."
        >
          {longDated.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : longDated.data?.dbUnavailable ? (
            <p className="text-sm text-muted-foreground">Database not connected.</p>
          ) : (longDated.data?.rows.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              No follow-ups scheduled {longDated.data?.windowDays.from ?? 55}–
              {longDated.data?.windowDays.to ?? 120} days out.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-secondary/60 text-left text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Scheduled</th>
                    <th className="px-3 py-2">Current owner</th>
                    <th className="px-3 py-2">Process</th>
                  </tr>
                </thead>
                <tbody>
                  {longDated.data!.rows.map((r) => (
                    <tr key={r.id} className="border-t border-border/60">
                      <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                      <td className="px-3 py-2">{r.customerName}</td>
                      <td className="px-3 py-2">
                        {displayDateTime(r.scheduledAt)}
                        <span className="ml-1 text-[11px] text-muted-foreground">
                          (~{r.monthsAhead}mo)
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.ownerName} · {r.ownerRole} {r.ownerCode}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.process}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
              Transfer {selectionCount} {wt.noun} from {fromLabel} to {toLabel}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">Operation:</span> {wt.label}
                </div>
                {!isLeadWork && scope !== "SELECTED" ? (
                  <div>
                    <span className="text-muted-foreground">Scope:</span>{" "}
                    {SCOPES.find((s) => s.id === scope)?.label}
                  </div>
                ) : null}
                <div>
                  <span className="text-muted-foreground">From:</span> {fromLabel}
                </div>
                <div>
                  <span className="text-muted-foreground">To:</span> {toLabel}
                </div>
                <div className="font-semibold">
                  {selectionCount} {wt.noun}
                </div>
                <div className="text-xs text-muted-foreground">
                  {isLeadWork
                    ? "Only the lead's closer changes. Agent follow-up owners are untouched."
                    : "Only follow-up ownership changes. The lead's primary owner is untouched, and every follow-up's history trail is preserved (previous owner → reassigned by → new owner)."}
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
