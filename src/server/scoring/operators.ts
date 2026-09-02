/**
 * Officeverse — Scoring Engine OPERATOR ENGINE (Phase 2). PURE.
 *
 * No DB. No CRM access. No side effects. Every operator is total: on a type
 * mismatch, a missing side, a bad regex or an unknown operator it returns
 * `{ result: false, reason }` and NEVER throws — so a malformed rule can never
 * crash ingest and can never award a point by accident.
 *
 * MONEY / DECIMAL SAFETY
 * ---------------------
 * `number` and `money` values are compared as INTEGERS in micro-units
 * (value × 1_000_000, rounded). `debt_amount` 19999.99 becomes 19_999_990_000;
 * 20000 becomes 20_000_000_000. No IEEE-754 drift, no silent rounding of the
 * business value itself. NaN / Infinity / non-numeric strings → "type_mismatch".
 */
import type { FieldType } from "./fields";

export const OPERATORS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "notIn",
  "between",
  "contains",
  "startsWith",
  "endsWith",
  "exists",
  "isNull",
  "regexMatch",
] as const;
export type Operator = (typeof OPERATORS)[number];

export interface OperatorDef {
  op: Operator;
  /** value types this operator can be authored against */
  types: FieldType[];
  arity: "unary" | "binary" | "range" | "list";
}

const ALL: FieldType[] = ["number", "money", "string", "stringList", "boolean", "date"];
const ORDINAL: FieldType[] = ["number", "money", "string", "date"];
const TEXT: FieldType[] = ["string"];

export const OPERATOR_DEFS: readonly OperatorDef[] = [
  { op: "eq", types: [...ALL], arity: "binary" },
  { op: "ne", types: [...ALL], arity: "binary" },
  { op: "gt", types: [...ORDINAL], arity: "binary" },
  { op: "gte", types: [...ORDINAL], arity: "binary" },
  { op: "lt", types: [...ORDINAL], arity: "binary" },
  { op: "lte", types: [...ORDINAL], arity: "binary" },
  { op: "in", types: ["number", "money", "string", "stringList", "date"], arity: "list" },
  { op: "notIn", types: ["number", "money", "string", "stringList", "date"], arity: "list" },
  { op: "between", types: [...ORDINAL], arity: "range" },
  { op: "contains", types: [...TEXT], arity: "binary" },
  { op: "startsWith", types: [...TEXT], arity: "binary" },
  { op: "endsWith", types: [...TEXT], arity: "binary" },
  { op: "regexMatch", types: [...TEXT], arity: "binary" },
  { op: "exists", types: [...ALL], arity: "unary" },
  { op: "isNull", types: [...ALL], arity: "unary" },
] as const;

const BY_OP: ReadonlyMap<string, OperatorDef> = new Map(OPERATOR_DEFS.map((d) => [d.op, d]));

export function isOperator(x: string): x is Operator {
  return BY_OP.has(x);
}
export function getOperatorDef(op: string): OperatorDef | undefined {
  return BY_OP.get(op);
}
export function operatorSupportsType(op: string, type: FieldType): boolean {
  return BY_OP.get(op)?.types.includes(type) === true;
}

export interface OperatorResult {
  result: boolean;
  reason?: string;
}

const T = (): OperatorResult => ({ result: true });
const F = (reason: string): OperatorResult => ({ result: false, reason });

const MONEY_SCALE = 1_000_000;
const MAX_REGEX_PATTERN = 200;
const MAX_REGEX_INPUT = 2000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** number | numeric string → integer micro-units, or null when not a finite number. */
export function toMicros(v: unknown): number | null {
  if (typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * MONEY_SCALE) : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "" || !/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * MONEY_SCALE) : null;
  }
  return null;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return null;
}

