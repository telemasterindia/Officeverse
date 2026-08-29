import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES } from "@/lib/db/schema";
import { isKnownTemplate, renderEmailTemplate } from "../email/templates";

describe("renderEmailTemplate", () => {
  it("every declared template renders a non-empty subject + text + html", () => {
    for (const id of EMAIL_TEMPLATES) {
      const r = renderEmailTemplate(id, {
        recipient_name: "Sam",
        customer_name: "Acme Co",
        follow_up_code: "FU_00004415",
        lead_code: "TMI_00012007",
        from: "2026-09-01 10:00",
        to: "2026-09-03 14:00",
        title: "Heads up",
        message: "Something happened",
      });
      expect(r.subject.length).toBeGreaterThan(0);
      expect(r.text.length).toBeGreaterThan(0);
      expect(r.html).toContain("<");
      expect(r.text).not.toContain("undefined");
      expect(r.subject).not.toContain("undefined");
      expect(r.html).not.toContain("undefined");
    }
  });

  it("FOLLOW_UP_RESCHEDULED mentions both times", () => {
    const r = renderEmailTemplate("FOLLOW_UP_RESCHEDULED", {
      follow_up_code: "FU_1",
      from: "2026-09-01 10:00",
      to: "2026-09-03 14:00",
    });
    expect(r.text).toContain("2026-09-01 10:00");
    expect(r.text).toContain("2026-09-03 14:00");
  });

  it("LEAD_ASSIGNED names the lead and customer", () => {
    const r = renderEmailTemplate("LEAD_ASSIGNED", {
      lead_code: "TMI_00012007",
      customer_name: "Acme Co",
    });
    expect(r.subject).toContain("TMI_00012007");
    expect(r.text).toContain("Acme Co");
  });

  it("tolerates a completely empty payload (no 'undefined' leakage)", () => {
    const r = renderEmailTemplate("FOLLOW_UP_REMINDER", {});
    expect(r.text).not.toMatch(/undefined|null/);
    expect(r.subject).not.toMatch(/undefined|null/);
  });

  it("escapes HTML in payload values", () => {
    const r = renderEmailTemplate("SYSTEM_NOTIFICATION", {
      title: "<script>x</script>",
      message: "a & b < c",
    });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&amp;");
  });

  it("throws on an unknown template id", () => {
    expect(() => renderEmailTemplate("NOPE")).toThrow();
  });
});

describe("isKnownTemplate", () => {
  it("recognises declared ids and rejects others", () => {
    expect(isKnownTemplate("FOLLOW_UP_REMINDER")).toBe(true);
    expect(isKnownTemplate("LEAD_ASSIGNED")).toBe(true);
    expect(isKnownTemplate("")).toBe(false);
    expect(isKnownTemplate("random")).toBe(false);
  });
});
