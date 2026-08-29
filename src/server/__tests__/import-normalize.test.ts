import { describe, expect, it } from "vitest";
import { fieldsForMode, type ImportMode } from "@/lib/officeverse/import/fields";
import { normalizeRow } from "../import/normalize-row";

/** identity mapping: every field's column header == its key */
function idMapping(mode: ImportMode): Record<string, string> {
  const m: Record<string, string> = {};
  for (const f of fieldsForMode(mode)) m[f.key] = f.key;
  return m;
}

const errCodes = (r: ReturnType<typeof normalizeRow>) => r.errors.map((e) => e.code);

describe("normalizeRow — Lead fields", () => {
  const map = idMapping("leads");

  it("accepts a valid lead", () => {
    const r = normalizeRow(
      {
        customer_name: "Jane Cooper",
        phone: "+1 (512) 555-0142",
        email: "jane@acme.com",
        debt_amount: "$18,500",
        status: "new",
        current_debts: "late",
      },
      map,
      "leads",
      2,
    );
    expect(r.errors).toHaveLength(0);
    expect(r.lead).toMatchObject({
      customerName: "Jane Cooper",
      phoneNormalized: "15125550142",
      email: "jane@acme.com",
      emailNormalized: "jane@acme.com",
      debtAmount: "18500.00",
      status: "NEW",
      currentDebts: "Late",
    });
  });

  it("rejects a missing name and an unusable phone", () => {
    const r = normalizeRow({ customer_name: "", phone: "n/a" }, map, "leads", 3);
    expect(errCodes(r)).toEqual(expect.arrayContaining(["required", "invalid_phone"]));
  });

  it("rejects a malformed email, bad amount, bad status, bad current/late", () => {
    const r = normalizeRow(
      {
        customer_name: "X",
        phone: "5551234567",
        email: "nope",
        debt_amount: "abc",
        status: "WON",
        current_debts: "maybe",
      },
      map,
      "leads",
      4,
    );
    expect(errCodes(r)).toEqual(
      expect.arrayContaining([
        "invalid_email",
        "invalid_number",
        "invalid_status",
        "invalid_value",
      ]),
    );
  });

  it("upper-cases agent/closer codes for later resolution", () => {
    const r = normalizeRow(
      { customer_name: "X", phone: "5551234567", agent_code: "ag-00001", closer_code: "cl-00002" },
      map,
      "leads",
      5,
    );
    expect(r.lead?.agentCode).toBe("AG-00001");
    expect(r.lead?.closerCode).toBe("CL-00002");
  });
});

describe("normalizeRow — Follow-up fields", () => {
  const map = idMapping("leads_followups");

  it("builds scheduledAt from the literal calendar date + time (no shift roll-back)", () => {
    const r = normalizeRow(
      {
        customer_name: "X",
        phone: "5551234567",
        followup_date: "2026-09-15",
        followup_time: "2:00",
      },
      map,
      "leads_followups",
      2,
    );
    expect(r.errors).toHaveLength(0);
    expect(r.followUp?.scheduledAt).toBe("2026-09-15 02:00:00");
  });

  it("rejects a bad date and a bad time", () => {
    const r = normalizeRow(
      {
        customer_name: "X",
        phone: "5551234567",
        followup_date: "15/09/2026",
        followup_time: "25:00",
      },
      map,
      "leads_followups",
      3,
    );
    expect(errCodes(r)).toEqual(expect.arrayContaining(["invalid_date", "invalid_time"]));
  });

  it("a closer-owned follow-up needs a closer code", () => {
    const r = normalizeRow(
      {
        customer_name: "X",
        phone: "5551234567",
        followup_date: "2026-09-15",
        followup_time: "10:00",
        followup_owner_role: "closer",
      },
      map,
      "leads_followups",
      4,
    );
    expect(errCodes(r)).toContain("required");
    expect(r.errors.some((e) => e.field === "followup_closer_code")).toBe(true);
  });

  it("leads+followups row with no follow-up columns → warning, lead only", () => {
    const r = normalizeRow({ customer_name: "X", phone: "5551234567" }, map, "leads_followups", 5);
    expect(r.followUp).toBeNull();
    expect(r.warnings.map((w) => w.code)).toContain("no_follow_up");
  });
});

describe("normalizeRow — follow-ups mode link reference", () => {
  const map = idMapping("followups");

  it("accepts a valid TMI_ lead code", () => {
    const r = normalizeRow(
      { lead_code: "tmi_00012007", followup_date: "2026-09-15", followup_time: "10:00" },
      map,
      "followups",
      2,
    );
    expect(r.errors).toHaveLength(0);
    expect(r.linkLeadCode).toBe("TMI_00012007");
  });

  it("rejects a malformed lead code", () => {
    const r = normalizeRow(
      { lead_code: "TMI_123", followup_date: "2026-09-15", followup_time: "10:00" },
      map,
      "followups",
      3,
    );
    expect(errCodes(r)).toContain("invalid_lead_code");
  });

  it("rejects a follow-up row with no lead reference at all", () => {
    const r = normalizeRow(
      { followup_date: "2026-09-15", followup_time: "10:00" },
      map,
      "followups",
      4,
    );
    expect(errCodes(r)).toContain("no_lead_reference");
  });
});
