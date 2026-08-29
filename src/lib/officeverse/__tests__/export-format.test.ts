import { describe, expect, it } from "vitest";
import { cellText, fmtDate, fmtDateTime, textValue } from "../export/format";

describe("cellText — never '[object Object]'", () => {
  it("passes strings through and coerces primitives", () => {
    expect(cellText("hello")).toBe("hello");
    expect(cellText(42)).toBe("42");
    expect(cellText(0)).toBe("0");
    expect(cellText(true)).toBe("yes");
    expect(cellText(false)).toBe("no");
  });

  it("null / undefined / NaN → empty string", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText(Number.NaN)).toBe("");
  });

  it("objects and arrays become JSON, never '[object Object]'", () => {
    expect(cellText({ a: 1 })).toBe('{"a":1}');
    expect(cellText([1, 2])).toBe("[1,2]");
    expect(cellText({ a: 1 })).not.toBe("[object Object]");
  });

  it("Date → readable 'YYYY-MM-DD HH:MM:SS'", () => {
    expect(cellText(new Date("2026-09-14T10:05:00Z"))).toBe("2026-09-14 10:05:00");
  });
});

describe("date helpers", () => {
  it("fmtDateTime trims seconds off an IST wall-clock string", () => {
    expect(fmtDateTime("2026-09-14 10:05:33")).toBe("2026-09-14 10:05");
    expect(fmtDateTime("2026-09-14T10:05:33+05:30")).toBe("2026-09-14 10:05");
    expect(fmtDateTime(null)).toBe("");
  });
  it("fmtDate keeps just the calendar date", () => {
    expect(fmtDate("2026-09-14 10:05:33")).toBe("2026-09-14");
    expect(fmtDate("2026-09-14")).toBe("2026-09-14");
  });
  it("textValue coerces anything to a safe string", () => {
    expect(textValue("07030")).toBe("07030");
    expect(textValue(null)).toBe("");
  });
});
