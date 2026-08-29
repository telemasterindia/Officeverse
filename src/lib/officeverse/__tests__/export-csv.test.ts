import { describe, expect, it } from "vitest";
import { toCsv } from "../export/csv";

describe("toCsv", () => {
  it("writes a header row + data rows with CRLF and a trailing newline", () => {
    const csv = toCsv(
      ["A", "B"],
      [
        ["1", "2"],
        ["3", "4"],
      ],
    );
    expect(csv).toBe("A,B\r\n1,2\r\n3,4\r\n");
  });

  it("quotes fields containing comma / quote / newline and doubles inner quotes", () => {
    const csv = toCsv(["name", "note"], [["Cooper, Jane", 'said "hi"\nbye']]);
    expect(csv).toBe('name,note\r\n"Cooper, Jane","said ""hi""\nbye"\r\n');
  });

  it("renders null / undefined as empty and numbers as plain text", () => {
    expect(toCsv(["a", "b", "c"], [[null, undefined, 42]])).toBe("a,b,c\r\n,,42\r\n");
  });

  it("preserves leading zeros in ZIPs / phone-like strings (no numeric coercion)", () => {
    const csv = toCsv(["zip", "phone"], [["07030", "015125550142"]]);
    expect(csv).toContain("07030");
    expect(csv).toContain("015125550142");
    expect(csv).not.toMatch(/7\.03e/i);
  });
});
