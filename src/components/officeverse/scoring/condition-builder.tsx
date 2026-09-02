/**
 * Officeverse — Scoring Console: recursive nested AND/OR condition builder.
 *
 * Operates directly on the Phase-2 `ConditionNode` JSON. Field list + operator
 * list come from the server registry (`scoringMetaFn`) — nothing is hard-coded
 * here. The server (`validateRuleDraft` + the condition evaluator) is the final
 * authority; this component only builds a well-formed tree.
 */
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  isGroup,
  isListOperator,
  isRangeOperator,
  isUnaryOperator,
  newGroup,
  newLeaf,
} from "@/lib/officeverse/scoring-ui";
import type { ConditionNode, GroupNode, LeafNode } from "@/server/scoring/conditions";
import type { FieldType } from "@/server/scoring/fields";

export interface BuilderField {
  key: string;
  label: string;
  type: FieldType;
}
export interface BuilderOperator {
  op: string;
  types: FieldType[];
}

function operatorsFor(type: FieldType, ops: BuilderOperator[]): BuilderOperator[] {
  return ops.filter((o) => o.types.includes(type));
}

function coerceValue(raw: string, type: FieldType): string | number | boolean {
  if (type === "number" || type === "money") {
    const n = Number(raw);
    return raw.trim() === "" || Number.isNaN(n) ? raw : n;
  }
  if (type === "boolean") return raw === "true";
  return raw;
}

function LeafRow({
  leaf,
  fields,
  operators,
  onChange,
  onRemove,
}: {
  leaf: LeafNode;
  fields: BuilderField[];
  operators: BuilderOperator[];
  onChange: (l: LeafNode) => void;
  onRemove: () => void;
}) {
  const fd = fields.find((f) => f.key === leaf.field);
  const type: FieldType = fd?.type ?? "string";
  const ops = fd ? operatorsFor(type, operators) : [];
  const value = leaf.value;

  const setField = (key: string) => {
    const nf = fields.find((f) => f.key === key);
    onChange({ field: key, operator: "", ...(nf ? { valueType: nf.type } : {}) });
  };
  const setOp = (op: string) => {
    const next: LeafNode = { field: leaf.field, operator: op };
    if (fd) next.valueType = fd.type;
    onChange(next);
  };
  const setScalar = (raw: string) => onChange({ ...leaf, value: coerceValue(raw, type) });
  const setList = (raw: string) =>
    onChange({
      ...leaf,
      value: raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => coerceValue(s, type)),
    });
  const setRange = (i: 0 | 1, raw: string) => {
    const cur = Array.isArray(value) ? [...(value as unknown[])] : ["", ""];
    cur[i] = coerceValue(raw, type);
    onChange({ ...leaf, value: cur.slice(0, 2) });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-background/60 p-2">
      <Select value={leaf.field || ""} onValueChange={setField}>
        <SelectTrigger className="h-9 w-[190px] text-sm">
          <SelectValue placeholder="Field" />
        </SelectTrigger>
        <SelectContent>
          {fields.map((f) => (
            <SelectItem key={f.key} value={f.key}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={leaf.operator || ""} onValueChange={setOp} disabled={!fd}>
        <SelectTrigger className="h-9 w-[150px] text-sm">
          <SelectValue placeholder="Operator" />
        </SelectTrigger>
        <SelectContent>
          {ops.map((o) => (
            <SelectItem key={o.op} value={o.op}>
              {o.op}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {leaf.operator && !isUnaryOperator(leaf.operator) ? (
        isRangeOperator(leaf.operator) ? (
          <div className="flex items-center gap-1">
            <Input
              className="h-9 w-[110px] text-sm"
              placeholder="min"
              value={String(Array.isArray(value) ? (value[0] ?? "") : "")}
              onChange={(e) => setRange(0, e.target.value)}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              className="h-9 w-[110px] text-sm"
              placeholder="max"
              value={String(Array.isArray(value) ? (value[1] ?? "") : "")}
              onChange={(e) => setRange(1, e.target.value)}
            />
          </div>
        ) : isListOperator(leaf.operator) ? (
          <Input
            className="h-9 w-[240px] text-sm"
            placeholder="comma,separated,values"
            value={Array.isArray(value) ? (value as unknown[]).join(", ") : ""}
            onChange={(e) => setList(e.target.value)}
          />
        ) : type === "boolean" ? (
          <Select
            value={value === true ? "true" : value === false ? "false" : ""}
            onValueChange={(v) => onChange({ ...leaf, value: v === "true" })}
          >
            <SelectTrigger className="h-9 w-[120px] text-sm">
              <SelectValue placeholder="value" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">true</SelectItem>
              <SelectItem value="false">false</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            className="h-9 w-[190px] text-sm"
            type={
              type === "date" ? "date" : type === "number" || type === "money" ? "number" : "text"
            }
            placeholder={type === "money" ? "amount" : "value"}
            value={value == null ? "" : String(value)}
            onChange={(e) => setScalar(e.target.value)}
          />
        )
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="ml-auto h-8 w-8 shrink-0"
        onClick={onRemove}
        aria-label="Remove condition"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function ConditionGroup({
  group,
  fields,
  operators,
  onChange,
  onRemove,
  depth = 0,
}: {
  group: GroupNode;
  fields: BuilderField[];
  operators: BuilderOperator[];
  onChange: (g: GroupNode) => void;
  onRemove?: () => void;
  depth?: number;
}) {
  const replace = (i: number, node: ConditionNode) =>
    onChange({ ...group, nodes: group.nodes.map((c, idx) => (idx === i ? node : c)) });
  const remove = (i: number) =>
    onChange({ ...group, nodes: group.nodes.filter((_, idx) => idx !== i) });

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border p-3",
        depth === 0 ? "border-border bg-secondary/30" : "border-border/70 bg-secondary/20",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-border text-xs font-semibold">
          <button
            type="button"
            className={cn(
              "px-2.5 py-1",
              group.op === "AND" ? "bg-primary text-primary-foreground" : "bg-background",
            )}
            onClick={() => onChange({ ...group, op: "AND" })}
          >
            ALL / AND
          </button>
          <button
            type="button"
            className={cn(
              "px-2.5 py-1",
              group.op === "OR" ? "bg-primary text-primary-foreground" : "bg-background",
            )}
            onClick={() => onChange({ ...group, op: "OR" })}
          >
            ANY / OR
          </button>
        </div>
        <span className="text-xs text-muted-foreground">
          {group.op === "AND" ? "every condition below must be true" : "at least one must be true"}
        </span>
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={onRemove}
          >
            Remove group
          </Button>
        ) : null}
      </div>

      {group.nodes.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">No conditions in this group yet.</p>
      ) : (
        <div className="space-y-2">
          {group.nodes.map((child, i) =>
            isGroup(child) ? (
              <ConditionGroup
                key={i}
                group={child}
                fields={fields}
                operators={operators}
                onChange={(g) => replace(i, g)}
                onRemove={() => remove(i)}
                depth={depth + 1}
              />
            ) : (
              <LeafRow
                key={i}
                leaf={child as LeafNode}
                fields={fields}
                operators={operators}
                onChange={(l) => replace(i, l)}
                onRemove={() => remove(i)}
              />
            ),
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => onChange({ ...group, nodes: [...group.nodes, newLeaf()] })}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Add condition
        </Button>
        {depth < 4 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() =>
              onChange({
                ...group,
                nodes: [...group.nodes, newGroup(group.op === "AND" ? "OR" : "AND")],
              })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add group
          </Button>
        ) : null}
      </div>
    </div>
  );
}
