import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, commitImportSchema, previewImportSchema } from "../validation/import";

const good = {
  mode: "leads_followups",
  fileName: "book.xlsx",
  mapping: { customer_name: "Name", phone: "Phone" },
  rows: [{ Name: "Jane", Phone: "5551234567" }],
};

describe("previewImportSchema", () => {
  it("accepts a well-formed payload", () => {
    expect(previewImportSchema.parse(good)).toMatchObject({ mode: "leads_followups" });
  });

  it("rejects an unknown mode", () => {
    expect(() => previewImportSchema.parse({ ...good, mode: "everything" })).toThrow();
  });

  it("requires at least one row and caps the row count", () => {
    expect(() => previewImportSchema.parse({ ...good, rows: [] })).toThrow();
    const tooMany = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ({ Name: "x" }));
    expect(() => previewImportSchema.parse({ ...good, rows: tooMany })).toThrow();
  });

  it("commit shares the preview shape", () => {
    expect(commitImportSchema.parse(good)).toMatchObject({ fileName: "book.xlsx" });
  });

  it("does not accept a client-supplied owner/user id field (stripped)", () => {
    const parsed = previewImportSchema.parse({
      ...good,
      uploadedByUserId: 999,
      actorRole: "admin",
    } as Record<string, unknown>);
    expect(parsed).not.toHaveProperty("uploadedByUserId");
    expect(parsed).not.toHaveProperty("actorRole");
  });
});

describe("bulk-import endpoint placement", () => {
  it("import server functions live OUTSIDE src/server/** (client import-protection)", () => {
    const serverApi = readdirSync(join(__dirname, "..", "api"));
    expect(serverApi.some((f) => /import/i.test(f))).toBe(false);
  });
});
