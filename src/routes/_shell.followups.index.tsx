import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Download,
  List,
  Plus,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useExportMyLeads } from "@/lib/officeverse/use-export";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  LeadIdChip,
  MetricCard,
  PageHeader,
} from "@/components/officeverse/primitives";
import { FollowUpStatusBadge } from "@/components/officeverse/follow-up-detail";
import {
  bucketOf,
  displayDate,
  displayTime,
  scheduledParts,
  type FollowUpBucket,
} from "@/lib/officeverse/followups";
import { useServerFollowUps, type UiFollowUp } from "@/lib/officeverse/use-lead-lifecycle";
import { useServerStaff } from "@/lib/officeverse/use-staff";
import { useSession } from "@/lib/officeverse/session";
import { cn } from "@/lib/utils";
import type { ProcessCode } from "@/lib/officeverse/types";

const FU_PROCESS_OPTS: ProcessCode[] = ["US", "IN", "UK", "AU"];

export const Route = createFileRoute("/_shell/followups/")({
  validateSearch: (s: Record<string, unknown>): { fu?: string } =>
    typeof s["fu"] === "string" ? { fu: s["fu"] } : {},
  head: () => ({
    meta: [
      { title: "Follow-ups — TeleMaster India" },
      {
        name: "description",
        content: "Every scheduled callback you own — by date and status. Calendar + list.",
      },
    ],
  }),
  component: FollowUpsPage,
});

const BUCKETS: FollowUpBucket[] = ["TODAY", "UPCOMING", "OVERDUE", "COMPLETED"];

