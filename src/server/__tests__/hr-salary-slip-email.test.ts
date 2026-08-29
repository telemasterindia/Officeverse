import { describe, expect, it } from "vitest";
import { buildSalarySlipEmail } from "../hr/salary-slip-email";

describe("buildSalarySlipEmail — concise, no salary figures, no incentive/tax language", () => {
  const final = buildSalarySlipEmail({
    employeeName: "Jane Doe",
    periodMonth: "2026-08",
    isPreview: false,
    fileName: "Officeverse_Salary_Slip_2026-08_Jane_Doe.pdf",
  });

  it("subject follows the required format", () => {
    expect(final.subject).toBe("Officeverse Salary Slip - August 2026");
  });

  it("body names the employee, the month and that the slip is attached", () => {
    expect(final.text).toContain("Jane Doe");
    expect(final.text).toContain("August 2026");
    expect(final.text.toLowerCase()).toContain("attached");
    expect(final.html).toContain("Jane Doe");
  });

  it("body carries no salary / bonus figures", () => {
    expect(final.text).not.toMatch(/\d{2,}[.,]\d{2}/);
    expect(final.text).not.toMatch(/₹|INR/);
  });

  it("no Closer-reward, tax or legal wording", () => {
    for (const bad of [
      /incentive/i,
      /commission/i,
      /\bsales\b/i,
      /\btax\b/i,
      /statutory/i,
      /\bPF\b/,
    ]) {
      expect(final.text).not.toMatch(bad);
      expect(final.html).not.toMatch(bad);
    }
  });

  it("preview variant is clearly marked", () => {
    const preview = buildSalarySlipEmail({
      employeeName: "Jane Doe",
      periodMonth: "2026-08",
      isPreview: true,
      fileName: "x_PREVIEW.pdf",
    });
    expect(preview.subject).toContain("(Preview)");
    expect(preview.text.toLowerCase()).toContain("preview");
  });
});
