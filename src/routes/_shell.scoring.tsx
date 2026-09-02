import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus } from "lucide-react";
import { PageHeader, EmptyState, MetricCard } from "@/components/officeverse/primitives";
import { RoleGate } from "@/components/officeverse/role-gate";
import { RuleBuilderDialog } from "@/components/officeverse/scoring/rule-builder";
import { DryRunPanel } from "@/components/officeverse/scoring/dry-run-panel";
import { HistoryDialog } from "@/components/officeverse/scoring/history-panel";
import { cn } from "@/lib/utils";
import {
  useScoringMeta,
  useScoringRules,
  useSetScoringRuleEnabled,
} from "@/lib/officeverse/use-scoring";
import type { ScoringRuleDTO } from "@/lib/officeverse/scoring-fns";

export const Route = createFileRoute("/_shell/scoring")({
  head: () => ({
    meta: [
      { title: "Scoring Engine — TMI Officeverse" },
      {
        name: "description",
        content:
          "Admin control center for open-ended, versioned scoring rules and dry-run testing. Recognition score only — no effect on pay.",
      },
    ],
  }),
  component: () => (
    <RoleGate allow={["admin"]}>
      <ScoringPage />
    </RoleGate>
  ),
});

function ScoringPage() {
  const meta = useScoringMeta();
  const rulesQ = useScoringRules();
  const toggle = useSetScoringRuleEnabled();

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<ScoringRuleDTO | null>(null);
  const [historyRule, setHistoryRule] = useState<ScoringRuleDTO | null>(null);
  const [tab, setTab] = useState("rules");
  const [dryEvent, setDryEvent] = useState<string | undefined>(undefined);

  const rules = rulesQ.data?.rules ?? [];
  const futureEvents = (meta.data?.events ?? []).filter((e) => !e.enabledForScoring).length;

  const stats = {
    total: rules.length,
    enabled: rules.filter((r) => r.enabled).length,
    disabled: rules.filter((r) => !r.enabled).length,
  };

  function openCreate() {
    setEditing(null);
    setBuilderOpen(true);
  }
  function openEdit(r: ScoringRuleDTO) {
    setEditing(r);
    setBuilderOpen(true);
  }
  async function setEnabled(r: ScoringRuleDTO, enabled: boolean) {
    try {
      await toggle.mutateAsync({ ruleId: r.id, enabled });
      toast.success(enabled ? "Rule enabled" : "Rule disabled — history kept");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the rule");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold uppercase text-warning">
            Live scoring OFF
          </span>
        }
        title="Scoring Engine"
        description="Author, version and dry-run open-ended scoring rules. Points are a recognition score — no effect on pay. Rules are not applied to live CRM events yet (that is a later phase); SCORING_ENGINE_ENABLED remains false."
        actions={
          <Button onClick={openCreate} className="rounded-full">
            <Plus className="mr-1.5 h-4 w-4" /> Create rule
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <MetricCard label="Custom rules" value={String(stats.total)} />
        <MetricCard label="Enabled" value={String(stats.enabled)} />
        <MetricCard label="Disabled" value={String(stats.disabled)} />
        <MetricCard label="Future events" value={String(futureEvents)} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="dryrun">Dry Run</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4">
          {rulesQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading rules…</p>
          ) : rules.length === 0 ? (
            <EmptyState
              emoji="🎯"
              title="No scoring rules yet"
              message="Create your first rule. It starts disabled — author it, dry-run it, then enable it. The engine ships with zero business values; you own every number."
              action={
                <Button onClick={openCreate} className="rounded-full">
                  <Plus className="mr-1.5 h-4 w-4" /> Create rule
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((r) => {
                    const cur = r.versions.find((v) => v.version === r.currentVersion);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-xs">{r.event}</TableCell>
                        <TableCell className="tabular-nums">{r.priority}</TableCell>
                        <TableCell className="text-xs">{r.ruleMatchingMode}</TableCell>
                        <TableCell className="text-xs">
                          v{r.currentVersion}
                          <span className="text-muted-foreground">
                            {" "}
                            · {r.versions.length} total
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">{cur?.effectiveFrom ?? "—"}</TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-semibold",
                              r.enabled
                                ? "bg-success/15 text-success"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {r.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => openEdit(r)}
                            >
                              Edit / New version
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setHistoryRule(r)}
                            >
                              History
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                setDryEvent(r.event);
                                setTab("dryrun");
                              }}
                            >
                              Dry run
                            </Button>
                            <Button
                              variant={r.enabled ? "outline" : "default"}
                              size="sm"
                              className="h-7 text-xs"
                              disabled={toggle.isPending}
                              onClick={() => setEnabled(r, !r.enabled)}
                            >
                              {r.enabled ? "Disable" : "Enable"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="dryrun" className="mt-4">
          <DryRunPanel key={dryEvent ?? "none"} {...(dryEvent ? { initialEvent: dryEvent } : {})} />
        </TabsContent>
      </Tabs>

      <RuleBuilderDialog open={builderOpen} onOpenChange={setBuilderOpen} editing={editing} />
      <HistoryDialog
        open={!!historyRule}
        onOpenChange={(v) => !v && setHistoryRule(null)}
        rule={historyRule}
      />
    </div>
  );
}
