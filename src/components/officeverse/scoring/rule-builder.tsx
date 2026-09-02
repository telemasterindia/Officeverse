/**
 * Officeverse — Scoring Console: create / new-version rule builder (Phase 3).
 *
 * A real builder driven entirely by the server registry — event list, field
 * list, operators, matching modes and band strategies all come from
 * `scoringMetaFn`. Editing an existing rule creates a NEW immutable version;
 * version 1..N-1 are never touched. All validation is re-run server-side.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCreateScoringRule,
  useScoringMeta,
  useUpdateScoringRule,
} from "@/lib/officeverse/use-scoring";
import {
  BAND_STRATEGY_HELP,
  RULE_MATCHING_MODE_HELP,
  clientValidateDraft,
  humanizeCondition,
  humanizeOutcome,
  isGroup,
  newGroup,
  pruneConditionTree,
} from "@/lib/officeverse/scoring-ui";
import type { ScoringRuleDTO } from "@/lib/officeverse/scoring-fns";
import type { ConditionNode, GroupNode } from "@/server/scoring/conditions";
import type { Outcome } from "@/server/scoring/modes";
import { ConditionGroup, type BuilderField } from "./condition-builder";

type Mode = "FIRST_MATCH" | "HIGHEST_MATCH" | "ALL_MATCHES";
type OutcomeKind = "FLAT" | "BANDS" | "BASE_PLUS_BONUS";
type Strategy = "HIGHEST" | "FIRST" | "ALL" | "CUMULATIVE";

interface AppliesToState {
  roles: string[];
  processes: string[];
  teams: string;
  closerIds: string;
  agentIds: string;
  tenureMin: string;
  tenureMax: string;
}

interface DraftState {
  name: string;
  event: string;
  priority: number;
  mode: Mode;
  applies: AppliesToState;
  hasConditions: boolean;
  tree: GroupNode;
  outcomeKind: OutcomeKind;
  flatPoints: number;
  bandsOn: string;
  strategy: Strategy;
  bands: { min: string; points: string }[];
  base: number;
  bonuses: { if: GroupNode; points: string }[];
  effectiveFrom: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

function emptyDraft(): DraftState {
  return {
    name: "",
    event: "",
    priority: 100,
    mode: "FIRST_MATCH",
    applies: {
      roles: [],
      processes: [],
      teams: "",
      closerIds: "",
      agentIds: "",
      tenureMin: "",
      tenureMax: "",
    },
    hasConditions: false,
    tree: newGroup("AND"),
    outcomeKind: "FLAT",
    flatPoints: 0,
    bandsOn: "",
    strategy: "HIGHEST",
    bands: [{ min: "", points: "" }],
    base: 0,
    bonuses: [],
    effectiveFrom: todayISO(),
  };
}

function hydrate(rule: ScoringRuleDTO): DraftState {
  const cur = rule.versions.find((v) => v.version === rule.currentVersion) ?? rule.versions.at(-1);
  const d = emptyDraft();
  d.name = rule.name;
  d.event = rule.event;
  d.priority = rule.priority;
  d.mode = (rule.ruleMatchingMode as Mode) ?? "FIRST_MATCH";
  d.effectiveFrom = todayISO();

  const at = (cur?.appliesToSnapshot ?? null) as Record<string, unknown> | null;
  if (at) {
    d.applies.roles = Array.isArray(at["roles"]) ? (at["roles"] as string[]) : [];
    d.applies.processes = Array.isArray(at["processes"]) ? (at["processes"] as string[]) : [];
    d.applies.teams = Array.isArray(at["teams"]) ? (at["teams"] as string[]).join(", ") : "";
    d.applies.closerIds = Array.isArray(at["closerIds"])
      ? (at["closerIds"] as number[]).join(", ")
      : "";
    d.applies.agentIds = Array.isArray(at["agentIds"])
      ? (at["agentIds"] as number[]).join(", ")
      : "";
    d.applies.tenureMin =
      at["closerTenureDaysMin"] != null ? String(at["closerTenureDaysMin"]) : "";
    d.applies.tenureMax =
      at["closerTenureDaysMax"] != null ? String(at["closerTenureDaysMax"]) : "";
  }

  const tree = (cur?.conditionTree ?? null) as ConditionNode | null;
  if (tree && isGroup(tree)) {
    d.hasConditions = true;
    d.tree = tree;
  }

  const o = (cur?.outcome ?? null) as Outcome | null;
  if (o?.kind === "FLAT") {
    d.outcomeKind = "FLAT";
    d.flatPoints = o.points;
  } else if (o?.kind === "BANDS") {
    d.outcomeKind = "BANDS";
    d.bandsOn = o.on;
    d.strategy = (o.strategy ?? "HIGHEST") as Strategy;
    d.bands = o.bands.map((b) => ({ min: String(b.min), points: String(b.points) }));
  } else if (o?.kind === "BASE_PLUS_BONUS") {
    d.outcomeKind = "BASE_PLUS_BONUS";
    d.base = o.base;
    d.bonuses = o.bonus.map((b) => ({
      if: isGroup(b.if) ? (b.if as GroupNode) : newGroup("AND"),
      points: String(b.points),
    }));
  }
  return d;
}

function buildOutcome(d: DraftState): Outcome {
  if (d.outcomeKind === "FLAT") return { kind: "FLAT", points: num(d.flatPoints) };
  if (d.outcomeKind === "BANDS") {
    return {
      kind: "BANDS",
      on: d.bandsOn,
      strategy: d.strategy,
      bands: d.bands.map((b) => ({ min: num(b.min), points: num(b.points) })),
    };
  }
  return {
    kind: "BASE_PLUS_BONUS",
    base: num(d.base),
    bonus: d.bonuses.map((b) => ({
      if: (pruneConditionTree(b.if) as ConditionNode) ?? newGroup("AND"),
      points: num(b.points),
    })),
  };
}

function buildAppliesTo(a: AppliesToState) {
  const nums = (s: string) =>
    s
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  const strs = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const out: Record<string, unknown> = {};
  if (a.roles.length) out["roles"] = a.roles;
  if (a.processes.length) out["processes"] = a.processes;
  if (strs(a.teams).length) out["teams"] = strs(a.teams);
  if (nums(a.closerIds).length) out["closerIds"] = nums(a.closerIds);
  if (nums(a.agentIds).length) out["agentIds"] = nums(a.agentIds);
  if (a.tenureMin.trim() !== "") out["closerTenureDaysMin"] = num(a.tenureMin);
  if (a.tenureMax.trim() !== "") out["closerTenureDaysMax"] = num(a.tenureMax);
  return Object.keys(out).length ? out : null;
}

function num(v: string | number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function RuleBuilderDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: ScoringRuleDTO | null;
}) {
  const meta = useScoringMeta();
  const create = useCreateScoringRule();
  const update = useUpdateScoringRule();
  const isEdit = !!editing;
  const nextVersion = editing ? editing.currentVersion + 1 : 1;

  const [d, setD] = useState<DraftState>(() => (editing ? hydrate(editing) : emptyDraft()));
  const [showConfirm, setShowConfirm] = useState(false);

  // reset when the dialog target changes
  const key = editing ? `edit-${editing.id}` : "create";
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setD(editing ? hydrate(editing) : emptyDraft());
    setShowConfirm(false);
  }

  const patch = (p: Partial<DraftState>) => setD((s) => ({ ...s, ...p }));

  const events = meta.data?.events ?? [];
  const enabledEventTypes = events.filter((e) => e.enabledForScoring).map((e) => e.type);
  const fields = useMemo<BuilderField[]>(
    () =>
      (meta.data?.fields ?? [])
        .filter((f) => f.events.includes(d.event))
        .map((f) => ({ key: f.key, label: f.label, type: f.type })),
    [meta.data, d.event],
  );
  const bandFields = fields.filter((f) => f.type === "money" || f.type === "number");
  const operators = (meta.data?.operators ?? []).map((o) => ({ op: o.op, types: o.types }));

  const outcome = buildOutcome(d);
  const conditionTree = d.hasConditions
    ? (pruneConditionTree(d.tree) as ConditionNode | null)
    : null;

  const clientErrors = clientValidateDraft(
    {
      name: d.name,
      event: d.event,
      outcome,
      effectiveFrom: d.effectiveFrom,
      conditionTree,
      priority: d.priority,
    },
    {
      enabledEvents: enabledEventTypes,
      fields: (meta.data?.fields ?? []).map((f) => ({
        key: f.key,
        type: f.type,
        events: f.events,
      })),
    },
  );

  const fieldLabel = (k: string) => fields.find((f) => f.key === k)?.label ?? k;
  const busy = create.isPending || update.isPending;

  async function submit() {
    const payload = {
      name: d.name.trim(),
      event: d.event,
      priority: d.priority,
      ruleMatchingMode: d.mode,
      appliesTo: buildAppliesTo(d.applies),
      conditionTree,
      outcome,
      effectiveFrom: d.effectiveFrom,
    };
    try {
      if (isEdit && editing) {
        await update.mutateAsync({ ruleId: editing.id, ...payload } as never);
        toast.success(`Version ${nextVersion} created — earlier versions unchanged`);
      } else {
        await create.mutateAsync(payload as never);
        toast.success("Rule created (disabled) — dry-run it, then enable");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the rule");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit rule — new Version ${nextVersion}` : "Create scoring rule"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? `Version ${editing?.currentVersion} stays historically unchanged. The new version applies only to events on/after its effective date.`
              : "New rules are created disabled. Author it, dry-run it, then enable it. Points are recognition score only — never money."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-1">
          {/* RULE DETAILS */}
          <Section title="Rule details">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Rule name">
                <Input
                  value={d.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="High Debt Lead"
                />
              </Field>
              <Field label="Event">
                <Select
                  value={d.event || ""}
                  onValueChange={(v) => patch({ event: v, bandsOn: "" })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an event" />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((ev) => (
                      <SelectItem key={ev.type} value={ev.type} disabled={!ev.enabledForScoring}>
                        {ev.label}
                        {!ev.enabledForScoring ? " — Coming soon" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Priority (lower = evaluated first)">
                <Input
                  type="number"
                  value={d.priority}
                  onChange={(e) => patch({ priority: num(e.target.value) })}
                />
              </Field>
              <Field label="Rule matching mode">
                <Select value={d.mode} onValueChange={(v) => patch({ mode: v as Mode })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      meta.data?.ruleMatchingModes ?? [
                        "FIRST_MATCH",
                        "HIGHEST_MATCH",
                        "ALL_MATCHES",
                      ]
                    ).map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {RULE_MATCHING_MODE_HELP[d.mode]}
            </p>
          </Section>

          {/* APPLIES TO */}
          <Section
            title="Applies to"
            hint="Leave everything blank to apply to all applicable subjects. Values are data — no names or IDs are hard-coded."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Roles">
                <CheckRow
                  options={["agent", "closer"]}
                  value={d.applies.roles}
                  onChange={(roles) => patch({ applies: { ...d.applies, roles } })}
                />
              </Field>
              <Field label="Processes">
                <CheckRow
                  options={[...(meta.data?.processes ?? ["US", "UK", "IN", "AU"])]}
                  value={d.applies.processes}
                  onChange={(processes) => patch({ applies: { ...d.applies, processes } })}
                />
              </Field>
              <Field label="Teams (comma separated)">
                <Input
                  value={d.applies.teams}
                  onChange={(e) => patch({ applies: { ...d.applies, teams: e.target.value } })}
                  placeholder="TEAM_A, TEAM_B"
                />
              </Field>
              <Field label="Closer IDs (comma separated)">
                <Input
                  value={d.applies.closerIds}
                  onChange={(e) => patch({ applies: { ...d.applies, closerIds: e.target.value } })}
                  placeholder="e.g. 12, 34"
                />
              </Field>
              <Field label="Agent IDs (comma separated)">
                <Input
                  value={d.applies.agentIds}
                  onChange={(e) => patch({ applies: { ...d.applies, agentIds: e.target.value } })}
                  placeholder="e.g. 5, 8"
                />
              </Field>
              <Field label="Closer tenure (days)">
                <div className="flex items-center gap-2">
                  <Input
                    className="w-24"
                    placeholder="min"
                    value={d.applies.tenureMin}
                    onChange={(e) =>
                      patch({ applies: { ...d.applies, tenureMin: e.target.value } })
                    }
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    className="w-24"
                    placeholder="max"
                    value={d.applies.tenureMax}
                    onChange={(e) =>
                      patch({ applies: { ...d.applies, tenureMax: e.target.value } })
                    }
                  />
                </div>
              </Field>
            </div>
          </Section>

          {/* CONDITIONS */}
          <Section title="Conditions">
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={d.hasConditions}
                onChange={(e) => patch({ hasConditions: e.target.checked })}
              />
              This rule has conditions (unchecked = always matches the event)
            </label>
            {d.hasConditions ? (
              d.event ? (
                <ConditionGroup
                  group={d.tree}
                  fields={fields}
                  operators={operators}
                  onChange={(tree) => patch({ tree })}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Choose an event first to load its fields.
                </p>
              )
            ) : null}
          </Section>

          {/* OUTCOME */}
          <Section
            title="Outcome"
            hint="Points are Admin-authored. Negative points are ordinary points (a penalty), not a separate system."
          >
            <div className="mb-3 inline-flex overflow-hidden rounded-md border border-border text-xs font-semibold">
              {(["FLAT", "BANDS", "BASE_PLUS_BONUS"] as OutcomeKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={cn(
                    "px-3 py-1.5",
                    d.outcomeKind === k ? "bg-primary text-primary-foreground" : "bg-background",
                  )}
                  onClick={() => patch({ outcomeKind: k })}
                >
                  {k === "BASE_PLUS_BONUS" ? "BASE + BONUS" : k}
                </button>
              ))}
            </div>

            {d.outcomeKind === "FLAT" ? (
              <Field label="Points">
                <Input
                  type="number"
                  className="w-40"
                  value={d.flatPoints}
                  onChange={(e) => patch({ flatPoints: num(e.target.value) })}
                />
              </Field>
            ) : null}

            {d.outcomeKind === "BANDS" ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Field the bands read">
                    <Select value={d.bandsOn || ""} onValueChange={(v) => patch({ bandsOn: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="numeric / money field" />
                      </SelectTrigger>
                      <SelectContent>
                        {bandFields.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Strategy">
                    <Select
                      value={d.strategy}
                      onValueChange={(v) => patch({ strategy: v as Strategy })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(
                          meta.data?.bandStrategies ?? ["HIGHEST", "FIRST", "ALL", "CUMULATIVE"]
                        ).map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">{BAND_STRATEGY_HELP[d.strategy]}</p>
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-semibold text-muted-foreground">
                    <span>Minimum</span>
                    <span>Points</span>
                    <span />
                  </div>
                  {d.bands.map((b, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <Input
                        type="number"
                        placeholder="10000"
                        value={b.min}
                        onChange={(e) =>
                          patch({
                            bands: d.bands.map((x, idx) =>
                              idx === i ? { ...x, min: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      <Input
                        type="number"
                        placeholder="200"
                        value={b.points}
                        onChange={(e) =>
                          patch({
                            bands: d.bands.map((x, idx) =>
                              idx === i ? { ...x, points: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => patch({ bands: d.bands.filter((_, idx) => idx !== i) })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => patch({ bands: [...d.bands, { min: "", points: "" }] })}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add band
                  </Button>
                </div>
              </div>
            ) : null}

            {d.outcomeKind === "BASE_PLUS_BONUS" ? (
              <div className="space-y-3">
                <Field label="Base points">
                  <Input
                    type="number"
                    className="w-40"
                    value={d.base}
                    onChange={(e) => patch({ base: num(e.target.value) })}
                  />
                </Field>
                {d.bonuses.map((b, i) => (
                  <div key={i} className="space-y-2 rounded-lg border border-border/70 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">Bonus {i + 1}</span>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">points</Label>
                        <Input
                          type="number"
                          className="h-8 w-24"
                          value={b.points}
                          onChange={(e) =>
                            patch({
                              bonuses: d.bonuses.map((x, idx) =>
                                idx === i ? { ...x, points: e.target.value } : x,
                              ),
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            patch({ bonuses: d.bonuses.filter((_, idx) => idx !== i) })
                          }
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <ConditionGroup
                      group={b.if}
                      fields={fields}
                      operators={operators}
                      onChange={(g) =>
                        patch({
                          bonuses: d.bonuses.map((x, idx) => (idx === i ? { ...x, if: g } : x)),
                        })
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    patch({ bonuses: [...d.bonuses, { if: newGroup("AND"), points: "" }] })
                  }
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add bonus
                </Button>
              </div>
            ) : null}
          </Section>

          {/* EFFECTIVE DATES */}
          <Section
            title="Effective dates"
            hint="The server closes the previous version's window at this date. Version selection at scoring time is server-authoritative and keyed on each event's operational date."
          >
            <Field label="Effective from">
              <Input
                type="date"
                className="w-48"
                value={d.effectiveFrom}
                onChange={(e) => patch({ effectiveFrom: e.target.value })}
              />
            </Field>
          </Section>

          {/* REVIEW */}
          <Section title="Review">
            <div className="space-y-1.5 rounded-lg bg-secondary/40 p-3 text-sm">
              <Row k="When" v={events.find((e) => e.type === d.event)?.label ?? "—"} />
              <Row k="For" v={humanizeAppliesToState(d.applies)} />
              <Row k="Conditions" v={humanizeCondition(conditionTree, fieldLabel)} />
              <Row k="Outcome" v={humanizeOutcome(outcome)} />
              <Row k="Matching" v={d.mode} />
              <Row k="Effective" v={d.effectiveFrom} />
              <Row
                k="Status"
                v={isEdit ? `New version ${nextVersion}` : "Disabled (enable after dry run)"}
              />
            </div>
            {clientErrors.length ? (
              <ul className="mt-3 space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
                {clientErrors.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            ) : null}
          </Section>

          {showConfirm ? (
            <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm">
              <p className="font-medium">Confirm {isEdit ? `Version ${nextVersion}` : "rule"}</p>
              <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                <li>
                  • This creates {isEdit ? `Version ${nextVersion}` : "a new rule (disabled)"}.
                </li>
                <li>• It will NOT recalculate historical points.</li>
                <li>• It applies only to events within its effective date.</li>
                <li>• Live scoring is currently OFF.</li>
              </ul>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowConfirm(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={submit} disabled={busy}>
                  {isEdit ? "Create Version" : "Create Rule"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={() => setShowConfirm(true)}
                disabled={busy || clientErrors.length > 0}
              >
                Review &amp; save
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------- small local UI ---------------------------- */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <span className="text-xs font-semibold text-muted-foreground">{k}</span>
      <span className="text-sm">{v}</span>
    </div>
  );
}

function CheckRow({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium",
              on
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground",
            )}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function humanizeAppliesToState(a: AppliesToState): string {
  const bits: string[] = [];
  if (a.roles.length) bits.push(`roles: ${a.roles.join(", ")}`);
  if (a.processes.length) bits.push(`processes: ${a.processes.join(", ")}`);
  if (a.teams.trim()) bits.push(`teams: ${a.teams}`);
  if (a.closerIds.trim()) bits.push(`closers: ${a.closerIds}`);
  if (a.agentIds.trim()) bits.push(`agents: ${a.agentIds}`);
  if (a.tenureMin || a.tenureMax)
    bits.push(`closer tenure ${a.tenureMin || 0}–${a.tenureMax || "∞"}d`);
  return bits.length ? bits.join(" · ") : "All applicable subjects";
}
