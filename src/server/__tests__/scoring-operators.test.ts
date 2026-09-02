import { describe, expect, it } from "vitest";
import { applyOperator, OPERATORS, toMicros } from "../scoring/operators";

const ok = (r: { result: boolean }) => r.result === true;

describe("scoring operators — every operator, pure + total", () => {
  it("covers all 15 operators", () => {
    expect(OPERATORS.length).toBe(15);
  });

  it("eq / ne", () => {
    expect(ok(applyOperator("eq", "CA", "CA", "string"))).toBe(true);
    expect(ok(applyOperator("eq", "CA", "NV", "string"))).toBe(false);
    expect(ok(applyOperator("ne", "CA", "NV", "string"))).toBe(true);
  });

  it("gt / gte / lt / lte on money", () => {
    expect(ok(applyOperator("gt", 20001, 20000, "money"))).toBe(true);
    expect(ok(applyOperator("gte", 20000, 20000, "money"))).toBe(true);
    expect(ok(applyOperator("lt", 19999, 20000, "money"))).toBe(true);
    expect(ok(applyOperator("lte", 20000, 20000, "money"))).toBe(true);
    expect(ok(applyOperator("gt", 20000, 20000, "money"))).toBe(false);
  });

  it("in / notIn", () => {
    expect(ok(applyOperator("in", "CA", ["CA", "NV"], "stringList"))).toBe(true);
    expect(ok(applyOperator("in", "TX", ["CA", "NV"], "stringList"))).toBe(false);
    expect(ok(applyOperator("notIn", "TX", ["CA", "NV"], "stringList"))).toBe(true);
    expect(ok(applyOperator("in", 30000, [10000, 30000], "number"))).toBe(true);
  });

  it("between (inclusive, order-independent)", () => {
    expect(ok(applyOperator("between", 25000, [20000, 30000], "money"))).toBe(true);
    expect(ok(applyOperator("between", 25000, [30000, 20000], "money"))).toBe(true);
    expect(ok(applyOperator("between", 31000, [20000, 30000], "money"))).toBe(false);
  });

  it("contains / startsWith / endsWith", () => {
    expect(ok(applyOperator("contains", "high-value", "value", "string"))).toBe(true);
    expect(ok(applyOperator("startsWith", "high-value", "high", "string"))).toBe(true);
    expect(ok(applyOperator("endsWith", "high-value", "value", "string"))).toBe(true);
  });

  it("regexMatch is bounded — rejects a too-long or catastrophic pattern", () => {
    expect(ok(applyOperator("regexMatch", "abc123", "^[a-z]+\\d+$", "string"))).toBe(true);
    expect(applyOperator("regexMatch", "x", "a".repeat(500), "string").reason).toBe("bad_regex");
    expect(applyOperator("regexMatch", "x", "(a+)+$", "string").reason).toBe("bad_regex");
  });

  it("exists / isNull handle missing + null distinctly", () => {
    expect(ok(applyOperator("exists", undefined, null, "string"))).toBe(false);
    expect(ok(applyOperator("exists", "x", null, "string"))).toBe(true);
    expect(ok(applyOperator("isNull", null, null, "string"))).toBe(true);
    expect(ok(applyOperator("isNull", undefined, null, "string"))).toBe(true);
    expect(ok(applyOperator("isNull", "x", null, "string"))).toBe(false);
  });

  it("missing field → false with reason, never throws", () => {
    const r = applyOperator("gte", undefined, 20000, "money");
    expect(r).toEqual({ result: false, reason: "missing_field" });
  });

  it("type mismatch → false with reason, never throws", () => {
    expect(applyOperator("gte", "abc", 20000, "money").reason).toBe("type_mismatch");
    expect(applyOperator("contains", 5, "x", "number").reason).toBe("operator_type_mismatch");
  });

  it("unknown operator → false", () => {
    expect(applyOperator("wat", 1, 1, "number")).toEqual({
      result: false,
      reason: "unknown_operator",
    });
  });

  it("boolean eq/ne with loose truthy tokens", () => {
    expect(ok(applyOperator("eq", "true", true, "boolean"))).toBe(true);
    expect(ok(applyOperator("eq", 0, false, "boolean"))).toBe(true);
    expect(ok(applyOperator("ne", true, false, "boolean"))).toBe(true);
  });

  it("date comparisons are ISO-lexicographic", () => {
    expect(ok(applyOperator("gte", "2026-08-31", "2026-08-01", "date"))).toBe(true);
    expect(ok(applyOperator("between", "2026-08-15", ["2026-08-01", "2026-08-31"], "date"))).toBe(
      true,
    );
  });
});

describe("scoring operators — toMicros decimal safety", () => {
  it("scales without float drift", () => {
    expect(toMicros(20000)).toBe(20_000_000_000);
    expect(toMicros("19999.99")).toBe(19_999_990_000);
    expect(toMicros(0.1)).toBe(100_000);
  });
  it("rejects NaN / Infinity / junk", () => {
    expect(toMicros(NaN)).toBeNull();
    expect(toMicros(Infinity)).toBeNull();
    expect(toMicros("abc")).toBeNull();
    expect(toMicros(true)).toBeNull();
  });
});
