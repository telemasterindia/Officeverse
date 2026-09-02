/**
 * Officeverse — Scoring Console: rule history + version diff.
 *
 * Every edit appends an immutable `scoring_rule_versions` row. This view lists
 * them newest-first and shows a human-readable diff between any two — no raw
 * JSON unless expanded. Nothing here mutates anything.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useScoringMeta } from "@/lib/officeverse/use-scoring";
import {
  diffVersions,
  humanizeCondition,
  humanizeOutcome,
  humanizeAppliesTo,
  type AppliesTo,
} from "@/lib/officeverse/scoring-ui";
import type { ScoringRuleDTO } from "@/lib/officeverse/scoring-fns";
import type { ConditionNode } from "@/server/scoring/conditions";
import type { Outcome } from "@/server/scoring/modes";

export function HistoryDialog({
  open,
  onOpenChange,
  rule,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rule: ScoringRuleDTO | null;
}) {
  const meta = useScoringMeta();
  const fieldLabel = (k: string) => meta.data?.fields.find((f) => f.key === k)?.label ?? k;

  const versions = [...(rule?.versions ?? [])].sort((a, b) => b.version - a.version);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);

  const va = versions.find((v) => v.version === a) ?? null;
  const vb = versions.find((v) => v.version === b) ?? null;
  const rows = va && vb ? diffVersions(va, vb, fieldLabel) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>History — {rule?.name}</DialogTitle>
          <DialogDescription>
            Every version is immutable. Historical points are never recalculated when a newer
            version is added. Pick two versions to compare.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {versions.map((v) => (
            <div
              key={v.version}
              className={cn(
                "rounded-lg border p-3",
                v.version === rule?.currentVersion
                  ? "border-primary/50 bg-primary/5"
                  : "border-border",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  Version {v.version}
                  {v.version === rule?.currentVersion ? " · Current" : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {v.effectiveFrom} → {v.effectiveUntil ?? "open"}
                </span>
              </div>
              <dl className="mt-1.5 space-y-0.5 text-sm">
                <DRow
                  k="Conditions"
                  v={humanizeCondition(v.conditionTree as ConditionNode | null, fieldLabel)}
                />
                <DRow k="Outcome" v={humanizeOutcome(v.outcome as Outcome | null)} />
                <DRow
                  k="Applies to"
                  v={humanizeAppliesTo(v.appliesToSnapshot as AppliesTo | null)}
                />
              </dl>
              <div className="mt-2 flex gap-3 text-xs">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="diffA"
                    checked={a === v.version}
                    onChange={() => setA(v.version)}
                  />{" "}
                  A
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="diffB"
                    checked={b === v.version}
                    onChange={() => setB(v.version)}
                  />{" "}
                  B
                </label>
              </div>
            </div>
          ))}
        </div>

        {va && vb ? (
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <p className="mb-2 text-sm font-semibold">
              Version {va.version} → Version {vb.version}
            </p>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No differences.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-3 align-top text-xs font-semibold text-muted-foreground">
                        {r.label}
                      </td>
                      <td className="py-1.5 pr-2 align-top text-muted-foreground line-through">
                        {r.before}
                      </td>
                      <td className="py-1.5 align-top font-medium">{r.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[90px_1fr] gap-2">
      <dt className="text-xs font-semibold text-muted-foreground">{k}</dt>
      <dd className="text-sm">{v}</dd>
    </div>
  );
}
