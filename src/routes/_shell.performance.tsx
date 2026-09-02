import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  MetricCard,
  PageHeader,
  SectionCard,
} from "@/components/officeverse/primitives";
import { StaffAvatar } from "@/components/officeverse/staff-avatar";
import { RoleGate } from "@/components/officeverse/role-gate";
import {
  incentiveSnapshotFn,
  performanceEmployeeFn,
  performanceLeaderboardFn,
} from "@/lib/officeverse/performance-fns";
import { incentiveResultsFn } from "@/lib/officeverse/incentive-fns";

export const Route = createFileRoute("/_shell/performance")({
  head: () => ({
    meta: [
      { title: "Performance Intelligence — TMI Officeverse" },
      {
        name: "description",
        content:
          "Operations leaderboard + explainable performance: points, event & rule attribution, per period. Recognition score only — no effect on pay.",
      },
    ],
  }),
  component: () => (
    <RoleGate allow={["admin", "closer"]}>
      <PerformancePage />
    </RoleGate>
  ),
});

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "custom", label: "Custom" },
] as const;
type Period = (typeof PERIODS)[number]["id"];

function PerformancePage() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period>("today");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openUser, setOpenUser] = useState<number | null>(null);

  const args = useMemo(
    () => ({
      period,
      ...(period === "custom" && from && to ? { from, to } : {}),
    }),
    [period, from, to],
  );
  const ready = period !== "custom" || (!!from && !!to);

  const board = useQuery({
    queryKey: ["perf", "board", args],
    queryFn: () => performanceLeaderboardFn({ data: args }),
    enabled: ready,
  });
  const snap = useQuery({
    queryKey: ["perf", "incentive", args],
    queryFn: () => incentiveSnapshotFn({ data: args }),
    enabled: ready,
  });

  const d = board.data;
  const cards = d?.cards;

  // Phase 9 — the calculated incentive results for exactly this operational window.
  // Read-only here; scheme management + calculation live on /operations.
  const pf = d?.period.from ?? null;
  const pt = d?.period.to ?? null;
  const incentives = useQuery({
    queryKey: ["perf", "incentiveResults", pf, pt],
    queryFn: () => incentiveResultsFn({ data: { from: pf!, to: pt! } }),
    enabled: !!pf && !!pt,
  });
  const incentiveByUser = useMemo(() => {
    const m = new Map<
      number,
      { rewardAmount: number; currency: string; status: string; count: number }
    >();
    for (const r of incentives.data?.results ?? []) {
      const prev = m.get(r.userId);
      const better =
        !prev ||
        r.rewardAmount > prev.rewardAmount ||
        (r.rewardAmount === prev.rewardAmount && r.status === "FINALIZED");
      m.set(r.userId, {
        rewardAmount: better ? r.rewardAmount : prev.rewardAmount,
        currency: r.currency,
        status: better ? r.status : prev.status,
        count: (prev?.count ?? 0) + 1,
      });
    }
    return m;
  }, [incentives.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["perf"] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance Intelligence"
        description="The Operations leaderboard + explainable performance breakdown. Every number is aggregated from the authoritative point ledger by operational (shift) date. Points are a recognition score — no effect on pay, HR or any financial calculation."
      />

      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <Button
            key={p.id}
            variant={period === p.id ? "default" : "outline"}
            size="sm"
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </Button>
        ))}
        {period === "custom" ? (
          <>
            <Input
              className="w-40"
              placeholder="from YYYY-MM-DD"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              className="w-40"
              placeholder="to YYYY-MM-DD"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </>
        ) : null}
        <Button variant="ghost" size="sm" onClick={refresh} title="Refresh after a scoring event">
          <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
        </Button>
        {d ? (
          <span className="text-xs text-muted-foreground">
            {d.period.from ?? "—"} → {d.period.to ?? "—"} · rank: {d.rankingRule}
          </span>
        ) : null}
      </div>

      {cards ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard label="Total points" value={cards.totalPoints} icon={Trophy} tone="accent" />
          <MetricCard label="Leads submitted" value={cards.totalLeadsSubmitted} />
          <MetricCard label="Leads accepted" value={cards.totalLeadsAccepted} />
          <MetricCard label="Sales" value={cards.totalSales} />
          <MetricCard
            label="Top performer"
            value={cards.topPerformer ? cards.topPerformer.name : "—"}
            hint={cards.topPerformer ? `${cards.topPerformer.points} pts` : "no points yet"}
          />
        </div>
      ) : null}

      <SectionCard title="Leaderboard">
        {!ready ? (
          <EmptyState title="Pick a custom range" message="Enter both from and to dates." />
        ) : board.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (d?.ranking.length ?? 0) === 0 ? (
          <EmptyState
            title="No points in this period"
            message="The board fills as the team earns."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">Submitted</TableHead>
                  <TableHead className="text-right">Accepted</TableHead>
                  <TableHead className="text-right">Follow-ups</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Rule-scored</TableHead>
                  <TableHead>Incentive</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d!.ranking.map((r) => (
                  <TableRow
                    key={r.userId}
                    className="cursor-pointer"
                    onClick={() => setOpenUser(openUser === r.userId ? null : r.userId)}
                  >
                    <TableCell className="font-mono">{r.rank}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <StaffAvatar
                          userId={r.userId}
                          name={r.name}
                          hasPhoto={r.photoAvailable}
                          size="medium"
                        />
                        {r.name}
                      </span>
                    </TableCell>
                    <TableCell>{r.role}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {r.points}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.leadsSubmitted}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.leadsAccepted}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.followUps}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.sales}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.scoredLeads}</TableCell>
                    <TableCell className="text-xs">
                      {(() => {
                        const inc = incentiveByUser.get(r.userId);
                        if (!inc) return <span className="text-muted-foreground">—</span>;
                        return (
                          <span
                            className={
                              inc.rewardAmount > 0
                                ? "font-medium text-foreground"
                                : "text-muted-foreground"
                            }
                          >
                            {inc.rewardAmount > 0
                              ? `${inc.currency} ${inc.rewardAmount.toLocaleString()}`
                              : "₹0"}{" "}
                            <span className="text-[10px] uppercase text-muted-foreground">
                              {inc.status}
                            </span>
                          </span>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          “Follow-ups” counts points-bearing FOLLOW_UP_COMPLETED ledger rows only. “Rule-scored” =
          ledger rows attributed to a Scoring-Engine rule. High-value leads are explained per rule
          in the drill-down. The “Incentive” column shows the incentive <b>calculated</b> for this
          exact window by the Phase-9 Incentive Engine ({incentiveByUser.size} employee
          {incentiveByUser.size === 1 ? "" : "s"} with a result) — schemes are configured and
          calculated on <b>Operations → Incentive Schemes</b>. Calculated ≠ paid.
        </p>
      </SectionCard>

      {openUser != null ? (
        <EmployeeDrilldown userId={openUser} args={args} onClose={() => setOpenUser(null)} />
      ) : null}

      <SectionCard title="Incentive Engine readiness (Phase 9 preview — no calculation)">
        {snap.data && snap.data.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">Accepted</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Rules matched</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snap.data.rows.map((r) => (
                  <TableRow key={r.userId}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.points}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.metrics.leadsAccepted}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.metrics.sales}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.ruleBreakdown.length}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            title="Nothing to hand off yet"
            message="Rows appear once employees earn points in the period."
          />
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {snap.data?.note ??
            "Phase-8 read model: employee + period + points + qualifying metrics + rule attribution. No incentive value."}
        </p>
      </SectionCard>
    </div>
  );
}

