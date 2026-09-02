/**
 * Officeverse — INCENTIVE ENGINE · eligibility conditions (Phase 9). PURE.
 *
 * The Incentive Engine consumes the AUTHORITATIVE Phase-8 performance snapshot
 * (points + metrics + rule attribution) and evaluates a configurable condition
 * tree over it. It NEVER scores, never re-computes points, and hard-codes NO
 * business threshold — every value comes from the scheme version's config.
 *
 * There is NO scoring here. A leaf like `{ metric:"points", operator:"gte",
 * value:5000 }` is an INCENTIVE decision, not `if debt>=20000 then points=200`.
 */

/* --------------------------- metric registry --------------------------- */

export type IncentiveMetricKind = "static" | "rule" | "event";

export interface IncentiveMetricDef {
  key: string;
  label: string;
  kind: IncentiveMetricKind;
}

/** Static metrics a scheme can test. Dynamic families (`rulePoints:<id>`,
 *  `eventPoints:<EVENT>`) are resolved from the snapshot's rule breakdown so a
 *  future scoring rule / event needs no code change here or in React. */
export const INCENTIVE_METRICS: readonly IncentiveMetricDef[] = [
  { key: "points", label: "Total points", kind: "static" },
  { key: "leadsSubmitted", label: "Leads submitted", kind: "static" },
  { key: "leadsAccepted", label: "Leads accepted", kind: "static" },
  { key: "followUps", label: "Follow-ups (points-bearing)", kind: "static" },
  { key: "sales", label: "Sales", kind: "static" },
  { key: "scoredLeads", label: "Rule-scored ledger rows", kind: "static" },
  {
    key: "totalActivity",
    label: "Total activity (submitted+accepted+follow-ups+sales)",
    kind: "static",
  },
  { key: "rulePoints:<ruleId>", label: "Points from a specific scoring rule", kind: "rule" },
  { key: "eventPoints:<EVENT>", label: "Points from a specific event", kind: "event" },
];

/* ---------------------------- evaluation ctx --------------------------- */

export interface IncentiveMetricContext {
  points: number;
  leadsSubmitted: number;
  leadsAccepted: number;
  followUps: number;
  sales: number;
  scoredLeads: number;
  /** points grouped by scoring rule id (from the Phase-8 rule breakdown) */
  rulePoints: Record<string, number>;
  /** points grouped by event key (from the Phase-8 rule breakdown) */
  eventPoints: Record<string, number>;
}

export function buildMetricContext(input: {
  points: number;
  metrics: {
    leadsSubmitted: number;
    leadsAccepted: number;
    followUps: number;
    sales: number;
    scoredLeads: number;
  };
  ruleBreakdown: ReadonlyArray<{
    ruleId: number | null;
    event: string;
    points: number;
  }>;
}): IncentiveMetricContext {
  const rulePoints: Record<string, number> = {};
  const eventPoints: Record<string, number> = {};
  for (const r of input.ruleBreakdown) {
    if (r.ruleId != null)
      rulePoints[String(r.ruleId)] = (rulePoints[String(r.ruleId)] ?? 0) + r.points;
    eventPoints[r.event] = (eventPoints[r.event] ?? 0) + r.points;
  }
  return {
    points: input.points,
    leadsSubmitted: input.metrics.leadsSubmitted,
    leadsAccepted: input.metrics.leadsAccepted,
    followUps: input.metrics.followUps,
    sales: input.metrics.sales,
    scoredLeads: input.metrics.scoredLeads,
    rulePoints,
    eventPoints,
  };
}

/** Resolve a metric key (static or dynamic) to its numeric value. Unknown → 0. */
export function metricValue(ctx: IncentiveMetricContext, key: string): number {
  switch (key) {
    case "points":
      return ctx.points;
    case "leadsSubmitted":
      return ctx.leadsSubmitted;
    case "leadsAccepted":
      return ctx.leadsAccepted;
    case "followUps":
      return ctx.followUps;
    case "sales":
      return ctx.sales;
    case "scoredLeads":
      return ctx.scoredLeads;
    case "totalActivity":
      return ctx.leadsSubmitted + ctx.leadsAccepted + ctx.followUps + ctx.sales;
    default: {
      const rule = /^rulePoints:(\d+)$/.exec(key);
      if (rule) return ctx.rulePoints[rule[1]!] ?? 0;
      const ev = /^eventPoints:([A-Z0-9_]+)$/.exec(key);
      if (ev) return ctx.eventPoints[ev[1]!] ?? 0;
      return 0;
    }
  }
}

