/**
 * Officeverse — Scoring Engine CONDITION TREE evaluator (Phase 2). PURE.
 *
 * Deterministic and side-effect free: same (tree, payload) → same result, every
 * time. No DB, no clock, no randomness. A malformed node (unknown field,
 * unknown operator, type mismatch, missing payload value) evaluates to FALSE
 * with a recorded reason — it never throws and never awards by accident.
 *
 *   { op:"AND"|"OR", nodes:[ … ] }                       — group, unlimited depth/breadth
 *   { field, operator, value, valueType }                — leaf
 *
 *   null / undefined tree  → match-all (true)   reason "no_conditions"
 *   { op:"AND"|"OR", nodes:[] }  → FALSE          reason "empty_group"
 */
import { getFieldDef, type FieldType } from "./fields";
import { applyOperator, isOperator } from "./operators";

export type ScoringPayloadValue = string | number | boolean | null;
export type ScoringPayload = Record<string, ScoringPayloadValue>;

export interface LeafNode {
  field: string;
  operator: string;
  value?: unknown;
  valueType?: FieldType;
}
export interface GroupNode {
  op: "AND" | "OR";
  nodes: ConditionNode[];
}
export type ConditionNode = LeafNode | GroupNode;

export interface NodeTrace {
  path: string;
  kind: "group" | "leaf";
  op?: string;
  field?: string;
  result: boolean;
  reason?: string;
}
export interface ConditionEvalResult {
  result: boolean;
  traces: NodeTrace[];
}

export interface EvaluateOptions {
  /** when given, a leaf field that is not valid for this event type evaluates false */
  eventType?: string;
  maxDepth?: number;
  maxNodes?: number;
}

const DEFAULT_MAX_DEPTH = 40;
const DEFAULT_MAX_NODES = 2000;

export function isGroupNode(n: unknown): n is GroupNode {
  return (
    typeof n === "object" &&
    n !== null &&
    (("op" in n && ((n as GroupNode).op === "AND" || (n as GroupNode).op === "OR")) ||
      ("nodes" in n && Array.isArray((n as GroupNode).nodes)))
  );
}

function compatibleType(declared: FieldType | undefined, actual: FieldType): FieldType | null {
  if (declared === undefined) return actual;
  if (declared === actual) return declared;
  if (actual === "string" && declared === "stringList") return declared;
  if (
    (actual === "number" || actual === "money") &&
    (declared === "number" || declared === "money")
  ) {
    return declared;
  }
  return null;
}

/**
 * Evaluate a condition tree against a payload.
 * `null` / `undefined` tree is a deliberate "match-all"; an explicitly empty
 * group is false.
 */
export function evaluateCondition(
  tree: ConditionNode | null | undefined,
  payload: ScoringPayload,
  opts: EvaluateOptions = {},
): ConditionEvalResult {
  const traces: NodeTrace[] = [];
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
  const budget = { n: 0 };

  if (tree === null || tree === undefined) {
    traces.push({ path: "$", kind: "group", result: true, reason: "no_conditions" });
    return { result: true, traces };
  }

  const walk = (node: ConditionNode, path: string, depth: number): boolean => {
    budget.n += 1;
    if (depth > maxDepth) {
      traces.push({ path, kind: "group", result: false, reason: "max_depth" });
      return false;
    }
    if (budget.n > maxNodes) {
      traces.push({ path, kind: "group", result: false, reason: "node_budget_exhausted" });
      return false;
    }

    if (isGroupNode(node)) {
      const g = node;
      if (g.op !== "AND" && g.op !== "OR") {
        traces.push({
          path,
          kind: "group",
          op: String(g.op),
          result: false,
          reason: "unknown_group_op",
        });
        return false;
      }
      if (!Array.isArray(g.nodes) || g.nodes.length === 0) {
        traces.push({ path, kind: "group", op: g.op, result: false, reason: "empty_group" });
        return false;
      }
      const childResults = g.nodes.map((child, i) => walk(child, `${path}.${i}`, depth + 1));
      const result = g.op === "AND" ? childResults.every(Boolean) : childResults.some(Boolean);
      traces.push({ path, kind: "group", op: g.op, result });
      return result;
    }

    // ---- leaf ----
    const leaf = node as LeafNode;
    const field = typeof leaf.field === "string" ? leaf.field : "";
    const push = (result: boolean, reason?: string): boolean => {
      traces.push({
        path,
        kind: "leaf",
        field,
        op: typeof leaf.operator === "string" ? leaf.operator : String(leaf.operator),
        result,
        ...(reason ? { reason } : {}),
      });
      return result;
    };

    const fieldDef = getFieldDef(field);
    if (!fieldDef) return push(false, "unknown_field");
    if (opts.eventType && !fieldDef.events.includes(opts.eventType)) {
      return push(false, "field_not_valid_for_event");
    }
    if (typeof leaf.operator !== "string" || !isOperator(leaf.operator)) {
      return push(false, "unknown_operator");
    }
    const effectiveType = compatibleType(leaf.valueType, fieldDef.type);
    if (effectiveType === null) return push(false, "value_type_mismatch");

    const left = Object.prototype.hasOwnProperty.call(payload, field) ? payload[field] : undefined;
    const { result, reason } = applyOperator(leaf.operator, left, leaf.value, effectiveType);
    return push(result, reason);
  };

  const result = walk(tree, "$", 0);
  return { result, traces };
}

/**
 * Static structural check for the Admin Rule Builder (save time). Returns []
 * when the tree is well formed for `eventType`. `null` / `undefined` is valid
 * (match-all). Does NOT evaluate against a payload.
 */
export function collectConditionIssues(
  tree: ConditionNode | null | undefined,
  eventType?: string,
  depth = 0,
  path = "$",
): string[] {
  if (tree === null || tree === undefined) return [];
  const issues: string[] = [];
  if (depth > DEFAULT_MAX_DEPTH) return [`${path}:max_depth`];

  if (isGroupNode(tree)) {
    if (tree.op !== "AND" && tree.op !== "OR") issues.push(`${path}:unknown_group_op`);
    if (!Array.isArray(tree.nodes) || tree.nodes.length === 0) {
      issues.push(`${path}:empty_group`);
    } else {
      tree.nodes.forEach((child, i) =>
        issues.push(...collectConditionIssues(child, eventType, depth + 1, `${path}.${i}`)),
      );
    }
    return issues;
  }

  const leaf = tree as LeafNode;
  const fieldDef = typeof leaf.field === "string" ? getFieldDef(leaf.field) : undefined;
  if (!fieldDef) {
    issues.push(`${path}:unknown_field`);
  } else if (eventType && !fieldDef.events.includes(eventType)) {
    issues.push(`${path}:field_not_valid_for_event`);
  }
  if (typeof leaf.operator !== "string" || !isOperator(leaf.operator)) {
    issues.push(`${path}:unknown_operator`);
  }
  if (fieldDef && compatibleType(leaf.valueType, fieldDef.type) === null) {
    issues.push(`${path}:value_type_mismatch`);
  }
  return issues;
}
