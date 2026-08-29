import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportCountSchema, exportRequestSchema } from "../validation/export";

const good = { dataset: "leads", format: "xlsx", filters: { status: "NEW" } };

describe("exportRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(exportRequestSchema.parse(good)).toMatchObject({ dataset: "leads", format: "xlsx" });
  });

  it("rejects an unknown dataset and an unknown format", () => {
    expect(() => exportRequestSchema.parse({ ...good, dataset: "users" })).toThrow();
    expect(() => exportRequestSchema.parse({ ...good, dataset: "audit_logs" })).toThrow();
    expect(() => exportRequestSchema.parse({ ...good, format: "pdf" })).toThrow();
  });

  it("defaults filters to {} and never accepts a client role / user id", () => {
    const parsed = exportRequestSchema.parse({ dataset: "clients", format: "csv" });
    expect(parsed.filters).toEqual({});
    const injected = exportRequestSchema.parse({
      ...good,
      role: "admin",
      userId: 1,
      columns: ["password_hash"],
      table: "users",
    } as Record<string, unknown>);
    expect(injected).not.toHaveProperty("role");
    expect(injected).not.toHaveProperty("userId");
    expect(injected).not.toHaveProperty("columns");
    expect(injected).not.toHaveProperty("table");
  });

  it("count schema has no format field", () => {
    const parsed = exportCountSchema.parse({ dataset: "followups" });
    expect(parsed).not.toHaveProperty("format");
  });
});

describe("export endpoint placement", () => {
  it("no export server function lives under src/server/api (client import-protection)", () => {
    const files = readdirSync(join(__dirname, "..", "api"));
    expect(files.some((f) => /export/i.test(f))).toBe(false);
  });
});
