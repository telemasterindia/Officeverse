import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvGrid } from "../import/csv";

describe("parseCsvGrid", () => {
  it("splits simple rows", () => {
    expect(parseCsvGrid("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with commas and quotes", () => {
    expect(parseCsvGrid('name,note\n"Cooper, Jane","She said ""hi"""')).toEqual([
      ["name", "note"],
      ["Cooper, Jane", 'She said "hi"'],
    ]);
  });

  it("handles quoted newlines and CRLF line endings", () => {
    const grid = parseCsvGrid('a,b\r\n"line1\nline2",x\r\n');
    expect(grid).toEqual([
      ["a", "b"],
      ["line1\nline2", "x"],
    ]);
  });

  it("strips a leading BOM", () => {
    expect(parseCsvGrid("﻿a,b\n1,2")[0]).toEqual(["a", "b"]);
  });
});

describe("parseCsv", () => {
  it("returns header-keyed row objects and drops blank lines", () => {
    const { headers, rows, rowCount } = parseCsv("name,phone\nJane,555\n\nBob,777\n");
    expect(headers).toEqual(["name", "phone"]);
    expect(rows).toEqual([
      { name: "Jane", phone: "555" },
      { name: "Bob", phone: "777" },
    ]);
    expect(rowCount).toBe(2);
  });

  it("trims header and cell whitespace", () => {
    const { headers, rows } = parseCsv(" name , phone \n  Jane  , 555 ");
    expect(headers).toEqual(["name", "phone"]);
    expect(rows[0]).toEqual({ name: "Jane", phone: "555" });
  });

  it("pads short rows with empty strings", () => {
    const { rows } = parseCsv("a,b,c\n1,2");
    expect(rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });

  it("an empty file yields no headers and no rows", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [], rowCount: 0 });
    expect(parseCsv("   \n  \n")).toEqual({ headers: [], rows: [], rowCount: 0 });
  });

  it("a header-only file yields zero rows", () => {
    expect(parseCsv("name,phone")).toMatchObject({ headers: ["name", "phone"], rowCount: 0 });
  });
});
