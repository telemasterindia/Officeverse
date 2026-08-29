import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import {
  useAddHoliday,
  useAdminBonus,
  useDeactivateHoliday,
  useHolidays,
  useMyBonus,
  useRecalcBonus,
  useSeedUsFederal,
  useUpdateHoliday,
  type AdminBonusFilters,
  type HolidayFilters,
  type HolidayType,
  type ProcessCode,
} from "@/lib/officeverse/use-holiday";
import { useSession } from "@/lib/officeverse/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/holidays")({
  head: () => ({ meta: [{ title: "Holidays — TeleMaster India" }] }),
  component: HolidaysPage,
});

const HOLIDAY_TYPES: HolidayType[] = ["US_FEDERAL", "INDIAN", "COMPANY", "WEEKLY_OFF"];
const PROCESSES: ProcessCode[] = ["US", "UK", "IN", "AU"];

const REGULARITY_POLICY =
  "Employees with no Leave and no Off during the applicable calendar month are eligible for a ₹1,000 Regularity Bonus. Any Leave or Off makes the employee ineligible for that month's bonus.";

function thisYear(): string {
  return new Date().toISOString().slice(0, 4);
}
function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function HolidaysPage() {
  const { user } = useSession();
  const isManager = user?.role === "admin" || user?.role === "hr";
  return (
    <div className="space-y-6">
      <PageHeader
        title={isManager ? "Holidays & Regularity Bonus" : "Holiday calendar"}
        description={
          isManager
            ? "US federal holidays are generated from official rules (fixed-date, nth-weekday, weekend observance). Indian & company holidays are configured explicitly. Holiday dates feed the same connected non-working-day engine used for sandwich leave."
            : "Public holidays that apply to your process. Company-wide holidays apply to everyone."
        }
      />
      {isManager ? <ManagerHolidays /> : <EmployeeHolidays />}
      <BonusPolicy />
      {isManager ? <ManagerBonus /> : <EmployeeBonus />}
    </div>
  );
}

/* ============================ holidays — manager ==================== */

