import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Gift } from "lucide-react";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { RoleGate } from "@/components/officeverse/role-gate";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { myIncentiveFn } from "@/lib/officeverse/incentive-fns";

export const Route = createFileRoute("/_shell/incentives")({
  head: () => ({
    meta: [
      { title: "My Incentive — TMI Officeverse" },
      {
        name: "description",
        content:
          "Your incentive status per period: the active scheme, whether you qualified, and the incentive it earned. A recognition of performance — not salary, never paid through this screen.",
      },
    ],
  }),
  component: () => (
    <RoleGate allow={["agent", "closer", "admin"]}>
      <MyIncentivePage />
    </RoleGate>
  ),
});

const PERIODS = [
  { id: "daily", label: "Today" },
  { id: "weekly", label: "This Week" },
  { id: "monthly", label: "This Month" },
] as const;
type Period = (typeof PERIODS)[number]["id"];

const PAYABLE = ["CALCULATED", "REVIEWED", "APPROVED", "FINALIZED"];

function MyIncentivePage() {
  const [period, setPeriod] = useState<Period>("monthly");
  const q = useQuery({
    queryKey: ["my-incentive", period],
    queryFn: () => myIncentiveFn({ data: { period } }),
  });
  const d = q.data;
  const rows = d?.results ?? [];
  const currency = rows[0]?.currency ?? "INR";
  const earned = rows
    .filter((r) => PAYABLE.includes(r.status))
    .reduce((sum, r) => sum + r.rewardAmount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Incentive"
        description="Your incentive status for the selected period — the scheme that applied, the conditions checked, and the incentive that was calculated. Incentives recognise performance. They are calculated by the Incentive Engine from your recognition points and are NOT salary; nothing is paid through this screen."
      />

      <div className="flex flex-wrap gap-1.5">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPeriod(p.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              period === p.id
                ? "bg-primary text-primary-foreground"
                : "bg-secondary/60 text-muted-foreground hover:bg-secondary",
            )}
          >
            {p.label}
          </button>
        ))}
        {d ? (
          <span className="self-center text-xs text-muted-foreground">
            {d.period.from ?? "—"} → {d.period.to ?? "—"}
          </span>
        ) : null}
      </div>

      {q.isLoading ? (
        <Card className="rounded-xl border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
          Loading your incentive…
        </Card>
      ) : !d || d.dbUnavailable ? (
        <EmptyState
          emoji="🗄️"
          title="Database not connected"
          message="Your incentive view needs the database."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="🎁"
          title="No incentive calculated yet"
          message="No incentive scheme has been calculated for you in this period. When Operations runs a scheme that covers you, the result and its explanation appear here."
        />
      ) : (
        <>
          <Card className="rounded-xl border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <span className="rounded-xl bg-primary/10 p-3 text-primary">
                <Gift className="h-6 w-6" aria-hidden />
              </span>
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  {earned > 0 ? `${currency} ${earned.toLocaleString()}` : `${currency} 0`}
                </p>
                <p className="text-xs text-muted-foreground">
                  calculated across {rows.length} scheme{rows.length === 1 ? "" : "s"} for this
                  period · calculated ≠ paid
                </p>
              </div>
            </div>
          </Card>

          <SectionCard title="Schemes & explanation">
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary/60 text-left text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2">Scheme</th>
                    <th className="px-3 py-2">Ver</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Points</th>
                    <th className="px-3 py-2 text-right">Incentive</th>
                    <th className="px-3 py-2">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const exp = r.explanation as {
                      scheme?: string;
                      reason?: string;
                      checks?: unknown[];
                    } | null;
                    return (
                      <tr key={r.id} className="border-t border-border/60 align-top">
                        <td className="px-3 py-2 font-medium">{exp?.scheme ?? `#${r.schemeId}`}</td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          v{r.schemeVersion}
                        </td>
                        <td className="px-3 py-2 text-xs uppercase text-muted-foreground">
                          {r.status}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.points}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {r.rewardAmount > 0
                            ? `${r.currency} ${r.rewardAmount.toLocaleString()}`
                            : r.rewardLabel
                              ? r.rewardLabel
                              : `${r.currency} 0`}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {exp?.reason ?? r.reason ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              The version shown is the scheme version effective on the period start — a later edit
              to the scheme never changes a result that was already calculated. Approval and
              finalisation are performed by an Admin; this screen is read-only.
            </p>
          </SectionCard>
        </>
      )}
    </div>
  );
}