/** Plain calendar-date key "YYYY-MM-DD" for a Date, no timezone conversion. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function FollowUpCard({ f }: { f: UiFollowUp }) {
  const cust = { name: f.customer_name, phone: f.phone };
  return (
    <Card
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40",
      )}
    >
      <Link
        to="/followups/$followUpId"
        params={{ followUpId: f.follow_up_id }}
        className="min-w-0 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-accent/12 px-2 py-1 font-mono text-xs font-bold text-accent">
            {displayTime(f.scheduled_at)}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{f.follow_up_id}</span>
          <FollowUpStatusBadge fu={f} />
        </div>
        <p className="mt-2 truncate font-display text-base font-semibold">{cust.name}</p>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {cust.phone} · {displayDate(f.scheduled_at)}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {f.owner_name} · {f.owner_role === "closer" ? "Closer" : "Agent"} · “{f.comment || "—"}”
        </p>
        {f.converted_lead_id ? (
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent">
            Converted → <LeadIdChip id={f.converted_lead_id} />
          </p>
        ) : null}
      </Link>
      <Button asChild size="sm" variant="outline" className="shrink-0 rounded-lg">
        <Link to="/followups/$followUpId" params={{ followUpId: f.follow_up_id }}>
          View
        </Link>
      </Button>
    </Card>
  );
}

function FollowUpsPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const [view, setView] = useState<"list" | "calendar">("list");
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());

  const isAdmin = user?.role === "admin" || user?.role === "hr";
  const isAgent = user?.role === "agent";
  const exportMine = useExportMyLeads();

  // Admin UAT §3/§4 — filter follow-ups by process / agent / closer SERVER-SIDE.
  const [processF, setProcessF] = useState<string>("all");
  const [agentF, setAgentF] = useState<string>("all");
  const [closerF, setCloserF] = useState<string>("all");
  const scopedProcess = processF !== "all" ? (processF as ProcessCode) : undefined;

  const { staff: agentStaff } = useServerStaff(
    "agent",
    undefined,
    isAdmin ? scopedProcess : undefined,
  );
  const { staff: closerStaff } = useServerStaff(
    "closer",
    undefined,
    isAdmin ? scopedProcess : undefined,
  );

  const { followUps: all } = useServerFollowUps(
    isAdmin
      ? {
          ...(processF !== "all" ? { process: processF } : {}),
          ...(agentF !== "all" ? { agentCode: agentF } : {}),
          ...(closerF !== "all" ? { closerCode: closerF } : {}),
        }
      : {},
  );

  const scoped = all;

  const live = useMemo(() => scoped.filter((f) => f.status !== "CANCELLED"), [scoped]);

  const daysWithFollowUps = useMemo(
    () => new Set(live.map((f) => scheduledParts(f.scheduled_at).date)),
    [live],
  );

  // Deep link from reminders / emails: ?fu=<id> → the record page.
  useEffect(() => {
    if (search.fu) {
      navigate({
        to: "/followups/$followUpId",
        params: { followUpId: search.fu },
        replace: true,
      });
    }
  }, [search.fu, navigate]);

  if (!user) return null;

  const byBucket = (b: FollowUpBucket) =>
    live
      .filter((f) => bucketOf(f) === b)
      .sort((a, z) => a.scheduled_at.localeCompare(z.scheduled_at));

  const dayKey = ymd(selectedDay);
  const dayItems = live
    .filter((f) => scheduledParts(f.scheduled_at).date === dayKey)
    .sort((a, z) => a.scheduled_at.localeCompare(z.scheduled_at));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-ups"
        description={
          isAdmin
            ? "Every follow-up across agents and closers. Filter by owner, status and date."
            : "Your scheduled callbacks — on your board and calendar. Each one opens its full record."
        }
        actions={
          <>
            {/* Admin UAT §12 — Agents may NOT export. Closer / Admin / HR only. */}
            {!isAgent ? (
              <Button
                variant="outline"
                className="rounded-lg"
                disabled={exportMine.isPending}
                onClick={() =>
                  exportMine.mutate(
                    { dataset: "followups", format: "xlsx" },
                    {
                      onSuccess: (r) =>
                        toast.success(
                          `Exported ${r.rowCount} follow-up${r.rowCount === 1 ? "" : "s"}`,
                        ),
                      onError: (e) => toast.error(e.message || "Export failed"),
                    },
                  )
                }
              >
                <Download className="mr-1.5 h-4 w-4" />
                {exportMine.isPending ? "Exporting…" : "Export (Excel)"}
              </Button>
            ) : null}
            <Button asChild className="rounded-lg">
              <Link to="/leads/new" search={{ action: "followup" }}>
                <Plus className="mr-1.5 h-4 w-4" /> New follow-up
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Today"
          value={byBucket("TODAY").length}
          icon={CalendarClock}
          tone="accent"
        />
        <MetricCard label="Upcoming" value={byBucket("UPCOMING").length} />
        <MetricCard
          label="Overdue"
          value={byBucket("OVERDUE").length}
          tone="warning"
          icon={AlertTriangle}
        />
        <MetricCard
          label="Completed"
          value={byBucket("COMPLETED").length}
          tone="success"
          icon={CheckCircle2}
        />
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold",
              view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            <List className="h-4 w-4" /> List
          </button>
          <button
            type="button"
            onClick={() => setView("calendar")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold",
              view === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            <CalendarDays className="h-4 w-4" /> Calendar
          </button>
        </div>

        {isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Select
              value={processF}
              onValueChange={(v) => {
                setProcessF(v);
                setAgentF("all");
                setCloserF("all");
              }}
            >
              <SelectTrigger className="w-[130px]" aria-label="Filter by process">
                <SelectValue placeholder="Process" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All processes</SelectItem>
                {FU_PROCESS_OPTS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={agentF} onValueChange={setAgentF}>
              <SelectTrigger className="w-[170px]" aria-label="Filter by agent">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {agentStaff.map((a) => (
                  <SelectItem key={a.code} value={a.code}>
                    {a.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={closerF} onValueChange={setCloserF}>
              <SelectTrigger className="w-[170px]" aria-label="Filter by closer">
                <SelectValue placeholder="Closer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All closers</SelectItem>
                {closerStaff.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
            Showing your follow-ups
          </span>
        )}
      </div>

      {view === "list" ? (
        <Tabs defaultValue="TODAY">
          <TabsList className="rounded-lg p-1">
            {BUCKETS.map((b) => (
              <TabsTrigger key={b} value={b} className="rounded-md px-5 font-semibold">
                {b} ({byBucket(b).length})
              </TabsTrigger>
            ))}
          </TabsList>
          {BUCKETS.map((b) => {
            const items = byBucket(b);
            return (
              <TabsContent key={b} value={b} className="mt-6">
                {items.length === 0 ? (
                  <EmptyState
                    emoji="🗓️"
                    title="Nothing here."
                    message={`No ${b.toLowerCase()} follow-ups.`}
                  />
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {items.map((f) => (
                      <FollowUpCard key={f.follow_up_id} f={f} />
                    ))}
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
          <Card className="w-fit rounded-xl border-border bg-card p-3 shadow-sm">
            <Calendar
              mode="single"
              selected={selectedDay}
              onSelect={(d) => d && setSelectedDay(d)}
              showOutsideDays
              modifiers={{ hasFu: (date: Date) => daysWithFollowUps.has(ymd(date)) }}
              modifiersClassNames={{
                hasFu:
                  "font-bold after:absolute after:bottom-1 after:left-1/2 after:h-1.5 after:w-1.5 after:-translate-x-1/2 after:rounded-full after:bg-primary aria-selected:after:bg-primary-foreground",
              }}
            />
          </Card>

          <Card className="rounded-xl border-border bg-card p-4 shadow-sm">
            {/* Week strip — the 7 days around the selected day */}
            <div className="mb-4 grid grid-cols-7 gap-1">
              {Array.from({ length: 7 }, (_, i) => {
                const d = new Date(selectedDay);
                d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + i); // Monday-start
                const key = ymd(d);
                const count = live.filter(
                  (f) => scheduledParts(f.scheduled_at).date === key,
                ).length;
                const isSel = key === dayKey;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDay(new Date(d))}
                    className={cn(
                      "flex flex-col items-center rounded-lg border px-1 py-1.5 text-xs",
                      isSel
                        ? "border-primary bg-primary/10 font-bold text-primary"
                        : "border-border text-muted-foreground hover:bg-secondary/60",
                    )}
                  >
                    <span>{d.toLocaleDateString("en-GB", { weekday: "short" })}</span>
                    <span className="text-sm text-foreground">{d.getDate()}</span>
                    <span
                      className={cn(
                        "mt-0.5 inline-block h-1.5 w-1.5 rounded-full",
                        count > 0 ? "bg-primary" : "bg-transparent",
                      )}
                    />
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold">
                {displayDate(dayKey + "T00:00:00+05:30")}
              </h3>
              <Button asChild size="sm" variant="outline" className="rounded-lg">
                <Link to="/leads/new" search={{ action: "followup", date: dayKey }}>
                  <Plus className="mr-1.5 h-4 w-4" /> Schedule on this day
                </Link>
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {dayItems.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No follow-ups scheduled on this day.
                </p>
              ) : (
                dayItems.map((f) => <FollowUpCard key={f.follow_up_id} f={f} />)
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