function ManagerHolidays() {
  const [filters, setFilters] = useState<HolidayFilters>({ year: thisYear() });
  const q = useHolidays(filters);
  const rows = q.data?.rows ?? [];
  const add = useAddHoliday();
  const update = useUpdateHoliday();
  const deactivate = useDeactivateHoliday();
  const seed = useSeedUsFederal();

  const [form, setForm] = useState({
    name: "",
    holidayType: "COMPANY" as HolidayType,
    holidayDate: "",
    observedDate: "",
    appliesToProcess: "" as "" | ProcessCode,
  });

  const set = (k: keyof HolidayFilters, v: string) =>
    setFilters((p) => {
      const n = { ...p };
      if (v) (n as Record<string, string>)[k] = v;
      else delete n[k];
      return n;
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.holidayDate) return;
    add.mutate(
      {
        name: form.name.trim(),
        holidayType: form.holidayType,
        holidayDate: form.holidayDate,
        ...(form.observedDate ? { observedDate: form.observedDate } : {}),
        ...(form.appliesToProcess ? { appliesToProcess: form.appliesToProcess } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Holiday added");
          setForm({
            name: "",
            holidayType: "COMPANY",
            holidayDate: "",
            observedDate: "",
            appliesToProcess: "",
          });
        },
        onError: (err) => toast.error(err.message || "Could not add holiday"),
      },
    );
  };

  return (
    <>
      <SectionCard title="Add a holiday">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-semibold">Name</span>
            <input
              className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Diwali, Founders' Day"
              required
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Type</span>
            <select
              className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
              value={form.holidayType}
              onChange={(e) => setForm({ ...form, holidayType: e.target.value as HolidayType })}
            >
              {HOLIDAY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Actual date</span>
            <input
              type="date"
              className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
              value={form.holidayDate}
              onChange={(e) => setForm({ ...form, holidayDate: e.target.value })}
              required
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Observed date (optional)</span>
            <input
              type="date"
              className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
              value={form.observedDate}
              onChange={(e) => setForm({ ...form, observedDate: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Process</span>
            <select
              className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
              value={form.appliesToProcess}
              onChange={(e) =>
                setForm({ ...form, appliesToProcess: e.target.value as "" | ProcessCode })
              }
            >
              <option value="">Company-wide (all processes)</option>
              {PROCESSES.map((p) => (
                <option key={p} value={p}>
                  {p} only
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-3 flex flex-wrap items-center gap-2">
            <Button type="submit" className="rounded-lg" disabled={add.isPending}>
              {add.isPending ? "Adding…" : "Add holiday"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Leave &ldquo;observed date&rdquo; blank unless the company moves the day off.
            </span>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Holiday calendar (Admin / HR)">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
              Year
            </span>
            <input
              className="w-24 rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
              value={filters.year ?? ""}
              onChange={(e) => set("year", e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="YYYY"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
              Type
            </span>
            <select
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
              value={filters.type ?? ""}
              onChange={(e) => set("type", e.target.value)}
            >
              <option value="">Any type</option>
              {HOLIDAY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
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
              <option value="">Any process</option>
              {PROCESSES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="ghost"
            className="rounded-lg"
            disabled={seed.isPending || !filters.year}
            onClick={() =>
              seed.mutate(
                { year: Number(filters.year ?? thisYear()) },
                {
                  onSuccess: (r) =>
                    r.dbUnavailable
                      ? toast.error("Database not connected")
                      : toast.success(
                          `US federal ${filters.year}: ${r.created} added, ${r.skipped} already present`,
                        ),
                  onError: (err) => toast.error(err.message || "Seed failed"),
                },
              )
            }
          >
            {seed.isPending ? "Seeding…" : `Seed US federal ${filters.year ?? ""}`}
          </Button>
        </div>

        {q.isLoading ? (
          <Msg>Loading…</Msg>
        ) : q.data?.dbUnavailable ? (
          <EmptyState
            emoji="🗄️"
            title="Database not connected"
            message="Holidays appear once the DB is configured."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            emoji="📅"
            title="No holidays"
            message="Add a holiday above, or seed the US federal calendar for the selected year."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-left text-xs uppercase">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Actual</th>
                  <th className="px-3 py-2">Observed</th>
                  <th className="px-3 py-2">Effective</th>
                  <th className="px-3 py-2">Process</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr
                    key={h.id}
                    className={cn("border-t border-border/60", !h.active && "opacity-50")}
                  >
                    <td className="px-3 py-2 font-medium">{h.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{h.holidayType}</td>
                    <td className="px-3 py-2 text-muted-foreground">{h.holidayDate}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {h.observed ? h.observedDate : "—"}
                    </td>
                    <td className="px-3 py-2 font-semibold">{h.effectiveDate}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {h.appliesToProcess ?? "All"}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-xs font-semibold",
                        h.active ? "text-success" : "text-muted-foreground",
                      )}
                    >
                      {h.active ? "ACTIVE" : "INACTIVE"}
                    </td>
                    <td className="px-3 py-2">
                      {h.active ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-lg"
                          disabled={deactivate.isPending}
                          onClick={() =>
                            deactivate.mutate(
                              { id: h.id },
                              {
                                onSuccess: () => toast.success("Holiday deactivated"),
                                onError: (err) => toast.error(err.message || "Failed"),
                              },
                            )
                          }
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-lg"
                          disabled={update.isPending}
                          onClick={() =>
                            update.mutate(
                              { id: h.id, active: true },
                              {
                                onSuccess: () => toast.success("Holiday reactivated"),
                                onError: (err) => toast.error(err.message || "Failed"),
                              },
                            )
                          }
                        >
                          Reactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}

/* ============================ holidays — employee ================== */

function EmployeeHolidays() {
  const [year, setYear] = useState(thisYear());
  const q = useHolidays({ year });
  const rows = q.data?.rows ?? [];
  return (
    <SectionCard title="My holiday calendar">
      <div className="mb-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
            Year
          </span>
          <input
            className="w-24 rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="YYYY"
          />
        </label>
      </div>
      {q.isLoading ? (
        <Msg>Loading…</Msg>
      ) : q.data?.dbUnavailable ? (
        <EmptyState
          emoji="🗄️"
          title="Database not connected"
          message="Your holiday calendar appears once the DB is configured."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="📅"
          title="No holidays listed"
          message="No holidays have been published for your process this year."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Holiday</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Date observed</th>
                <th className="px-3 py-2">Applies to</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id} className="border-t border-border/60">
                  <td className="px-3 py-2 font-medium">{h.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{h.holidayType}</td>
                  <td className="px-3 py-2">
                    {h.effectiveDate}
                    {h.observed ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (actual {h.holidayDate})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {h.appliesToProcess ?? "Everyone"}
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

/* ============================== bonus policy ====================== */

function BonusPolicy() {
  return (
    <Card className="rounded-xl border-border bg-secondary/30 p-4 text-sm shadow-sm">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Regularity Bonus policy
      </p>
      <p className="text-muted-foreground">{REGULARITY_POLICY}</p>
    </Card>
  );
}

/* ============================== bonus — employee ================= */

function EmployeeBonus() {
  const [month, setMonth] = useState(thisMonth());
  const q = useMyBonus(month);
  const b = q.data?.bonus;
  return (
    <SectionCard title="My Regularity Bonus">
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
          message="Your bonus appears once the DB is configured."
        />
      ) : !b ? (
        <Msg>Not calculated yet.</Msg>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p
              className={cn(
                "font-display text-3xl font-black",
                b.eligible ? "text-success" : "text-muted-foreground",
              )}
            >
              ₹{b.bonusAmount.toLocaleString("en-IN")}
            </p>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {b.month} · {b.eligible ? "Eligible" : "Not eligible"}
            </p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-medium">{b.reasonText}</p>
            <p className="text-xs text-muted-foreground">
              Leave days this month: {b.leaveCount} · Off records this month: {b.offCount}
            </p>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ============================== bonus — manager ================= */

function ManagerBonus() {
  const [filters, setFilters] = useState<AdminBonusFilters>({ month: thisMonth() });
  const q = useAdminBonus(filters);
  const rows = q.data?.rows ?? [];
  const recalc = useRecalcBonus();

  const set = (k: keyof AdminBonusFilters, v: string) =>
    setFilters((p) => {
      const n = { ...p };
      if (v === "") delete n[k];
      else if (k === "eligible") n.eligible = v === "yes";
      else (n as Record<string, string>)[k] = v;
      return n;
    });

  return (
    <SectionCard title="Regularity Bonus (Admin / HR)">
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
            Eligibility
          </span>
          <select
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
            value={filters.eligible === undefined ? "" : filters.eligible ? "yes" : "no"}
            onChange={(e) => set("eligible", e.target.value)}
          >
            <option value="">Any</option>
            <option value="yes">Eligible</option>
            <option value="no">Not eligible</option>
          </select>
        </label>
      </div>

      {q.isLoading ? (
        <Msg>Loading…</Msg>
      ) : q.data?.dbUnavailable ? (
        <EmptyState
          emoji="🗄️"
          title="Database not connected"
          message="Bonus records appear once the DB is configured."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="🧮"
          title="No bonus records"
          message="Bonus rows are created when you recalculate an employee's month from the Leave & Off page, or via the button below once a record exists."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Process</th>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2">Leave days</th>
                <th className="px-3 py-2">Off count</th>
                <th className="px-3 py-2">Eligibility</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b, i) => (
                <tr key={`${b.userId ?? i}-${b.month}`} className="border-t border-border/60">
                  <td className="px-3 py-2 font-medium">{b.employeeName ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{b.process ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{b.month}</td>
                  <td className="px-3 py-2">{b.leaveCount}</td>
                  <td className="px-3 py-2">{b.offCount}</td>
                  <td
                    className={cn(
                      "px-3 py-2 font-semibold",
                      b.eligible ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {b.eligible ? "Eligible" : "Not eligible"}
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    ₹{b.bonusAmount.toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{b.reasonText}</td>
                  <td className="px-3 py-2">
                    {b.userId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-lg"
                        disabled={recalc.isPending}
                        onClick={() =>
                          recalc.mutate(
                            { userId: b.userId!, month: b.month },
                            {
                              onSuccess: () => toast.success("Recalculated"),
                              onError: (err) => toast.error(err.message || "Failed"),
                            },
                          )
                        }
                      >
                        Recalculate
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

/* ------------------------------ bits --------------------------- */

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
