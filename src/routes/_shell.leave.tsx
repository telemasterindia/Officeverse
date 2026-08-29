import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import {
  useAdminLeave,
  useAdminOff,
  useDecideLeave,
  useMyHr,
  useRequestLeave,
  type AdminLeaveFilters,
} from "@/lib/officeverse/use-leave";
import { useSession } from "@/lib/officeverse/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/leave")({
  head: () => ({ meta: [{ title: "Leave — TeleMaster India" }] }),
  component: LeavePage,
});

const STATUS_CLASS: Record<string, string> = {
  APPROVED: "text-success",
  PENDING: "text-warning",
  REJECTED: "text-destructive",
  CANCELLED: "text-muted-foreground",
};

function LeavePage() {
  const { user } = useSession();
  const isManager = user?.role === "admin" || user?.role === "hr";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave & Off"
        description="Approved leave is expanded with the connected non-working (weekend / holiday) sandwich block. Late→Off (2 = 1) and Short→Off (3 = 1) are separate counters."
      />
      <RequestForm />
      <MyHr />
      {isManager ? <ManagerLeave /> : null}
      {isManager ? <ManagerOff /> : null}
    </div>
  );
}

/* ------------------------------ request ---------------------------- */

function RequestForm() {
  const m = useRequestLeave();
  const [f, setF] = useState({ leaveType: "general", startDate: "", endDate: "", reason: "" });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.startDate || !f.endDate) return;
    m.mutate(f, {
      onSuccess: () => {
        toast.success("Leave requested");
        setF({ leaveType: "general", startDate: "", endDate: "", reason: "" });
      },
      onError: () => toast.error("Could not submit leave"),
    });
  };
  return (
    <SectionCard title="Request leave">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Type</span>
          <input
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
            value={f.leaveType}
            onChange={(e) => setF({ ...f, leaveType: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Start</span>
          <input
            type="date"
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
            value={f.startDate}
            onChange={(e) => setF({ ...f, startDate: e.target.value })}
            required
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">End</span>
          <input
            type="date"
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
            value={f.endDate}
            onChange={(e) => setF({ ...f, endDate: e.target.value })}
            required
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Reason</span>
          <input
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
          />
        </label>
        <div className="sm:col-span-4">
          <Button type="submit" className="rounded-lg" disabled={m.isPending}>
            {m.isPending ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/* ------------------------------- my HR ---------------------------- */

function MyHr() {
  const q = useMyHr();
  const d = q.data;

  return (
    <SectionCard title="My leave & Off">
      {q.isLoading ? (
        <Msg>Loading…</Msg>
      ) : q.isError ? (
        <Msg tone="bad">Couldn't load your HR data.</Msg>
      ) : d?.dbUnavailable ? (
        <EmptyState
          emoji="🗄️"
          title="Database not connected"
          message="Leave / Off data appears once the DB is configured."
        />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="Late" value={d!.counters.lateCount} />
            <Stat label="Short" value={d!.counters.shortCount} />
            <Stat label="Late → Off" value={d!.counters.lateOffCount} />
            <Stat label="Short → Off" value={d!.counters.shortOffCount} />
            <Stat label="Approved leave" value={d!.counters.approvedLeaveDays} />
            <Stat label="Sandwich" value={d!.counters.sandwichLeaveDays} />
            <Stat label="Total leave" value={d!.counters.totalLeaveDays} tone="accent" />
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              My requests
            </p>
            {d!.leave.length === 0 ? (
              <p className="text-sm text-muted-foreground">No leave requests yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/60 text-left text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">From</th>
                      <th className="px-3 py-2">To</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Sandwich days (this month)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d!.leave.map((l) => {
                      const days = d!.leaveDays.filter((x) => x.leaveRequestId === l.id);
                      const sw = days.filter((x) => x.dayType !== "ORIGINAL");
                      return (
                        <tr key={l.id} className="border-t border-border/60">
                          <td className="px-3 py-2">{l.leaveType}</td>
                          <td className="px-3 py-2 text-muted-foreground">{l.startDate}</td>
                          <td className="px-3 py-2 text-muted-foreground">{l.endDate}</td>
                          <td className={cn("px-3 py-2 font-semibold", STATUS_CLASS[l.status])}>
                            {l.status}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {sw.length === 0
                              ? "—"
                              : sw.map((x) => `${x.leaveDate} (${x.nonWorkingReason})`).join(", ")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              My Off records
            </p>
            {d!.off.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Off records this month.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {d!.off.map((o) => (
                  <li
                    key={o.id}
                    className="rounded-lg border border-border bg-secondary/30 px-3 py-1.5"
                  >
                    <span className="font-semibold">OFF</span> · {o.offType} · {o.sourceDescription}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ---------------------------- manager views ---------------------- */

function ManagerLeave() {
  const [filters, setFilters] = useState<AdminLeaveFilters>({ status: "PENDING" });
  const q = useAdminLeave(filters);
  const decide = useDecideLeave();
  const rows = q.data?.rows ?? [];
  const set = (k: keyof AdminLeaveFilters, v: string) =>
    setFilters((p) => {
      const n = { ...p };
      if (v) (n as Record<string, string>)[k] = v;
      else delete n[k];
      return n;
    });

  return (
    <SectionCard title="Leave requests (Admin / HR)">
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <input
          type="date"
          aria-label="From"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          value={filters.from ?? ""}
          onChange={(e) => set("from", e.target.value)}
        />
        <input
          type="date"
          aria-label="To"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          value={filters.to ?? ""}
          onChange={(e) => set("to", e.target.value)}
        />
        <input
          placeholder="Employee"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          value={filters.employee ?? ""}
          onChange={(e) => set("employee", e.target.value)}
        />
        <select
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          value={filters.status ?? ""}
          onChange={(e) => set("status", e.target.value)}
        >
          <option value="">Any status</option>
          {["PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {q.isLoading ? (
        <Msg>Loading…</Msg>
      ) : q.data?.dbUnavailable ? (
        <EmptyState
          emoji="🗄️"
          title="Database not connected"
          message="Leave requests appear once the DB is configured."
        />
      ) : rows.length === 0 ? (
        <EmptyState emoji="✅" title="Nothing here" message="No leave matches these filters." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">From</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t border-border/60">
                  <td className="px-3 py-2 font-medium">{l.employeeName ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.leaveType}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.startDate}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.endDate}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{l.reason ?? "—"}</td>
                  <td className={cn("px-3 py-2 font-semibold", STATUS_CLASS[l.status])}>
                    {l.status}
                  </td>
                  <td className="px-3 py-2">
                    {l.status === "PENDING" ? (
                      <span className="flex gap-1">
                        {(["APPROVED", "REJECTED"] as const).map((dec) => (
                          <Button
                            key={dec}
                            size="sm"
                            variant={dec === "APPROVED" ? "default" : "ghost"}
                            className="rounded-lg"
                            disabled={decide.isPending}
                            onClick={() =>
                              decide.mutate(
                                { id: l.id, decision: dec },
                                {
                                  onSuccess: () => toast.success(`Leave ${dec.toLowerCase()}`),
                                  onError: (e) => toast.error(e.message || "Failed"),
                                },
                              )
                            }
                          >
                            {dec === "APPROVED" ? "Approve" : "Reject"}
                          </Button>
                        ))}
                      </span>
                    ) : l.status === "APPROVED" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-lg"
                        disabled={decide.isPending}
                        onClick={() =>
                          decide.mutate(
                            { id: l.id, decision: "CANCELLED" },
                            { onSuccess: () => toast.success("Leave cancelled") },
                          )
                        }
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function ManagerOff() {
  const [month, setMonth] = useState("");
  const q = useAdminOff(month ? { month } : {});
  const rows = q.data?.rows ?? [];
  return (
    <SectionCard title="Off records (Admin / HR)">
      <div className="mb-3">
        <input
          type="month"
          aria-label="Month"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </div>
      {q.isLoading ? (
        <Msg>Loading…</Msg>
      ) : q.data?.dbUnavailable ? (
        <EmptyState
          emoji="🗄️"
          title="Database not connected"
          message="Off records appear once the DB is configured."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="🟢"
          title="No Off records"
          message="No Late/Short conversions for this filter."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2">Off type</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-t border-border/60">
                  <td className="px-3 py-2 font-medium">{o.employeeName ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{o.periodMonth}</td>
                  <td className="px-3 py-2 font-semibold">{o.offType}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{o.sourceDescription}</td>
                  <td
                    className={cn(
                      "px-3 py-2 text-xs font-semibold",
                      o.status === "VOID" ? "text-muted-foreground" : "text-success",
                    )}
                  >
                    {o.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------ bits --------------------------- */

function Stat({ label, value, tone }: { label: string; value: number; tone?: "accent" }) {
  return (
    <Card className="rounded-xl border-border bg-card p-3 shadow-sm">
      <p className={cn("font-display text-xl font-black", tone === "accent" && "text-accent")}>
        {value}
      </p>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </Card>
  );
}
function Msg({ children, tone }: { children: React.ReactNode; tone?: "bad" }) {
  return (
    <Card
      className={cn(
        "rounded-xl border-border bg-card p-6 text-center text-sm shadow-sm",
        tone === "bad"
          ? "border-destructive/40 bg-destructive/5 font-semibold text-destructive"
          : "text-muted-foreground",
      )}
    >
      {children}
    </Card>
  );
}