function safeRegex(pattern: unknown): RegExp | null {
  if (typeof pattern !== "string" || pattern.length === 0 || pattern.length > MAX_REGEX_PATTERN) {
    return null;
  }
  // reject the classic catastrophic-backtracking shapes: nested quantifiers.
  if (/(\([^()]*[+*][^()]*\)\s*[+*])|([+*]\s*\{\d+,\s*\}\s*[+*{])/.test(pattern)) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/**
 * Evaluate one leaf. `left` is the payload value, `right` the rule's authored
 * value, `valueType` the leaf's declared type. Total — never throws.
 */
export function applyOperator(
  op: string,
  left: unknown,
  right: unknown,
  valueType: FieldType,
): OperatorResult {
  if (!isOperator(op)) return F("unknown_operator");

  // ---- unary: presence checks work regardless of type ----
  if (op === "exists") return left === undefined || left === null ? F("absent") : T();
  if (op === "isNull") return left === undefined || left === null ? T() : F("present");

  if (!operatorSupportsType(op, valueType)) return F("operator_type_mismatch");

  if (left === undefined) return F("missing_field");
  if (left === null) return F("null_value");

  switch (valueType) {
    case "number":
    case "money":
      return numeric(op, left, right);
    case "date":
      return ordinalDate(op, left, right);
    case "string":
      return text(op, left, right);
    case "stringList":
      return list(op, left, right);
    case "boolean": {
      const lb = toBool(left);
      const rb = toBool(right);
      if (lb === null || rb === null) return F("type_mismatch");
      if (op === "eq") return lb === rb ? T() : F("ne");
      if (op === "ne") return lb !== rb ? T() : F("eq");
      return F("operator_type_mismatch");
    }
    default:
      return F("unknown_value_type");
  }
}

function numeric(op: Operator, left: unknown, right: unknown): OperatorResult {
  const l = toMicros(left);
  if (l === null) return F("type_mismatch");

  if (op === "in" || op === "notIn") {
    if (!Array.isArray(right)) return F("type_mismatch");
    const hit = right.some((r) => {
      const rm = toMicros(r);
      return rm !== null && rm === l;
    });
    return (op === "in" ? hit : !hit) ? T() : F(op);
  }
  if (op === "between") {
    if (!Array.isArray(right) || right.length !== 2) return F("type_mismatch");
    const lo = toMicros(right[0]);
    const hi = toMicros(right[1]);
    if (lo === null || hi === null) return F("type_mismatch");
    return l >= Math.min(lo, hi) && l <= Math.max(lo, hi) ? T() : F("out_of_range");
  }
  const r = toMicros(right);
  if (r === null) return F("type_mismatch");
  switch (op) {
    case "eq":
      return l === r ? T() : F("ne");
    case "ne":
      return l !== r ? T() : F("eq");
    case "gt":
      return l > r ? T() : F("not_gt");
    case "gte":
      return l >= r ? T() : F("not_gte");
    case "lt":
      return l < r ? T() : F("not_lt");
    case "lte":
      return l <= r ? T() : F("not_lte");
    default:
      return F("operator_type_mismatch");
  }
}

function asDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, 10);
  return ISO_DATE.test(s) ? s : null;
}

function ordinalDate(op: Operator, left: unknown, right: unknown): OperatorResult {
  const l = asDate(left);
  if (l === null) return F("type_mismatch");
  if (op === "in" || op === "notIn") {
    if (!Array.isArray(right)) return F("type_mismatch");
    const hit = right.some((r) => asDate(r) === l);
    return (op === "in" ? hit : !hit) ? T() : F(op);
  }
  if (op === "between") {
    if (!Array.isArray(right) || right.length !== 2) return F("type_mismatch");
    const lo = asDate(right[0]);
    const hi = asDate(right[1]);
    if (lo === null || hi === null) return F("type_mismatch");
    const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
    return l >= a && l <= b ? T() : F("out_of_range");
  }
  const r = asDate(right);
  if (r === null) return F("type_mismatch");
  switch (op) {
    case "eq":
      return l === r ? T() : F("ne");
    case "ne":
      return l !== r ? T() : F("eq");
    case "gt":
      return l > r ? T() : F("not_gt");
    case "gte":
      return l >= r ? T() : F("not_gte");
    case "lt":
      return l < r ? T() : F("not_lt");
    case "lte":
      return l <= r ? T() : F("not_lte");
    default:
      return F("operator_type_mismatch");
  }
}

function text(op: Operator, left: unknown, right: unknown): OperatorResult {
  if (typeof left !== "string" && typeof left !== "number") return F("type_mismatch");
  const l = String(left);
  if (op === "in" || op === "notIn") {
    if (!Array.isArray(right)) return F("type_mismatch");
    const hit = right.some((r) => String(r) === l);
    return (op === "in" ? hit : !hit) ? T() : F(op);
  }
  if (op === "between") {
    if (!Array.isArray(right) || right.length !== 2) return F("type_mismatch");
    const a = String(right[0]);
    const b = String(right[1]);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return l >= lo && l <= hi ? T() : F("out_of_range");
  }
  if (typeof right !== "string" && typeof right !== "number") {
    if (op === "regexMatch") {
      /* fallthrough to regex handling for non-string right → invalid */
    }
    return F("type_mismatch");
  }
  const r = String(right);
  switch (op) {
    case "eq":
      return l === r ? T() : F("ne");
    case "ne":
      return l !== r ? T() : F("eq");
    case "gt":
      return l > r ? T() : F("not_gt");
    case "gte":
      return l >= r ? T() : F("not_gte");
    case "lt":
      return l < r ? T() : F("not_lt");
    case "lte":
      return l <= r ? T() : F("not_lte");
    case "contains":
      return l.includes(r) ? T() : F("no_substring");
    case "startsWith":
      return l.startsWith(r) ? T() : F("no_prefix");
    case "endsWith":
      return l.endsWith(r) ? T() : F("no_suffix");
    case "regexMatch": {
      const re = safeRegex(r);
      if (!re) return F("bad_regex");
      return re.test(l.slice(0, MAX_REGEX_INPUT)) ? T() : F("no_match");
    }
    default:
      return F("operator_type_mismatch");
  }
}

function list(op: Operator, left: unknown, right: unknown): OperatorResult {
  // valueType "stringList" → the authored value is an array; the payload side is scalar.
  if (op !== "in" && op !== "notIn" && op !== "eq" && op !== "ne")
    return F("operator_type_mismatch");
  if (!Array.isArray(right)) return F("type_mismatch");
  const l = String(left);
  const hit = right.some((r) => String(r) === l);
  if (op === "in" || op === "eq") return hit ? T() : F("not_in");
  return hit ? F("in") : T(); // notIn / ne
}
