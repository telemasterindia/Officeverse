import { describe, expect, it } from "vitest";
import { US_STATES, isUsStateCode, isValidUsZip, sanitizeZip } from "@/lib/officeverse/us-states";

describe("US_STATES — one canonical list", () => {
  it("has all 50 states + DC", () => {
    expect(US_STATES).toHaveLength(51);
    expect(US_STATES.some((s) => s.code === "DC")).toBe(true);
    expect(US_STATES.some((s) => s.code === "CA")).toBe(true);
  });
  it("codes are unique, uppercase, 2 letters; names are non-empty", () => {
    const codes = US_STATES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const s of US_STATES) {
      expect(s.code).toMatch(/^[A-Z]{2}$/);
      expect(s.name.trim().length).toBeGreaterThan(2);
    }
  });
  it("isUsStateCode is case-insensitive and rejects non-states", () => {
    expect(isUsStateCode("ma")).toBe(true);
    expect(isUsStateCode("MA")).toBe(true);
    expect(isUsStateCode("Massachusetts")).toBe(false);
    expect(isUsStateCode("ZZ")).toBe(false);
    expect(isUsStateCode("")).toBe(false);
    expect(isUsStateCode(null)).toBe(false);
  });
});

describe("ZIP is a string — leading zeros preserved, never numeric", () => {
  it("sanitizeZip keeps ZIP digits and drops letters", () => {
    expect(sanitizeZip("02108")).toBe("02108"); // leading zero survives
    expect(sanitizeZip("Boston 02108 MA")).toBe("02108");
    expect(sanitizeZip("90210")).toBe("90210");
    expect(sanitizeZip("abcde")).toBe("");
  });
  it("sanitizeZip formats ZIP+4", () => {
    expect(sanitizeZip("021081234")).toBe("02108-1234");
    expect(sanitizeZip("02108-1234")).toBe("02108-1234");
    expect(sanitizeZip("02108-")).toBe("02108");
    expect(sanitizeZip("021081234567")).toBe("02108-1234"); // extra digits trimmed
  });
  it("sanitizeZip never turns '02108' into a number-like '2108'", () => {
    expect(sanitizeZip("02108")).not.toBe("2108");
    expect(String(Number(sanitizeZip("02108")))).toBe("2108"); // proof: numeric coercion WOULD lose it
  });
  it("isValidUsZip accepts 5-digit and ZIP+4 only", () => {
    expect(isValidUsZip("02108")).toBe(true);
    expect(isValidUsZip("02108-1234")).toBe(true);
    expect(isValidUsZip("2108")).toBe(false);
    expect(isValidUsZip("021081")).toBe(false);
    expect(isValidUsZip("02108-12")).toBe(false);
    expect(isValidUsZip("abcde")).toBe(false);
    expect(isValidUsZip("")).toBe(false);
  });
});
