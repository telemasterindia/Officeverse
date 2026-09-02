/**
 * Officeverse — Scoring Console: Dry Run.
 *
 * Calls `scoreDryRunFn`, which runs the SAME evaluator as live scoring and
 * writes NOTHING — no scoring_run, no ledger row, no leaderboard / streak /
 * recognition / CRM effect. Use it to understand exactly why a rule matched
 * or did not match before enabling it.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScoreDryRun, useScoringMeta } from "@/lib/officeverse/use-scoring";

type Scalar = string | number | boolean | null;

export function DryRunPanel({ initialEvent }: { initialEvent?: string }) {
  const meta = useScoringMeta();
  const run = useScoreDryRun();

  const events = meta.data?.events ?? [];
  const enabled = events.filter((e) => e.enabledForScoring);
  const [event, setEvent] = useState(initialEvent ?? "");
  const [opDate, setOpDate] = useState("");
  const [includeDisabled, setIncludeDisabled] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});

  const fields = useMemo(
    () => (meta.data?.fields ?? []).filter((f) => f.events.includes(event)),
    [meta.data, event],
  );

  const result = run.data;

  function setV(k: string, v: string) {
    setValues((s) => ({ ...s, [k]: v }));
  }

  async function go() {
    const payload: Record<string, Scalar> = {};
    for (const f of fields) {
      const raw = values[f.key];
      if (raw == null || raw === "") continue;
      if (f.type === "boolean") payload[f.key] = raw === "true";
      else payload[f.key] = raw; // server coerces string → number/date per the field registry
    }
    try {
      await run.mutateAsync({
        event,
        payload,
        ...(opDate ? { operationalDate: opDate } : {}),
        includeDisabled,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dry run failed");
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="space-y-4 rounded-xl border border-border bg-secondary/30 p-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Event</Label>
          <Select
            value={event || ""}
            onValueChange={(v) => {
              setEvent(v);
              setValues({});
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose an event" />
            </SelectTrigger>
            <SelectContent>
              {enabled.map((e) => (
                <SelectItem key={e.type} value={e.type}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Operational date (optional — defaults to today)</Label>
          <Input type="date" value={opDate} onChange={(e) => setOpDate(e.target.value)} />
        </div>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={includeDisabled}
            onChange={(e) => setIncludeDisabled(e.target.checked)}
          />
          Include disabled rules (test before enabling)
        </label>

        {event ? (
          <div className="space-y-2 border-t border-border/60 pt-3">
            <p className="text-xs font-semibold text-muted-foreground">Test payload</p>
            {fields.map((f) => (
              <div key={f.key} className="grid grid-cols-[110px_1fr] items-center gap-2">
                <Label className="text-xs" title={f.key}>
                  {f.label}
                </Label>
                {f.type === "boolean" ? (
                  <Select value={values[f.key] ?? ""} onValueChange={(v) => setV(f.key, v)}>
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">true</SelectItem>
                      <SelectItem value="false">false</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    className="h-8"
                    type={
                      f.type === "date"
                        ? "date"
                        : f.type === "money" || f.type === "number"
                          ? "number"
                          : "text"
                    }
                    value={values[f.key] ?? ""}
                    onChange={(e) => setV(f.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        ) : null}

        <Button className="w-full" onClick={go} disabled={!event || run.isPending}>
          {run.isPending ? "Running…" : "Run test"}
        </Button>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Dry run writes nothing — no point transaction, no scoring run, no leaderboard, streak,
          recognition or Office TV effect.
        </p>
      </div>

      <div className="rounded-xl border border-border p-4">
        {!result ? (
          <p className="text-sm text-muted-foreground">Run a test to see the scoring result.</p>
        ) : !result.ok ? (
          <p className="text-sm text-warning">Could not evaluate: {result.reason}</p>
        ) : (
          <ScoreResult data={result} />
        )}
      </div>
    </div>
  );
}

type DryRunData = NonNullable<ReturnType<typeof useScoreDryRun>["data"]>;

function ScoreResult({ data }: { data: DryRunData }) {
  const d = data.decision;
  if (!d) return <p className="text-sm text-muted-foreground">No decision.</p>;
  const scored = d.awards.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-bold uppercase",
            scored ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
          )}
        >
          {scored ? "Matched" : "Not matched"}
        </span>
        <span className="text-lg font-bold tabular-nums">
          {d.awardedPointsTotal > 0 ? "+" : ""}
          {d.awardedPointsTotal} points
        </span>
        {data.reason === "event_not_enabled_for_scoring" ? (
          <span className="text-xs text-muted-foreground">
            (event not enabled for live scoring)
          </span>
        ) : null}
        {!data.hasOpenEndedRules ? (
          <span className="text-xs text-muted-foreground">no open-ended rules for this event</span>
        ) : null}
      </div>

      {d.awards.map((a) => (
        <div
          key={`${a.ruleId}-${a.version}`}
          className="rounded-lg border border-success/40 bg-success/5 p-3"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold">{a.ruleName}</span>
            <span className="text-xs text-muted-foreground">v{a.version}</span>
          </div>
          <Traces traces={a.context.conditions} />
          <BandLine detail={a.context.outcome} />
          <p className="mt-1 text-sm font-semibold">
            Points: {a.points > 0 ? "+" : ""}
            {a.points}
          </p>
        </div>
      ))}

      {d.skipped.map((s) => (
        <div key={`${s.ruleId}-skip`} className="rounded-lg border border-border/70 p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-muted-foreground">{s.ruleName} — not matched</span>
            <span className="text-xs text-muted-foreground">
              v{s.version} · {s.reason}
            </span>
          </div>
          {s.conditionTraces ? <Traces traces={s.conditionTraces} /> : null}
        </div>
      ))}
    </div>
  );
}

interface Trace {
  path: string;
  kind: string;
  op?: string;
  field?: string;
  result: boolean;
  reason?: string;
}

function Traces({ traces }: { traces: Trace[] }) {
  const leaves = traces.filter((t) => t.kind === "leaf");
  if (!leaves.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {leaves.map((t, i) => (
        <li key={i} className="flex items-center gap-2">
          {t.result ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-success" />
          ) : (
            <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className={cn(!t.result && "text-muted-foreground")}>
            {t.field} {t.op}
            {t.reason ? (
              <span className="ml-1 text-xs text-muted-foreground">({t.reason})</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function BandLine({
  detail,
}: {
  detail: {
    kind: string;
    strategy?: string;
    matchedBands?: { min: number }[];
    bandInput?: number | null;
  };
}) {
  if (detail.kind !== "BANDS") return null;
  const top = detail.matchedBands?.at(-1);
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      Band strategy: {detail.strategy ?? "HIGHEST"}
      {top ? ` · selected band ≥ ${top.min}` : " · no band satisfied"}
      {detail.bandInput != null ? ` · value ${detail.bandInput}` : ""}
    </p>
  );
}
