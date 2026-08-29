import { describe, expect, it } from "vitest";
import { parseCsv } from "../import/csv";
import { requiredKeys, type ImportMode } from "../import/fields";
import { templateColumns, templateCsv, templateFileName } from "../import/template";

const MODES: ImportMode[] = ["leads", "leads_followups", "followups"];

describe("import template", () => {
  for (const mode of MODES) {
    it(`${mode}: template CSV round-trips and contains every required column`, () => {
      const csv = templateCsv(mode);
      const { headers, rows } = parseCsv(csv);
      expect(headers).toEqual(templateColumns(mode));
      expect(rows).toHaveLength(1); // header + one example row
      for (const key of requiredKeys(mode)) {
        expect(headers).toContain(key);
      }
    });
  }

  it("file name is mode-specific and .csv", () => {
    expect(templateFileName("leads_followups")).toBe(
      "officeverse-import-template-leads_followups.csv",
    );
  });

  it("the example row is non-empty for required fields", () => {
    const { rows } = parseCsv(templateCsv("leads"));
    expect(rows[0]!["customer_name"]).toBeTruthy();
    expect(rows[0]!["phone"]).toBeTruthy();
  });
});
