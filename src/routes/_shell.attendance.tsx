import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { StaffAvatar } from "@/components/officeverse/staff-avatar";
import { ProcessFilter, type ProcessFilterValue } from "@/components/officeverse/process-filter";
import {
  useAdminAttendance,
  useCorrectAttendance,
  useManagedAttendance,
  useMyAttendance,
  type AdminAttendanceFilters,
} from "@/lib/officeverse/use-attendance";
import { useSession } from "@/lib/officeverse/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/attendance")({
  head: () => ({ meta: [{ title: "Attendance — TeleMaster India" }] }),
  component: AttendancePage,
});

const STATUS_CLASS: Record<string, string> = {
  ON_TIME: "text-success",
  LATE: "text-destructive",
  EARLY_DEPARTURE: "text-destructive",
  SHORT_ATTENDANCE: "text-warning",
  PENDING: "text-muted-foreground",
  ABSENT: "text-destructive",
};
const STATUS_VALUES = [
  "ON_TIME",
  "SHORT_ATTENDANCE",
  "LATE",
  "EARLY_DEPARTURE",
  "PENDING",
  "ABSENT",
];

function fmtHrs(min: number): string {
  if (!min) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
function fmtTime(wall: string | null): string {
  if (!wall) return "—";
  const d = new Date(wall.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? wall : d.toLocaleString();
}

type AttendanceRow = NonNullable<ReturnType<typeof useMyAttendance>["data"]>["rows"][number];

function AttendancePage() {
  const { user } = useSession();
  const isManager = user?.role === "admin" || user?.role === "hr";
  const isCloser = user?.role === "closer";

  // Agents have NO attendance visibility at all (intentional business design).
  if (user?.role === "agent") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Attendance"
          description="Recorded automatically from your office sign-in."
        />
        <EmptyState
          emoji="🔒"
          title="Not shown for your role"
          message="Attendance is recorded automatically when you sign in from an authorized office network. There is nothing to mark and no history to review here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Recorded automatically from authenticated office-network sessions — no manual check-in. US: NORMAL before 9:00 PM · SHORT LATE 9:00–9:10 PM · LATE after 9:10 PM. India: NORMAL before 9:40 AM · SHORT LATE 9:40–9:50 AM · LATE after 9:50 AM."
      />
      <MySection />
      {isCloser ? <ManagedSection /> : null}
      {isManager ? <AdminSection /> : null}
    </div>
  );
}

/* ------------------------- closer: managed agents ------------------- */

function ManagedSection() {
  const [filters, setFilters] = useState<AdminAttendanceFilters>({});
  const q = useManagedAttendance(filters);
  const rows = q.data?.rows ?? [];
  return (
    <SectionCard
      title="Team attendance"
      description="Agents in your process — operational view only (no compensation)."
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          placeholder="Agent name / email"
          onChange={(e) => {
            const v = e.target.value.trim();
            setFilters((f) => {
              const next = { ...f };
              if (v) next.employee = v;
              else delete next.employee;
              return next;
            });
          }}
        />
      </div>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : q.data?.dbUnavailable ? (
        <EmptyState
          emoji="🗄️"
          title="Database not connected"
          message="Team attendance needs the database."
        />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agent attendance in your process yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Check-in</th>
                <th className="px-3 py-2">Check-out</th>
                <th className="px-3 py-2">Classification</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60">
                  <td className="px-3 py-2">{r.employeeName}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.operationalDate}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtTime(r.firstCheckInAt)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtTime(r.lastCheckOutAt)}</td>
                  <td className={cn("px-3 py-2 font-semibold", STATUS_CLASS[r.status])}>
                    {r.lateClass}
                    {r.corrected ? (
                      <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                        (adjusted)
                      </span>
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

/* ------------------------------- my rows ---------------------------- */

function MySection() {
  const q = useMyAttendance();
  const rows = q.data?.rows ?? [];

  return (
    <SectionCard title="My attendance">
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorCard />
      ) : q.data?.dbUnavailable ? (
        <DbUnavailable />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="🗓️"
          title="Nothing yet"
          message="Your attendance appears here after you log in during a shift."
        />
      ) : (
        <AttendanceTable rows={rows} showEmployee={false} />
      )}
    </SectionCard>
  );
}

/* ---------------------------- admin / hr -------------------------- */

function AdminSection() {
  const [filters, setFilters] = useState<AdminAttendanceFilters>({});
  const q = useAdminAttendance(filters);
  const rows = q.data?.rows ?? [];
  const set = (k: keyof AdminAttendanceFilters, v: string) =>
    setFilters((p) => {
      const next = { ...p };
      if (v.trim()) next[k] = v.trim();
      else delete next[k];
      return next;
    });

  return (
    <SectionCard title="All employees (Admin / HR)">
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <input
          type="date"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          value={filters.from ?? ""}
          onChange={(e) => set("from", e.target.value)}
          aria-label="From"
        />
        <input
          type="date"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          value={filters.to ?? ""}
          onChange={(e) => set("to", e.target.value)}
          aria-label="To"
        />
        <input
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          placeholder="Employee"
          value={filters.employee ?? ""}
          onChange={(e) => set("employee", e.target.value)}
        />
        <ProcessFilter
          value={(filters.process ?? "ALL") as ProcessFilterValue}
          onChange={(v) => set("process", v === "ALL" ? "" : v)}
          label="Filter attendance by process"
          className="col-span-2 justify-start sm:col-span-3 lg:col-span-2"
        />
        <select
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          value={filters.shiftName ?? ""}
          onChange={(e) => set("shiftName", e.target.value)}
        >
          <option value="">Any shift</option>
          <option value="US SHIFT">US SHIFT</option>
          <option value="INDIA SHIFT">INDIA SHIFT</option>
        </select>
        <select
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          value={filters.status ?? ""}
          onChange={(e) => set("status", e.target.value)}
        >
          <option value="">Any status</option>
          {STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorCard />
      ) : q.data?.dbUnavailable ? (
        <DbUnavailable />
      ) : rows.length === 0 ? (
        <EmptyState emoji="🔍" title="No rows" message="No attendance matches these filters." />
      ) : (
        <AttendanceTable rows={rows} showEmployee correctable />
      )}
    </SectionCard>
  );
}

/* ------------------------------ table ---------------------------- */

function AttendanceTable({
  rows,
  showEmployee,
  correctable = false,
}: {
  rows: AttendanceRow[];
  showEmployee: boolean;
  correctable?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-secondary/60 text-left text-xs uppercase">
          <tr>
            {showEmployee ? <th className="px-3 py-2">Employee</th> : null}
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Process</th>
            <th className="px-3 py-2">Shift</th>
            <th className="px-3 py-2">Operational date</th>
            <th className="px-3 py-2">First check-in</th>
            <th className="px-3 py-2">Last check-out</th>
            <th className="px-3 py-2">Total</th>
            <th className="px-3 py-2">Late (min)</th>
            <th className="px-3 py-2">Early dep. (min)</th>
            <th className="px-3 py-2">Status</th>
            {correctable ? <th className="px-3 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <AttendanceTr key={r.id} r={r} showEmployee={showEmployee} correctable={correctable} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AttendanceTr({
  r,
  showEmployee,
  correctable,
}: {
  r: AttendanceRow;
  showEmployee: boolean;
  correctable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(r.status);
  const [reason, setReason] = useState("");
  const correct = useCorrectAttendance();

  return (
    <>
      <tr className="border-t border-border/60">
        {showEmployee ? (
          <td className="px-3 py-2">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
              <StaffAvatar
                userId={r.userId ?? null}
                name={r.employeeName ?? "—"}
                hasPhoto={r.photoAvailable ?? false}
                size="small"
                process={r.process as never}
              />
              <div className="min-w-0">
                <p className="truncate font-medium">{r.employeeName ?? "—"}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {r.employeeCode ?? "—"}
                </p>
              </div>
            </div>
          </td>
        ) : null}
        <td className="px-3 py-2 text-muted-foreground">{r.role}</td>
        <td className="px-3 py-2 text-muted-foreground">{r.process}</td>
        <td className="px-3 py-2 text-muted-foreground">{r.shiftName}</td>
        <td className="px-3 py-2 text-muted-foreground">{r.operationalDate}</td>
        <td className="px-3 py-2 text-muted-foreground">{fmtTime(r.firstCheckInAt)}</td>
        <td className="px-3 py-2 text-muted-foreground">{fmtTime(r.lastCheckOutAt)}</td>
        <td className="px-3 py-2 text-muted-foreground">{fmtHrs(r.totalMinutes)}</td>
        <td className="px-3 py-2 text-muted-foreground">{r.lateMinutes}</td>
        <td className="px-3 py-2 text-muted-foreground">{r.earlyDepartureMinutes}</td>
        <td className={cn("px-3 py-2 font-semibold", STATUS_CLASS[r.status])}>
          {r.status}
          {r.corrected ? (
            <span className="ml-1 text-[10px] uppercase text-muted-foreground">(corrected)</span>
          ) : null}
          {r.classificationPending ? (
            <span className="ml-1 text-[10px] uppercase text-muted-foreground">(pending)</span>
          ) : null}
        </td>
        {correctable ? (
          <td className="px-3 py-2">
            <Button
              size="sm"
              variant="ghost"
              className="rounded-lg"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Cancel" : "Correct"}
            </Button>
          </td>
        ) : null}
      </tr>
      {open && correctable ? (
        <tr className="border-t border-border/40 bg-secondary/30">
          <td colSpan={showEmployee ? 12 : 11} className="px-3 py-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">
                <span className="mb-1 block font-semibold">Status</span>
                <select
                  className="rounded-lg border border-border bg-card px-2 py-1.5"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {STATUS_VALUES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-[220px] flex-1 text-xs">
                <span className="mb-1 block font-semibold">Reason (required)</span>
                <input
                  className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is this being corrected?"
                />
              </label>
              <Button
                size="sm"
                className="rounded-lg"
                disabled={correct.isPending || reason.trim().length < 3}
                onClick={() =>
                  correct.mutate(
                    { id: r.id, reason: reason.trim(), patch: { status } },
                    {
                      onSuccess: () => {
                        toast.success("Attendance corrected");
                        setOpen(false);
                        setReason("");
                      },
                      onError: () => toast.error("Correction failed"),
                    },
                  )
                }
              >
                Save correction
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              The original derived values are preserved; who / when / why are recorded in the audit
              log.
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/* ------------------------------ states -------------------------- */

const Loading = () => (
  <Card className="rounded-xl border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
    Loading attendance…
  </Card>
);
const ErrorCard = () => (
  <Card className="rounded-xl border-destructive/40 bg-destructive/5 p-6 text-center text-sm font-semibold text-destructive shadow-sm">
    Couldn't load attendance.
  </Card>
);
const DbUnavailable = () => (
  <EmptyState
    emoji="🗄️"
    title="Database not connected"
    message="Attendance needs the production/local database. It populates once the DB is configured."
  />
);
