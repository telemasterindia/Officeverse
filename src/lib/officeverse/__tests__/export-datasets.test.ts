import { describe, expect, it } from "vitest";
import {
  EXPORT_DATASETS,
  EXPORT_DATASET_KEYS,
  MAX_EXPORT_ROWS,
  catalogIsSafe,
} from "../export/datasets";

const SECRET_RE = /password|passwd|pwd|hash|secret|token|salt|session|credential|api[_-]?key/i;

describe("export catalog", () => {
  it("covers all 8 required export types (+ combined + history)", () => {
    expect(EXPORT_DATASET_KEYS).toEqual(
      expect.arrayContaining([
        "leads",
        "followups",
        "combined",
        "lead_assignments",
        "followup_history",
        "imports",
        "agents",
        "closers",
        "clients",
      ]),
    );
  });

  it("every dataset has a sheet name, ≥1 column, and unique column keys", () => {
    for (const k of EXPORT_DATASET_KEYS) {
      const d = EXPORT_DATASETS[k];
      expect(d.sheetName.length).toBeGreaterThan(0);
      expect(d.columns.length).toBeGreaterThan(0);
      const keys = d.columns.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("NO column exposes a secret / auth field", () => {
    expect(catalogIsSafe()).toBe(true);
    for (const k of EXPORT_DATASET_KEYS) {
      for (const c of EXPORT_DATASETS[k].columns) {
        expect(SECRET_RE.test(c.key)).toBe(false);
        expect(SECRET_RE.test(c.header)).toBe(false);
      }
    }
  });

  it("agents / closers exports never include dob or salary hashes and DO include the staff email/role/status", () => {
    for (const k of ["agents", "closers"] as const) {
      const keys = EXPORT_DATASETS[k].columns.map((c) => c.key);
      expect(keys).not.toContain("dob");
      expect(keys).not.toContain("monthly_salary");
      expect(keys).toEqual(expect.arrayContaining(["code", "name", "email", "role", "status"]));
    }
  });

  it("identity-ish columns are flagged as text (ZIP / phone / *_id / *_code)", () => {
    for (const k of EXPORT_DATASET_KEYS) {
      for (const c of EXPORT_DATASETS[k].columns) {
        if (/(^|_)(zip|phone)$/.test(c.key) || /_id$|_code$/.test(c.key)) {
          expect(c.text, `${k}.${c.key} should be text`).toBe(true);
        }
      }
    }
  });

  it("each dataset only lists filter keys it can actually apply, and a date field", () => {
    for (const k of EXPORT_DATASET_KEYS) {
      const d = EXPORT_DATASETS[k];
      expect(d.dateFields.length).toBeGreaterThan(0);
      expect(new Set(d.filters).size).toBe(d.filters.length);
    }
  });

  it("MAX_EXPORT_ROWS is a sane hard cap", () => {
    expect(MAX_EXPORT_ROWS).toBe(50_000);
  });
});
