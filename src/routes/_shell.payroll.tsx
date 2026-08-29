import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import {
  useAdminPayroll,
  useApprovePayroll,
  useCalculatePayroll,
  useLockPayroll,
  useMyPayroll,
  useReopenPayroll,
  useSalaryProfiles,
  useSetSalaryProfile,
  type AdminPayrollFilters,
  type PayrollStatus,
  type ProcessCode,
} from "@/lib/officeverse/use-payroll";
import { useSession } from "@/lib/officeverse/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/payroll")({
  head: () => ({ meta: [{ title: "Payroll — TeleMaster India" }] }),
  component: PayrollPage,
});

const PROCESSES: ProcessCode[] = ["US", "UK", "IN", "AU"];
const STATUSES: PayrollStatus[] = ["DRAFT", "CALCULATED", "APPROVED", "LOCKED"];

const SALARY_POLICY =
  "Calculated Salary = Base Salary + ₹1,000 Regularity Bonus (when eligible). It is a salary-before-deductions figure — deductions, tax and statutory components are not part of this calculation and will be defined in a later phase.";

const STATUS_CLASS: Record<string, string> = {
  DRAFT: "text-muted-foreground",
  CALCULATED: "text-warning",
  APPROVED: "text-success",
  LOCKED: "text-accent",
};

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
function inr(v: string | number): string {
  const n = typeof v === "string" ? Number(v) : v;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function PayrollPage() {
  const { user } = useSession();
  const isManager = user?.role === "admin" || user?.role === "hr";
  return (
    <div className="space-y-6">
      <PageHeader
        title={isManager ? "Payroll & Salary" : "My Payroll"}
        description={
          isManager
            ? "Monthly salary snapshot from the effective-dated base salary and the authoritative Phase-12 Regularity Bonus. Lifecycle: DRAFT → CALCULATED → APPROVED → LOCKED. A locked run is never recalculated silently — it must be reopened with a reason."
            : "Your monthly salary result. Base salary plus the ₹1,000 Regularity Bonus when eligible. Read-only."
        }
      />
      <PolicyCard />
      {isManager ? (
        <>
          <SalaryProfiles />
          <CalculateForm />
          <ManagerPayroll />
        </>
      ) : (
        <EmployeePayroll />
      )}
    </div>
  );
}

function PolicyCard() {
  return (
    <Card className="rounded-xl border-border bg-secondary/30 p-4 text-sm shadow-sm">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Salary policy
      </p>
      <p className="text-muted-foreground">{SALARY_POLICY}</p>
    </Card>
  );
}

/* ========================= salary profiles ===================== */

function SalaryProfiles() {
  const [employee, setEmployee] = useState("");
  const q = useSalaryProfiles(employee || undefined);
  const rows = q.data?.rows ?? [];
  const save = useSetSalaryProfile();

  const [form, setForm] = useState({ userId: "", baseSalary: "", effectiveFrom: "", note: "" });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const uid = Number(form.userId);
    const base = Number(form.baseSalary);
    if (!Number.isInteger(uid) || uid <= 0) {
      toast.error("Enter a valid employee user ID");
      return;
    }
    if (!Number.isFinite(base) || base < 0) {
      toast.error("Base salary must be ≥ 0");
      return;
    }
    if (!form.effectiveFrom) {
      toast.error("Pick an effective-from date");
      return;
    }
    save.mutate(
      {
        userId: uid,
        baseSalary: base,
        effectiveFrom: form.effectiveFrom,
        ...(form.note ? { note: form.note } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Salary profile saved");
          setForm({ userId: "", baseSalary: "", effectiveFrom: "", note: "" });
        },
        onError: (err) => toast.error(err.message || "Could not save"),
      },
    );
  };

  return (
    <SectionCard title="Base salary configuration (effective-dated)">
      <form onSubmit={submit} className="mb-4 grid gap-3 sm:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Employee user ID</span>
          <input
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
            value={form.userId}
            onChange={(e) => setForm({ ...form, userId: e.target.value.replace(/\D/g, "") })}
            inputMode="numeric"
            required
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Base salary (₹ / month)</span>
          <input
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
            value={form.baseSalary}
            onChange={(e) => setForm({ ...form, baseSalary: e.target.value })}
            inputMode="decimal"
            placeholder="30000"
            required
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Effective from</span>
          <input
            type="date"
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
            value={form.effectiveFrom}
            onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
            required
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Note (optional)</span>
          <input
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </label>
        <div className="sm:col-span-4 flex flex-wrap items-center gap-2">
          <Button type="submit" className="rounded-lg" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save salary profile"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Adding a record closes the previous open one the day before — past payroll keeps its
            salary.
          </span>
        </div>
      </form>

      <div className="mb-2">
        <input
          placeholder="Filter by employee"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          value={employee}
          onChange={(e) => setEmployee(e.target.value)}
        />
      </div>

      {q.isLoading ? (
        <Msg>Loading…</Msg>
      ) : q.data?.dbUnavailable ? (
        <EmptyState
          emoji="🗄️"
          title="Database not connected"
          message="Salary profiles appear once the DB is configured."
        />
      ) : rows.length === 0 ? (
        <EmptyState emoji="💼" title="No salary profiles" message="Add one above." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Process</th>
                <th className="px-3 py-2">Base salary</th>
                <th className="px-3 py-2">Effective from</th>
                <th className="px-3 py-2">Effective to</th>
                <th className="px-3 py-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className={cn("border-t border-border/60", !p.active && "opacity-50")}
                >
                  <td className="px-3 py-2 font-medium">{p.employeeName ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.process ?? "—"}</td>
                  <td className="px-3 py-2 font-semibold">{inr(p.baseSalary)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.effectiveFrom}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.effectiveTo ?? "—"}</td>
                  <td className="px-3 py-2 text-xs font-semibold">{p.active ? "YES" : "NO"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/* ========================= calculate form ==================== */

function CalculateForm() {
  const calc = useCalculatePayroll();
  const [form, setForm] = useState({ userId: "", month: thisMonth() });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const uid = Number(form.userId);
    if (!Number.isInteger(uid) || uid <= 0) {
      toast.error("Enter a valid employee user ID");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(form.month)) {
      toast.error("Pick a month");
      return;
    }
    calc.mutate(
      { userId: uid, month: form.month },
      {
        onSuccess: (r) =>
          toast.success(
            `Calculated ${r.payroll.month}: ${inr(r.payroll.calculatedSalary)} (base ${inr(
              r.payroll.baseSalary,
            )} + bonus ₹${r.payroll.regularityBonus})`,
          ),
        onError: (err) => toast.error(err.message || "Calculation failed"),
      },
    );
  };
  return (
    <SectionCard title="Calculate monthly payroll">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Employee user ID</span>
          <input
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
            value={form.userId}
            onChange={(e) => setForm({ ...form, userId: e.target.value.replace(/\D/g, "") })}
            inputMode="numeric"
            required
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Month</span>
          <input
            type="month"
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
            value={form.month}
            onChange={(e) => setForm({ ...form, month: e.target.value })}
            required
          />
        </label>
        <div className="flex items-end">
          <Button type="submit" className="rounded-lg" disabled={calc.isPending}>
            {calc.isPending ? "Calculating…" : "Calculate / recalculate"}
          </Button>
        </div>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">
        Consumes the Phase-12 Regularity Bonus result — the bonus is never recalculated from raw
        attendance here. A LOCKED or APPROVED run must be reopened first.
      </p>
    </SectionCard>
  );
}

/* ========================= manager table ==================== */

function ManagerPayroll() {
  const [filters, setFilters] = useState<AdminPayrollFilters>({ month: thisMonth() });
  const q = useAdminPayroll(filters);
  const rows = q.data?.rows ?? [];
  const calc = useCalculatePayroll();
  const approve = useApprovePayroll();
  const lock = useLockPayroll();
  const reopen = useReopenPayroll();

  const set = (k: keyof AdminPayrollFilters, v: string) =>
    setFilters((p) => {
      const n = { ...p };
      if (v) (n as Record<string, string>)[k] = v;
      else delete n[k];
      return n;
    });

  const act = (
    m: { mutate: (v: { userId: number; month: string }, o: object) => void; isPending: boolean },
    userId: number,
    month: string,
    label: string,
  ) =>
    m.mutate(
      { userId, month },
      {
        onSuccess: () => toast.success(label),
        onError: (err: Error) => toast.error(err.message || "Failed"),
      },
    );

  return (
    <SectionCard title="Monthly payroll (Admin / HR)">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
            Month
          </span>
          <input
            type="month"
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
            value={filters.month ?? ""}
            onChange={(e) => set("month", e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
            Employee
          </span>
          <input
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
            value={filters.employee ?? ""}
            onChange={(e) => set("employee", e.target.value)}
            placeholder="name or email"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
            Process
          </span>
          <select
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
            value={filters.process ?? ""}
            onChange={(e) => set("process", e.target.value)}
          >
            <option value="">Any</option>
            {PROCESSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
            Status
          </span>
          <select
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
            value={filters.status ?? ""}
            onChange={(e) => set("status", e.target.value)}
          >
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {q.isLoading ? (
        <Msg>Loading…</Msg>
      ) : q.data?.dbUnavailable ? (
        <EmptyState
          emoji="🗄️"
          title="Database not connected"
          message="Payroll runs appear once the DB is configured."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title="No payroll runs"
          message="Use “Calculate monthly payroll” above to create one."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Process</th>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2">Base salary</th>
                <th className="px-3 py-2">Leave</th>
                <th className="px-3 py-2">Off</th>
                <th className="px-3 py-2">Regularity bonus</th>
                <th className="px-3 py-2">Calculated salary</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.userId}-${r.month}`} className="border-t border-border/60">
                  <td className="px-3 py-2 font-medium">{r.employeeName ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.process}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.month}</td>
                  <td className="px-3 py-2">{inr(r.baseSalary)}</td>
                  <td className="px-3 py-2">{r.leaveCount}</td>
                  <td className="px-3 py-2">{r.offCount}</td>
                  <td className="px-3 py-2">₹{r.regularityBonus}</td>
                  <td className="px-3 py-2 font-semibold">{inr(r.calculatedSalary)}</td>
                  <td className={cn("px-3 py-2 font-semibold", STATUS_CLASS[r.status])}>
                    {r.status}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {(r.status === "DRAFT" || r.status === "CALCULATED") && r.userId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-lg"
                          disabled={calc.isPending}
                          onClick={() => act(calc, r.userId!, r.month, "Recalculated")}
                        >
                          Recalculate
                        </Button>
                      ) : null}
                      {r.status === "CALCULATED" && r.userId ? (
                        <Button
                          size="sm"
                          className="rounded-lg"
                          disabled={approve.isPending}
                          onClick={() => act(approve, r.userId!, r.month, "Approved")}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {r.status === "APPROVED" && r.userId ? (
                        <Button
                          size="sm"
                          className="rounded-lg"
                          disabled={lock.isPending}
                          onClick={() => act(lock, r.userId!, r.month, "Locked")}
                        >
                          Lock
                        </Button>
                      ) : null}
                      {(r.status === "APPROVED" || r.status === "LOCKED") && r.userId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-lg"
                          disabled={reopen.isPending}
                          onClick={() => {
                            const reason = window.prompt("Reason for reopening this payroll run?");
                            if (!reason || reason.trim().length < 3) return;
                            reopen.mutate(
                              { userId: r.userId!, month: r.month, reason: reason.trim() },
                              {
                                onSuccess: () => toast.success("Reopened (now CALCULATED)"),
                                onError: (err) => toast.error(err.message || "Failed"),
                              },
                            );
                          }}
                        >
                          Reopen
                        </Button>
                      ) : null}
                    </span>
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

/* ========================= employee view ==================== */

function EmployeePayroll() {
  const [month, setMonth] = useState("");
  const q = useMyPayroll(month || undefined);
  const rows = q.data?.rows ?? [];
  return (
    <SectionCard title="My payroll">
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
          message="Your payroll appears once the DB is configured."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title="No payroll yet"
          message="Your payroll has not been generated for this period."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2">Base salary</th>
                <th className="px-3 py-2">Leave days</th>
                <th className="px-3 py-2">Off days</th>
                <th className="px-3 py-2">Regularity bonus</th>
                <th className="px-3 py-2">Calculated salary</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className="border-t border-border/60">
                  <td className="px-3 py-2 text-muted-foreground">{r.month}</td>
                  <td className="px-3 py-2">{inr(r.baseSalary)}</td>
                  <td className="px-3 py-2">{r.leaveCount}</td>
                  <td className="px-3 py-2">{r.offCount}</td>
                  <td className="px-3 py-2">₹{r.regularityBonus}</td>
                  <td className="px-3 py-2 font-semibold">{inr(r.calculatedSalary)}</td>
                  <td className={cn("px-3 py-2 font-semibold", STATUS_CLASS[r.status])}>
                    {r.status}
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

/* ------------------------------ bits ----------------------- */

function Msg({ children }: { children: React.ReactNode }) {
  return (
    <Card className="rounded-xl border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
      {children}
    </Card>
  );
}