/* --------------------------- condition tree --------------------------- */

export const CONDITION_OPERATORS = ["gte", "lte", "gt", "lt", "eq", "neq"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export interface ConditionLeaf {
  metric: string;
  operator: ConditionOperator;
  value: number;
}
export interface ConditionGroup {
  op: "AND" | "OR";
  nodes: ConditionNode[];
}
export type ConditionNode = ConditionLeaf | ConditionGroup;

function isGroup(n: ConditionNode): n is ConditionGroup {
  return typeof (n as ConditionGroup).op === "string" && Array.isArray((n as ConditionGroup).nodes);
}
function applyOp(op: ConditionOperator, a: number, b: number): boolean {
  switch (op) {
    case "gte":
      return a >= b;
    case "lte":
      return a <= b;
    case "gt":
      return a > b;
    case "lt":
      return a < b;
    case "eq":
      return a === b;
    case "neq":
      return a !== b;
  }
}

export interface ConditionCheck {
  metric: string;
  operator: ConditionOperator;
  value: number;
  actual: number;
  pass: boolean;
}

export interface EligibilityResult {
  passed: boolean;
  /** flat list of every leaf evaluated, for the explanation */
  checks: ConditionCheck[];
}

/**
 * Evaluate an eligibility tree against the metric context. Total — never throws.
 * `null` / malformed tree → eligible with no checks (a scheme with no
 * conditions pays everyone in scope).
 */
export function evaluateEligibility(
  tree: ConditionNode | null | undefined,
  ctx: IncentiveMetricContext,
): EligibilityResult {
  const checks: ConditionCheck[] = [];
  if (tree == null || typeof tree !== "object") return { passed: true, checks };

  const walk = (node: ConditionNode): boolean => {
    if (isGroup(node)) {
      const results = node.nodes.map(walk);
      if (results.length === 0) return true;
      return node.op === "OR" ? results.some(Boolean) : results.every(Boolean);
    }
    const leaf = node as ConditionLeaf;
    const operator = (CONDITION_OPERATORS as readonly string[]).includes(leaf.operator)
      ? leaf.operator
      : "gte";
    const value = typeof leaf.value === "number" && Number.isFinite(leaf.value) ? leaf.value : 0;
    const actual = metricValue(ctx, String(leaf.metric));
    const pass = applyOp(operator, actual, value);
    checks.push({ metric: String(leaf.metric), operator, value, actual, pass });
    return pass;
  };

  const passed = walk(tree);
  return { passed, checks };
}

/** Static validation of a condition tree for the scheme editor. Returns []. */
export function validateConditionTree(tree: unknown, depth = 0): string[] {
  if (tree == null) return [];
  if (depth > 20) return ["condition_too_deep"];
  const errs: string[] = [];
  const n = tree as Record<string, unknown>;
  if (typeof n["op"] === "string") {
    if (n["op"] !== "AND" && n["op"] !== "OR") errs.push("bad_group_op");
    if (!Array.isArray(n["nodes"])) errs.push("group_missing_nodes");
    else for (const c of n["nodes"] as unknown[]) errs.push(...validateConditionTree(c, depth + 1));
    return errs;
  }
  if (typeof n["metric"] !== "string" || n["metric"].length === 0) errs.push("leaf_missing_metric");
  if (!(CONDITION_OPERATORS as readonly string[]).includes(n["operator"] as string))
    errs.push("leaf_bad_operator");
  if (typeof n["value"] !== "number" || !Number.isFinite(n["value"] as number))
    errs.push("leaf_bad_value");
  return errs;
}
