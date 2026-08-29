import { createFileRoute } from "@tanstack/react-router";
import React, { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import {
  useAddAdjustment,
  useAdminOvertime,
  useAdminPayroll,
  useApprovePayroll,
  useCalculatePayroll,
  useDecideOvertime,
  useEmploymentPeriods,
  useLockPayroll,
  useMyOvertime,
  useMyPayroll,
  usePayrollBreakdown,
  useRecordOvertime,
  useReopenPayroll,
  useSalaryProfiles,
  useSetEmploymentPeriod,
  useSetSalaryProfile,
  useVoidAdjustment,
  type AdminPayrollFilters,
  type PayrollStatus,
  type ProcessCode,
} from "@/lib/officeverse/use-payroll";
import {
  useAdminSalarySlips,
  useDownloadSalarySlip,
  useGenerateSalarySlip,
  useMonthlyDeliveryPreview,
  useMySalarySlips,
  useRunMonthlyDelivery,
  useSalarySlipHistory,
  useSendSalarySlip,
  type AdminSlipFilters,
  type ProcessCode as SlipProcessCode,
} from "@/lib/officeverse/use-salary-slip";
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
          <PayrollInputs />
          <ManagerSalarySlips />
          <MonthlyDelivery />
        </>
      ) : (
        <>
          <EmployeePayroll />
          <EmployeeSalarySlips />
        </>
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
  const generate = useGenerateSalarySlip();
  const [breakdown, setBreakdown] = useState<{ userId: number; month: string } | null>(null);

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
                <th className="px-3 py-2">Monthly base</th>
                <th className="px-3 py-2">Payable base</th>
                <th className="px-3 py-2">Leave</th>
                <th className="px-3 py-2">Unpaid</th>
                <th className="px-3 py-2">Off</th>
                <th className="px-3 py-2">OT min</th>
                <th className="px-3 py-2">Adjust.</th>
                <th className="px-3 py-2">Regularity bonus</th>
                <th className="px-3 py-2">Gross salary</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Breakdown</th>
                <th className="px-3 py-2">Salary slip</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={`${r.userId}-${r.month}`}>
                  <tr className="border-t border-border/60">
                    <td className="px-3 py-2 font-medium">{r.employeeName ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.process}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.month}</td>
                    <td className="px-3 py-2">{inr(r.monthlyBaseSalary)}</td>
                    <td className="px-3 py-2">
                      {inr(r.payableBaseSalary)}
                      {r.prorationBasis ? (
                        <span className="block text-[10px] text-muted-foreground">
                          {r.prorationNumerator}/{r.prorationDenominator} {r.prorationBasis}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{r.leaveCount}</td>
                    <td className="px-3 py-2">{r.unpaidLeaveDays}</td>
                    <td className="px-3 py-2">{r.offCount}</td>
                    <td className="px-3 py-2">{r.approvedOvertimeMinutes}</td>
                    <td className="px-3 py-2">{inr(r.adjustmentsTotal)}</td>
                    <td className="px-3 py-2">₹{r.regularityBonus}</td>
                    <td className="px-3 py-2 font-semibold">{inr(r.calculatedSalary)}</td>
                    <td className={cn("px-3 py-2 font-semibold", STATUS_CLASS[r.status])}>
                      {r.status}
                    </td>
                    <td className="px-3 py-2">
                      {r.userId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-lg"
                          onClick={() =>
                            setBreakdown((b) =>
                              b && b.userId === r.userId && b.month === r.month
                                ? null
                                : { userId: r.userId!, month: r.month },
                            )
                          }
                        >
                          Why?
                        </Button>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {(r.status === "APPROVED" || r.status === "LOCKED") && r.payrollRunId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-lg"
                          disabled={generate.isPending}
                          onClick={() =>
                            generate.mutate(
                              { payrollRunId: r.payrollRunId! },
                              {
                                onSuccess: (res) =>
                                  toast.success(
                                    res.reused
                                      ? "Salary slip already generated"
                                      : `Salary slip v${res.slip.version} generated`,
                                  ),
                                onError: (err) => toast.error(err.message || "Generate failed"),
                              },
                            )
                          }
                        >
                          Generate
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Approve/lock first</span>
                      )}
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
                              const reason = window.prompt(
                                "Reason for reopening this payroll run?",
                              );
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
                  {breakdown && breakdown.userId === r.userId && breakdown.month === r.month ? (
                    <tr className="bg-secondary/20">
                      <td colSpan={14} className="px-3 py-3">
                        <BreakdownPanel userId={r.userId!} month={r.month} />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/* -------------------- calculation breakdown ---------------- */

function BreakdownPanel({ userId, month }: { userId: number; month: string }) {
  const q = usePayrollBreakdown(userId, month);
  if (q.isLoading) return <p className="text-xs text-muted-foreground">Loading breakdown…</p>;
  const d = q.data;
  if (!d || d.dbUnavailable || !d.payroll) {
    return <p className="text-xs text-muted-foreground">No calculated payroll for this month.</p>;
  }
  const p = d.payroll;
  const line = (k: string, v: string, strong = false) => (
    <div className="flex justify-between gap-4 py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className={strong ? "font-semibold" : ""}>{v}</span>
    </div>
  );
  return (
    <div className="grid gap-4 text-xs sm:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="mb-1 font-semibold uppercase text-muted-foreground">
          How this salary was calculated
        </p>
        {line("Monthly base salary", inr(p.monthlyBaseSalary))}
        {line(
          `Payable base${p.prorationBasis ? ` (${p.prorationNumerator}/${p.prorationDenominator} ${p.prorationBasis})` : " (full month)"}`,
          inr(p.payableBaseSalary),
        )}
        {line(`+ Regularity bonus`, `₹${p.regularityBonus}`)}
        {line(`+ Overtime (${p.approvedOvertimeMinutes} min)`, inr(p.overtimeAmount))}
        {line("+ Adjustments", inr(p.adjustmentsTotal))}
        {line(`− Unpaid leave (${p.unpaidLeaveDays} d)`, inr(p.unpaidLeaveDeduction))}
        {line(`− Off (${p.offDaysConsidered})`, inr(p.offDeduction))}
        {line("= Gross (before statutory)", inr(p.calculatedSalary), true)}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Calc version {p.calculationVersion}. {d.roundingPolicy}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="mb-1 font-semibold uppercase text-muted-foreground">Notes</p>
        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
          {d.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
        {d.adjustments.length > 0 ? (
          <>
            <p className="mb-1 mt-2 font-semibold uppercase text-muted-foreground">Adjustments</p>
            <ul className="space-y-0.5">
              {d.adjustments.map((a) => (
                <li key={a.id} className={a.status === "VOID" ? "line-through opacity-60" : ""}>
                  {a.kind === "DEDUCTION" ? "−" : "+"}
                  {inr(a.amount)} · {a.label} ({a.status})
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ========================= employee view ==================== */

function EmployeePayroll() {
  const [month, setMonth] = useState("");
  const [open, setOpen] = useState<string | null>(null);
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
                <th className="px-3 py-2">Monthly base</th>
                <th className="px-3 py-2">Payable base</th>
                <th className="px-3 py-2">Leave / Unpaid</th>
                <th className="px-3 py-2">Off</th>
                <th className="px-3 py-2">Overtime</th>
                <th className="px-3 py-2">Regularity bonus</th>
                <th className="px-3 py-2">Gross salary</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.month}>
                  <tr className="border-t border-border/60">
                    <td className="px-3 py-2 text-muted-foreground">{r.month}</td>
                    <td className="px-3 py-2">{inr(r.monthlyBaseSalary)}</td>
                    <td className="px-3 py-2">{inr(r.payableBaseSalary)}</td>
                    <td className="px-3 py-2">
                      {r.leaveCount} / {r.unpaidLeaveDays}
                    </td>
                    <td className="px-3 py-2">{r.offCount}</td>
                    <td className="px-3 py-2">{r.approvedOvertimeMinutes} min</td>
                    <td className="px-3 py-2">₹{r.regularityBonus}</td>
                    <td className="px-3 py-2 font-semibold">{inr(r.calculatedSalary)}</td>
                    <td className={cn("px-3 py-2 font-semibold", STATUS_CLASS[r.status])}>
                      {r.status}
                    </td>
                    <td className="px-3 py-2">
                      {r.userId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-lg"
                          onClick={() => setOpen((o) => (o === r.month ? null : r.month))}
                        >
                          Why?
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                  {open === r.month && r.userId ? (
                    <tr className="bg-secondary/20">
                      <td colSpan={10} className="px-3 py-3">
                        <BreakdownPanel userId={r.userId} month={r.month} />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/* =================== payroll input foundations ============= */

function PayrollInputs() {
  const [uid, setUid] = useState("");
  const userId = Number(uid) > 0 ? Number(uid) : null;
  const [month, setMonth] = useState(thisMonth());

  const periods = useEmploymentPeriods(userId);
  const setPeriod = useSetEmploymentPeriod();
  const recordOt = useRecordOvertime();
  const decideOt = useDecideOvertime();
  const otList = useAdminOvertime({ status: "PENDING" });
  const addAdj = useAddAdjustment();
  const voidAdj = useVoidAdjustment();

  const [pf, setPf] = useState({ startDate: "", endDate: "", note: "" });
  const [otf, setOtf] = useState({ workDate: "", minutes: "", reason: "" });
  const [af, setAf] = useState({ kind: "DEDUCTION", label: "", amount: "", reason: "" });

  return (
    <SectionCard title="Payroll inputs (Admin / HR)">
      <p className="mb-3 text-xs text-muted-foreground">
        Employment dates drive proration (only when a proration basis is configured). Overtime is
        recorded + approved but has <strong>no rate</strong>, so its payroll amount is ₹0.
        Adjustments are explicit HR-entered amounts with a reason.
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
            Employee user ID
          </span>
          <input
            className="w-28 rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
            value={uid}
            inputMode="numeric"
            onChange={(e) => setUid(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
            Month
          </span>
          <input
            type="month"
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
      </div>

      {userId ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* employment period */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Employment period
            </p>
            <div className="space-y-2 text-sm">
              <input
                type="date"
                aria-label="Start date"
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
                value={pf.startDate}
                onChange={(e) => setPf({ ...pf, startDate: e.target.value })}
              />
              <input
                type="date"
                aria-label="End date (optional)"
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
                value={pf.endDate}
                onChange={(e) => setPf({ ...pf, endDate: e.target.value })}
              />
              <Button
                size="sm"
                className="rounded-lg"
                disabled={setPeriod.isPending || !pf.startDate}
                onClick={() =>
                  setPeriod.mutate(
                    {
                      userId,
                      startDate: pf.startDate,
                      ...(pf.endDate ? { endDate: pf.endDate } : {}),
                      ...(pf.note ? { note: pf.note } : {}),
                    },
                    {
                      onSuccess: () => {
                        toast.success("Employment period saved");
                        setPf({ startDate: "", endDate: "", note: "" });
                      },
                      onError: (e) => toast.error(e.message || "Failed"),
                    },
                  )
                }
              >
                Add period
              </Button>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {(periods.data?.rows ?? []).map((p) => (
                  <li key={p.id}>
                    {p.startDate} → {p.endDate ?? "current"} {p.active ? "" : "(inactive)"}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* overtime */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Record overtime
            </p>
            <div className="space-y-2 text-sm">
              <input
                type="date"
                aria-label="Work date"
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
                value={otf.workDate}
                onChange={(e) => setOtf({ ...otf, workDate: e.target.value })}
              />
              <input
                aria-label="Overtime minutes"
                placeholder="minutes"
                inputMode="numeric"
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
                value={otf.minutes}
                onChange={(e) => setOtf({ ...otf, minutes: e.target.value.replace(/\D/g, "") })}
              />
              <Button
                size="sm"
                className="rounded-lg"
                disabled={recordOt.isPending || !otf.workDate || !otf.minutes}
                onClick={() =>
                  recordOt.mutate(
                    {
                      userId,
                      workDate: otf.workDate,
                      overtimeMinutes: Number(otf.minutes),
                      ...(otf.reason ? { reason: otf.reason } : {}),
                    },
                    {
                      onSuccess: () => {
                        toast.success("Overtime recorded (PENDING)");
                        setOtf({ workDate: "", minutes: "", reason: "" });
                      },
                      onError: (e) => toast.error(e.message || "Failed"),
                    },
                  )
                }
              >
                Record
              </Button>
            </div>
          </div>

          {/* adjustment */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Payroll adjustment ({month})
            </p>
            <div className="space-y-2 text-sm">
              <select
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
                value={af.kind}
                onChange={(e) => setAf({ ...af, kind: e.target.value })}
              >
                <option value="DEDUCTION">Deduction (−)</option>
                <option value="EARNING">Earning (+)</option>
              </select>
              <input
                placeholder="label"
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
                value={af.label}
                onChange={(e) => setAf({ ...af, label: e.target.value })}
              />
              <input
                placeholder="amount (₹)"
                inputMode="decimal"
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
                value={af.amount}
                onChange={(e) => setAf({ ...af, amount: e.target.value })}
              />
              <Button
                size="sm"
                className="rounded-lg"
                disabled={addAdj.isPending || !af.label || !af.amount}
                onClick={() =>
                  addAdj.mutate(
                    {
                      userId,
                      month,
                      kind: af.kind as "EARNING" | "DEDUCTION",
                      label: af.label,
                      amount: Number(af.amount),
                      ...(af.reason ? { reason: af.reason } : {}),
                    },
                    {
                      onSuccess: () => {
                        toast.success("Adjustment added — recalculate payroll to apply");
                        setAf({ kind: "DEDUCTION", label: "", amount: "", reason: "" });
                      },
                      onError: (e) => toast.error(e.message || "Failed"),
                    },
                  )
                }
              >
                Add adjustment
              </Button>
              <p className="text-[10px] text-muted-foreground">
                Void via the breakdown panel. Recalculate the run to apply changes.
              </p>
              <button
                type="button"
                className="text-[10px] underline"
                onClick={() => {
                  const id = window.prompt("Adjustment id to VOID?");
                  if (id && Number(id) > 0)
                    voidAdj.mutate(
                      { adjustmentId: Number(id) },
                      {
                        onSuccess: () => toast.success("Voided"),
                        onError: (e) => toast.error(e.message),
                      },
                    );
                }}
              >
                void an adjustment by id
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Enter an employee user ID to manage inputs.</p>
      )}

      {/* pending overtime approvals */}
      <div className="mt-4">
        <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
          Pending overtime approvals
        </p>
        {(otList.data?.rows ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing pending.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {(otList.data?.rows ?? []).map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2">
                user #{o.userId} · {o.workDate} · {o.overtimeMinutes} min · amount{" "}
                {inr(o.overtimeAmount)}
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-lg"
                  disabled={decideOt.isPending}
                  onClick={() =>
                    decideOt.mutate(
                      { overtimeId: o.id, decision: "APPROVED" },
                      {
                        onSuccess: () => toast.success("Approved"),
                        onError: (e) => toast.error(e.message),
                      },
                    )
                  }
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-lg"
                  disabled={decideOt.isPending}
                  onClick={() =>
                    decideOt.mutate(
                      { overtimeId: o.id, decision: "REJECTED" },
                      {
                        onSuccess: () => toast.success("Rejected"),
                        onError: (e) => toast.error(e.message),
                      },
                    )
                  }
                >
                  Reject
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

/* ===================== manager salary slips ================ */

const SLIP_STATUS_CLASS: Record<string, string> = {
  GENERATED: "text-warning",
  SENT: "text-success",
  FAILED: "text-destructive",
};

function ManagerSalarySlips() {
  const [filters, setFilters] = useState<AdminSlipFilters>({ month: thisMonth() });
  const q = useAdminSalarySlips(filters);
  const rows = q.data?.rows ?? [];
  const send = useSendSalarySlip();
  const download = useDownloadSalarySlip();
  const [historyId, setHistoryId] = useState<number | null>(null);
  const history = useSalarySlipHistory(historyId);

  const set = (k: keyof AdminSlipFilters, v: string) =>
    setFilters((p) => {
      const n = { ...p };
      if (v) (n as Record<string, string>)[k] = v;
      else delete n[k];
      return n;
    });

  return (
    <SectionCard title="Salary slips (Admin / HR)">
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
            Status
          </span>
          <select
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
            value={filters.status ?? ""}
            onChange={(e) => set("status", e.target.value)}
          >
            <option value="">Any</option>
            {["GENERATED", "SENT", "FAILED"].map((s) => (
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
          message="Salary slips appear once the DB is configured."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="📄"
          title="No salary slips"
          message="Generate one from an APPROVED or LOCKED payroll run above."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2">Ver</th>
                <th className="px-3 py-2">Calculated salary</th>
                <th className="px-3 py-2">Slip status</th>
                <th className="px-3 py-2">Sends</th>
                <th className="px-3 py-2">Last sent</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-t border-border/60">
                  <td className="px-3 py-2 font-medium">
                    {s.employeeName}
                    {s.isPreview ? (
                      <span className="ml-1 rounded bg-warning/20 px-1 text-[10px] font-semibold uppercase text-warning">
                        preview
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{s.month}</td>
                  <td className="px-3 py-2 text-muted-foreground">v{s.version}</td>
                  <td className="px-3 py-2 font-semibold">{inr(s.calculatedSalary)}</td>
                  <td
                    className={cn(
                      "px-3 py-2 font-semibold",
                      SLIP_STATUS_CLASS[s.status] ?? "text-muted-foreground",
                    )}
                  >
                    {s.status}
                    {s.status === "FAILED" && s.lastError ? (
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {s.lastError}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{s.sendCount}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{s.lastSentAt ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        className="rounded-lg"
                        disabled={send.isPending}
                        onClick={() =>
                          send.mutate(
                            { salarySlipId: s.id },
                            {
                              onSuccess: () => toast.success("Salary slip emailed"),
                              onError: (err) => toast.error(err.message || "Send failed"),
                            },
                          )
                        }
                      >
                        {s.status === "SENT" ? "Resend" : "Send"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-lg"
                        disabled={download.isPending}
                        onClick={() => download.mutate({ salarySlipId: s.id })}
                      >
                        Download
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-lg"
                        onClick={() => setHistoryId(historyId === s.id ? null : s.id)}
                      >
                        History
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {historyId != null ? (
        <div className="mt-3 rounded-lg border border-border bg-secondary/20 p-3 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Send history — slip #{historyId}
          </p>
          {history.isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (history.data?.sends?.length ?? 0) === 0 ? (
            <p className="text-muted-foreground">No send attempts yet.</p>
          ) : (
            <ul className="space-y-1">
              {history.data!.sends.map((h, i) => (
                <li key={i} className="text-xs">
                  <span
                    className={cn(
                      "font-semibold",
                      h.status === "SENT" ? "text-success" : "text-destructive",
                    )}
                  >
                    #{h.attemptNo} {h.status}
                  </span>{" "}
                  → {h.recipientEmail} · {h.createdAt}
                  {h.errorMessage ? ` · ${h.errorMessage}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </SectionCard>
  );
}

/* ================== monthly salary-slip delivery ============ */

interface DeliverySummary {
  month: string;
  process: string | null;
  dryRun: boolean;
  totalPayrollRuns: number;
  skippedNonLocked: number;
  lockedEligible: number;
  missingEmail: number;
  generated: number;
  alreadyGenerated: number;
  wouldGenerate: number;
  sent: number;
  alreadySent: number;
  wouldSend: number;
  failed: number;
  failures: { userId: number; salarySlipId?: number; reason: string }[];
}

function MonthlyDelivery() {
  const [month, setMonth] = useState(thisMonth());
  const [proc, setProc] = useState<"" | SlipProcessCode>("");
  const [summary, setSummary] = useState<DeliverySummary | null>(null);
  const preview = useMonthlyDeliveryPreview();
  const run = useRunMonthlyDelivery();
  const busy = preview.isPending || run.isPending;

  const payload = () => ({ month, ...(proc ? { process: proc as SlipProcessCode } : {}) });

  const doPreview = () => {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      toast.error("Pick a month");
      return;
    }
    preview.mutate(payload(), {
      onSuccess: (s) => {
        setSummary(s as DeliverySummary);
        toast.success("Dry run complete — no emails sent");
      },
      onError: (e) => toast.error(e.message || "Preview failed"),
    });
  };

  const doRun = () => {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      toast.error("Pick a month");
      return;
    }
    if (!window.confirm(`Generate and email salary slips for LOCKED payroll in ${month}?`)) return;
    run.mutate(payload(), {
      onSuccess: (s) => {
        setSummary(s as DeliverySummary);
        toast.success(`Delivery complete — ${s.sent} sent, ${s.failed} failed`);
      },
      onError: (e) => toast.error(e.message || "Delivery failed"),
    });
  };

  return (
    <SectionCard title="Monthly Salary Slip Delivery (Admin / HR)">
      <p className="mb-3 text-xs text-muted-foreground">
        Processes only <strong>LOCKED</strong> payroll runs. A slip already sent is skipped
        (ALREADY_SENT); a failed slip is retried, reusing the same document. Preview never sends
        email.
      </p>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
            Payroll month
          </span>
          <input
            type="month"
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
            Process
          </span>
          <select
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
            value={proc}
            onChange={(e) => setProc(e.target.value as "" | SlipProcessCode)}
          >
            <option value="">All</option>
            {PROCESSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <Button variant="ghost" className="rounded-lg" disabled={busy} onClick={doPreview}>
          {preview.isPending ? "Previewing…" : "Preview (dry run)"}
        </Button>
        <Button className="rounded-lg" disabled={busy} onClick={doRun}>
          {run.isPending ? "Processing…" : "Process & send"}
        </Button>
      </div>

      {summary ? (
        <div className="rounded-lg border border-border bg-secondary/20 p-3 text-sm">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            {summary.dryRun ? "Dry run" : "Result"} — {summary.month}
            {summary.process ? ` · ${summary.process}` : ""}
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
            <Kv k="Payroll runs" v={summary.totalPayrollRuns} />
            <Kv k="LOCKED eligible" v={summary.lockedEligible} />
            <Kv k="Skipped (non-locked)" v={summary.skippedNonLocked} />
            <Kv k="Missing email" v={summary.missingEmail} />
            {summary.dryRun ? (
              <>
                <Kv k="Would generate" v={summary.wouldGenerate} />
                <Kv k="Already generated" v={summary.alreadyGenerated} />
                <Kv k="Would send" v={summary.wouldSend} />
                <Kv k="Already sent" v={summary.alreadySent} />
              </>
            ) : (
              <>
                <Kv k="Generated" v={summary.generated} />
                <Kv k="Already generated" v={summary.alreadyGenerated} />
                <Kv k="Sent" v={summary.sent} tone="ok" />
                <Kv k="Already sent" v={summary.alreadySent} />
                <Kv k="Failed" v={summary.failed} tone={summary.failed ? "bad" : undefined} />
              </>
            )}
          </div>
          {summary.failures.length > 0 ? (
            <div className="mt-2">
              <p className="text-xs font-semibold uppercase text-destructive">Failures</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {summary.failures.map((f, i) => (
                  <li key={i}>
                    user #{f.userId}
                    {f.salarySlipId ? ` · slip #${f.salarySlipId}` : ""} · {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}

function Kv({ k, v, tone }: { k: string; v: number; tone?: "ok" | "bad" | undefined }) {
  return (
    <div>
      <span
        className={cn(
          "font-display text-lg font-black",
          tone === "ok" && "text-success",
          tone === "bad" && "text-destructive",
        )}
      >
        {v}
      </span>
      <span className="ml-1 text-[11px] uppercase tracking-wide text-muted-foreground">{k}</span>
    </div>
  );
}

/* ===================== employee salary slips =============== */

function EmployeeSalarySlips() {
  const [month, setMonth] = useState("");
  const q = useMySalarySlips(month || undefined);
  const rows = q.data?.rows ?? [];
  const download = useDownloadSalarySlip();
  return (
    <SectionCard title="My salary slips">
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
          message="Your salary slips appear once the DB is configured."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="📄"
          title="No salary slips yet"
          message="Your salary slip will appear here once HR generates it."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2">Version</th>
                <th className="px-3 py-2">Calculated salary</th>
                <th className="px-3 py-2">Slip status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-t border-border/60">
                  <td className="px-3 py-2 text-muted-foreground">
                    {s.month}
                    {s.isPreview ? (
                      <span className="ml-1 rounded bg-warning/20 px-1 text-[10px] font-semibold uppercase text-warning">
                        preview
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">v{s.version}</td>
                  <td className="px-3 py-2 font-semibold">{inr(s.calculatedSalary)}</td>
                  <td
                    className={cn(
                      "px-3 py-2 font-semibold",
                      SLIP_STATUS_CLASS[s.status] ?? "text-muted-foreground",
                    )}
                  >
                    {s.status}
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-lg"
                      disabled={download.isPending}
                      onClick={() => download.mutate({ salarySlipId: s.id })}
                    >
                      Download
                    </Button>
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
