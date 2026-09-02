/**
 * Officeverse — Scoring Console PURE client helpers (Phase 3).
 *
 * Client-safe: only type-only imports from `@/server/**` (erased at build). No
 * DB, no server logic. These power the Admin rule builder UI:
 *   - immutable condition-tree editing by path
 *   - human-readable rendering of conditions / outcomes / applies-to
 *   - client-side (UX-only) draft validation — the server remains authoritative
 *   - a readable version diff
 *
 * The real evaluator, the real validator and the real version selection all
 * live server-side in `@/server/scoring/*` and are never reimplemented here.
 */
import type { ConditionNode, GroupNode, LeafNode } from "@/server/scoring/conditions";
import type { FieldType } from "@/server/scoring/fields";
import type { Band, Outcome } from "@/server/scoring/modes";
import type { ScoringRuleVersionDTO } from "./scoring-fns";

/* ----------------------------- condition tree helpers ------------------------- */

export function newLeaf(field = "", valueType?: FieldType): LeafNode {
  const leaf: LeafNode = { field, operator: "" };
  if (valueType) leaf.valueType = valueType;
  return leaf;
}

export function newGroup(op: "AND" | "OR" = "AND"): GroupNode {
  return { op, nodes: [] };
}

export function isGroup(n: ConditionNode | null | undefined): n is GroupNode {
  return !!n && typeof n === "object" && "op" in n && Array.isArray((n as GroupNode).nodes);
}

/** Strip empty groups; a tree that reduces to nothing becomes null (match-all). */
export function pruneConditionTree(node: ConditionNode | null | undefined): ConditionNode | null {
  if (node == null) return null;
  if (!isGroup(node)) return node;
  const kids = node.nodes.map(pruneConditionTree).filter((n): n is ConditionNode => n != null);
  if (kids.length === 0) return null;
  return { op: node.op, nodes: kids };
}

/* ----------------------------- humanize ---------------------------------------- */

const OP_LABEL: Record<string, string> = {
  eq: "=",
  ne: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  in: "is any of",
  notIn: "is none of",
  between: "is between",
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  regexMatch: "matches",
  exists: "is provided",
  isNull: "is empty",
};

export function humanizeOperator(op: string): string {
  return OP_LABEL[op] ?? op;
}

export function isUnaryOperator(op: string): boolean {
  return op === "exists" || op === "isNull";
}
export function isRangeOperator(op: string): boolean {
  return op === "between";
}
export function isListOperator(op: string): boolean {
  return op === "in" || op === "notIn";
}

const money = (n: number) =>
  "$" + Math.round(n).toLocaleString("en-US") + (Number.isInteger(n) ? "" : "");

export function humanizeValue(value: unknown, valueType?: FieldType): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    if (valueType === "money" || valueType === "number") {
      return value.map((v) => humanizeValue(v, valueType)).join(" – ");
    }
    return value.map((v) => String(v)).join(", ");
  }
  if (valueType === "money" && typeof value === "number") return money(value);
  if (valueType === "boolean") return value ? "true" : "false";
  return String(value);
}

export function humanizeCondition(
  node: ConditionNode | null | undefined,
  fieldLabel: (key: string) => string,
): string {
  if (node == null) return "Always (no conditions)";
  if (isGroup(node)) {
    if (node.nodes.length === 0) return "(empty group)";
    const joiner = node.op === "AND" ? " AND " : " OR ";
    const parts = node.nodes.map((c) => {
      const s = humanizeCondition(c, fieldLabel);
      return isGroup(c) && c.nodes.length > 1 ? `(${s})` : s;
    });
    return parts.join(joiner);
  }
  const leaf = node as LeafNode;
  const f = fieldLabel(leaf.field) || leaf.field || "?";
  if (isUnaryOperator(leaf.operator)) return `${f} ${humanizeOperator(leaf.operator)}`;
  return `${f} ${humanizeOperator(leaf.operator)} ${humanizeValue(leaf.value, leaf.valueType)}`.trim();
}

