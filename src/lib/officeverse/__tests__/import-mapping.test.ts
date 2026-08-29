import { describe, expect, it } from "vitest";
import { analyzeMapping, autoDetectMapping, isMappingComplete } from "../import/mapping";
import { requiredKeys } from "../import/fields";

describe("autoDetectMapping", () => {
  it("maps exact + aliased + messy headers case-insensitively", () => {
    const headers = ["Customer Name", "Phone Number", "E-Mail", "Follow Up Date", "Follow-up time"];
    const m = autoDetectMapping(headers, "leads_followups");
    expect(m["customer_name"]).toBe("Customer Name");
    expect(m["phone"]).toBe("Phone Number");
    expect(m["email"]).toBe("E-Mail");
    expect(m["followup_date"]).toBe("Follow Up Date");
    expect(m["followup_time"]).toBe("Follow-up time");
  });

  it("does not map an unknown column", () => {
    const m = autoDetectMapping(["Customer", "Astrology Sign"], "leads");
    expect(m["customer_name"]).toBe("Customer");
    expect(Object.values(m)).not.toContain("Astrology Sign");
  });
});

describe("analyzeMapping", () => {
  const headers = ["name", "mobile", "junk"];

  it("flags a required field that is not mapped", () => {
    const m = autoDetectMapping(headers, "leads"); // maps customer_name + phone
    delete m["phone"];
    const report = analyzeMapping(m, headers, "leads");
    expect(report.missingRequired).toContain("phone");
    expect(isMappingComplete(report)).toBe(false);
  });

  it("lists unmapped headers and does not require follow-up columns in leads mode", () => {
    const m = autoDetectMapping(headers, "leads");
    const report = analyzeMapping(m, headers, "leads");
    expect(report.unmappedHeaders).toContain("junk");
    expect(report.missingRequired).toEqual([]);
    expect(isMappingComplete(report)).toBe(true);
  });

  it("detects a target pointing at a header not in the file", () => {
    const report = analyzeMapping({ customer_name: "name", phone: "ghost" }, headers, "leads");
    expect(report.invalidTargets).toContainEqual({ field: "phone", header: "ghost" });
  });

  it("detects two fields mapped to the same column", () => {
    const report = analyzeMapping({ customer_name: "name", comments: "name" }, headers, "leads");
    expect(report.duplicateHeaders).toContain("name");
    expect(isMappingComplete(report)).toBe(false);
  });
});

describe("requiredKeys", () => {
  it("leads mode requires name + phone only", () => {
    expect(requiredKeys("leads").sort()).toEqual(["customer_name", "phone"]);
  });
  it("leads+followups mode also requires the follow-up date + time columns", () => {
    expect(requiredKeys("leads_followups").sort()).toEqual([
      "customer_name",
      "followup_date",
      "followup_time",
      "phone",
    ]);
  });
});
