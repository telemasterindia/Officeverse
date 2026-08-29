import { describe, expect, it } from "vitest";
import { describeFilters, normalizeExportFilters } from "../export/filters";

describe("normalizeExportFilters — keeps only the dataset's allowed keys", () => {
  it("leads: date range + status + agent/closer/state/zip/source pass; unknown keys dropped", () => {
    const f = normalizeExportFilters("leads", {
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      dateField: "shift",
      status: "NEW",
      agentCode: "ag-00001",
      closerCode: "cl-00002",
      state: "TX",
      zip: "78701",
      source: "import",
      followUpStatus: "SCHEDULED", // not a leads filter → dropped
      ownerRole: "closer", // not a leads filter → dropped
      wat: "nope",
    });
    expect(f).toEqual({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      dateField: "shift",
      status: "NEW",
      agentCode: "AG-00001",
      closerCode: "CL-00002",
      state: "TX",
      zip: "78701",
      source: "import",
    });
  });

  it("rejects a non-ISO date and an unknown dateField", () => {
    const f = normalizeExportFilters("leads", { dateFrom: "01/09/2026", dateField: "banana" });
    expect(f.dateFrom).toBeUndefined();
    expect(f.dateField).toBeUndefined();
  });

  it("followups: ownerRole only accepts agent|closer", () => {
    expect(normalizeExportFilters("followups", { ownerRole: "closer" }).ownerRole).toBe("closer");
    expect(normalizeExportFilters("followups", { ownerRole: "boss" }).ownerRole).toBeUndefined();
  });

  it("carries an injection-looking value through as DATA (the query layer binds it)", () => {
    const evil = "'; DROP TABLE leads; --";
    const f = normalizeExportFilters("leads", { state: evil });
    expect(f.state).toBe(evil); // untouched string; never interpreted as SQL
  });

  it("agents/closers/clients only expose date + status filters", () => {
    for (const ds of ["agents", "closers", "clients"] as const) {
      const f = normalizeExportFilters(ds, {
        status: "active",
        agentCode: "AG-1",
        state: "TX",
      });
      expect(f.status).toBe("active");
      expect(f.agentCode).toBeUndefined();
      expect(f.state).toBeUndefined();
    }
  });

  it("describeFilters produces a flat string map for the audit log", () => {
    expect(describeFilters({ status: "NEW", agentCode: "AG-1" })).toEqual({
      status: "NEW",
      agentCode: "AG-1",
    });
  });
});