export function humanizeOutcome(outcome: Outcome | null | undefined): string {
  if (!outcome) return "—";
  if (outcome.kind === "FLAT") return `${signed(outcome.points)} points`;
  if (outcome.kind === "BANDS") {
    const strat = outcome.strategy ?? "HIGHEST";
    const bands = [...outcome.bands]
      .sort((a, b) => a.min - b.min)
      .map((b) => `${money(b.min)} → ${signed(b.points)}`)
      .join(", ");
    return `bands on ${outcome.on} (${strat}): ${bands}`;
  }
  const bonus = outcome.bonus.map((b, i) => `bonus ${i + 1}: ${signed(b.points)}`).join(", ");
  return `base ${signed(outcome.base)}${bonus ? " + " + bonus : ""}`;
}

export interface AppliesTo {
  roles?: string[];
  processes?: string[];
  teams?: string[];
  closerIds?: number[];
  agentIds?: number[];
  closerTenureDaysMin?: number | null;
  closerTenureDaysMax?: number | null;
}

export function humanizeAppliesTo(a: AppliesTo | null | undefined): string {
  if (!a) return "All applicable subjects";
  const bits: string[] = [];
  if (a.roles?.length) bits.push(`roles: ${a.roles.join(", ")}`);
  if (a.processes?.length) bits.push(`processes: ${a.processes.join(", ")}`);
  if (a.teams?.length) bits.push(`teams: ${a.teams.join(", ")}`);
  if (a.closerIds?.length) bits.push(`closers: ${a.closerIds.join(", ")}`);
  if (a.agentIds?.length) bits.push(`agents: ${a.agentIds.join(", ")}`);
  if (a.closerTenureDaysMin != null || a.closerTenureDaysMax != null) {
    bits.push(`closer tenure ${a.closerTenureDaysMin ?? 0}–${a.closerTenureDaysMax ?? "∞"} days`);
  }
  return bits.length ? bits.join(" · ") : "All applicable subjects";
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/* ----------------------------- client validation (UX only) ------------------- */

export interface DraftLike {
  name: string;
  event: string;
  outcome: Outcome | null;
  effectiveFrom: string;
  conditionTree?: ConditionNode | null;
  priority?: number;
}

export interface FieldInfo {
  key: string;
  type: FieldType;
  events: string[];
}

/**
 * Best-effort pre-submit checks. NEVER a security or correctness boundary — the
 * server's `validateRuleDraft` + `validateOutcome` are authoritative.
 */
export function clientValidateDraft(
  draft: DraftLike,
  ctx: { enabledEvents: string[]; fields: FieldInfo[] },
): string[] {
  const errs: string[] = [];
  if (!draft.name.trim()) errs.push("Give the rule a name.");
  if (!draft.event) errs.push("Choose an event.");
  else if (!ctx.enabledEvents.includes(draft.event)) {
    errs.push("This event is not available for active scoring yet.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom)) {
    errs.push("Set a valid Effective From date (YYYY-MM-DD).");
  }
  if (draft.priority !== undefined && (draft.priority < 0 || draft.priority > 100_000)) {
    errs.push("Priority must be between 0 and 100000.");
  }

  const o = draft.outcome;
  if (!o) {
    errs.push("Configure an outcome.");
  } else if (o.kind === "FLAT") {
    if (!inRange(o.points)) errs.push("Flat points must be between -100000 and 100000.");
  } else if (o.kind === "BANDS") {
    if (!o.on) errs.push("Choose the field the bands read.");
    if (!o.bands.length) errs.push("Add at least one band.");
    let prev = -Infinity;
    o.bands.forEach((b, i) => {
      if (!Number.isFinite(b.min)) errs.push(`Band ${i + 1}: minimum is not a number.`);
      else if (b.min <= prev)
        errs.push(`Band ${i + 1}: minimum must be greater than the band above.`);
      prev = b.min;
      if (!inRange(b.points))
        errs.push(`Band ${i + 1}: points must be between -100000 and 100000.`);
    });
  } else if (o.kind === "BASE_PLUS_BONUS") {
    if (!inRange(o.base)) errs.push("Base points must be between -100000 and 100000.");
    o.bonus.forEach((b, i) => {
      if (!inRange(b.points))
        errs.push(`Bonus ${i + 1}: points must be between -100000 and 100000.`);
      if (!b.if) errs.push(`Bonus ${i + 1}: add a condition.`);
    });
  }

  errs.push(...conditionIssues(draft.conditionTree ?? null, draft.event, ctx.fields, "condition"));
  return errs;
}

function conditionIssues(
  node: ConditionNode | null | undefined,
  event: string,
  fields: FieldInfo[],
  where: string,
): string[] {
  if (node == null) return [];
  const errs: string[] = [];
  if (isGroup(node)) {
    if (node.nodes.length === 0) errs.push(`${where}: a group has no conditions.`);
    node.nodes.forEach((c) => errs.push(...conditionIssues(c, event, fields, where)));
    return errs;
  }
  const leaf = node as LeafNode;
  const fd = fields.find((f) => f.key === leaf.field);
  if (!leaf.field) errs.push(`${where}: pick a field.`);
  else if (!fd) errs.push(`${where}: unknown field "${leaf.field}".`);
  else if (event && !fd.events.includes(event)) {
    errs.push(`${where}: "${leaf.field}" is not available for this event.`);
  }
  if (!leaf.operator) errs.push(`${where}: pick an operator.`);
  else if (!isUnaryOperator(leaf.operator)) {
    const v = leaf.value;
    const empty =
      v == null ||
      v === "" ||
      (Array.isArray(v) && (v.length === 0 || v.every((x) => x === "" || x == null)));
    if (empty) errs.push(`${where}: enter a value.`);
  }
  return errs;
}

function inRange(n: unknown): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= -100_000 && n <= 100_000;
}

/* ----------------------------- version diff ---------------------------------- */

export interface DiffRow {
  label: string;
  before: string;
  after: string;
}

export function diffVersions(
  a: ScoringRuleVersionDTO,
  b: ScoringRuleVersionDTO,
  fieldLabel: (key: string) => string = (k) => k,
): DiffRow[] {
  const rows: DiffRow[] = [];
  const add = (label: string, before: string, after: string) => {
    if (before !== after) rows.push({ label, before, after });
  };
  add("Name", a.nameSnapshot, b.nameSnapshot);
  add("Event", a.eventSnapshot, b.eventSnapshot);
  add("Effective From", a.effectiveFrom, b.effectiveFrom);
  add("Effective Until", a.effectiveUntil ?? "open", b.effectiveUntil ?? "open");
  add(
    "Applies To",
    humanizeAppliesTo(a.appliesToSnapshot as AppliesTo | null),
    humanizeAppliesTo(b.appliesToSnapshot as AppliesTo | null),
  );
  add(
    "Conditions",
    humanizeCondition(a.conditionTree as ConditionNode | null, fieldLabel),
    humanizeCondition(b.conditionTree as ConditionNode | null, fieldLabel),
  );
  add(
    "Outcome",
    humanizeOutcome(a.outcome as Outcome | null),
    humanizeOutcome(b.outcome as Outcome | null),
  );
  return rows;
}

/* ----------------------------- misc ---------------------------------------- */

export const RULE_MATCHING_MODE_HELP: Record<string, string> = {
  FIRST_MATCH:
    "When several rules match one event, only the first by priority is awarded, then evaluation stops.",
  HIGHEST_MATCH:
    "When several rules match one event, every match is evaluated and only the single most valuable result is awarded.",
  ALL_MATCHES: "Every rule that matches the event awards its points once.",
};

export const BAND_STRATEGY_HELP: Record<string, string> = {
  HIGHEST:
    "Award only the highest band the value satisfies (e.g. $45k over 10/20/30/40k bands → the 40k band).",
  FIRST: "Award only the first (lowest) band the value satisfies.",
  ALL: "Sum the points of every band the value satisfies.",
  CUMULATIVE:
    "Add each band's points as its threshold is crossed (same as ALL for min/points bands).",
};