function EmployeeDrilldown({
  userId,
  args,
  onClose,
}: {
  userId: number;
  args: Record<string, unknown>;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["perf", "employee", userId, args],
    queryFn: () => performanceEmployeeFn({ data: { ...args, userId } as never }),
  });
  const e = q.data;
  return (
    <SectionCard
      title={e ? `${e.name} — ${e.totalPoints} points` : "Employee performance"}
      action={
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      {q.isLoading || !e ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold">By event</h3>
            <div className="flex flex-wrap gap-2">
              {e.eventBreakdown.length === 0 ? (
                <span className="text-xs text-muted-foreground">No points in this period.</span>
              ) : (
                e.eventBreakdown.map((b) => (
                  <span
                    key={b.event}
                    className="rounded-full border border-border px-3 py-1 text-xs"
                  >
                    {b.event} <b>+{b.points}</b> ({b.count})
                  </span>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">By scoring rule</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule</TableHead>
                    <TableHead>Ver</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {e.ruleBreakdown.map((r, i) => (
                    <TableRow key={`${r.ruleId ?? "legacy"}-${r.event}-${i}`}>
                      <TableCell>
                        {r.ruleName ?? (r.ruleId ? `#${r.ruleId}` : "Legacy / flat rule")}
                      </TableCell>
                      <TableCell>{r.ruleVersion ?? "—"}</TableCell>
                      <TableCell>{r.event}</TableCell>
                      <TableCell className="text-right tabular-nums">+{r.points}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Ledger (explainable)</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Op. date</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {e.ledger.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-xs">{t.operationalDate}</TableCell>
                      <TableCell>{t.event}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.points > 0 ? "+" : ""}
                        {t.points}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.ruleName ? `${t.ruleName} v${t.ruleVersion ?? "?"}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.source}
                        {t.referenceType ? ` · ${t.referenceType}:${t.referenceId ?? ""}` : ""}
                      </TableCell>
                      <TableCell className="text-xs">{t.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
