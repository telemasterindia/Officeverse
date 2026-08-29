import { describe, expect, it } from "vitest";
import {
  formatInr,
  monthLabel,
  renderSalarySlipPdf,
  sha256Hex,
  type SalarySlipPdfData,
} from "../hr/salary-slip-pdf";

const BASE: SalarySlipPdfData = {
  employeeName: "Jane Doe",
  userId: 42,
  process: "US",
  periodMonth: "2026-08",
  baseSalary: "30000.00",
  regularityBonus: 1000,
  calculatedSalary: "31000.00",
  leaveCount: 0,
  offCount: 0,
  payrollStatus: "LOCKED",
  calculationVersion: "v1",
  slipVersion: 1,
  isPreview: false,
  generatedAt: "2026-09-01 10:00:00",
};

const text = (d: SalarySlipPdfData) => new TextDecoder().decode(renderSalarySlipPdf(d));

describe("formatInr / monthLabel", () => {
  it("formats rupees with thousands separators and 2 dp", () => {
    expect(formatInr("30000.00")).toBe("INR 30,000.00");
    expect(formatInr(1000)).toBe("INR 1,000.00");
    expect(formatInr("31000.00")).toBe("INR 31,000.00");
  });
  it("month label", () => {
    expect(monthLabel("2026-08")).toBe("August 2026");
    expect(monthLabel("2026-01")).toBe("January 2026");
  });
});

describe("renderSalarySlipPdf — valid PDF containing the exact payroll snapshot", () => {
  const pdf = text(BASE);

  it("is a well-formed single-page PDF", () => {
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("/Type /Page");
    expect(pdf).toContain("xref");
    expect(pdf).toContain("trailer");
  });

  it("shows the Officeverse heading and Salary Slip title", () => {
    expect(pdf).toContain("OFFICEVERSE");
    expect(pdf).toContain("Salary Slip");
  });

  it("contains the exact snapshot values ₹30,000 + ₹1,000 = ₹31,000", () => {
    expect(pdf).toContain("Jane Doe");
    expect(pdf).toContain("30,000.00");
    expect(pdf).toContain("1,000.00");
    expect(pdf).toContain("31,000.00");
    expect(pdf).toContain("August 2026");
    expect(pdf).toContain("LOCKED");
    expect(pdf).toContain("Calculation Version");
    expect(pdf).toContain("v1");
    expect(pdf).toContain("User ID");
    expect(pdf).toContain("42");
  });

  it("contains NO incentive / commission / sales / tax / statutory wording", () => {
    for (const bad of [
      /incentive/i,
      /commission/i,
      /\bsales\b/i,
      /\btax\b/i,
      /\bPF\b/,
      /ESI/,
      /TDS/,
    ]) {
      expect(pdf).not.toMatch(bad);
    }
  });

  it("marks a preview slip clearly and never as the final document", () => {
    const preview = text({ ...BASE, isPreview: true, payrollStatus: "CALCULATED" });
    expect(preview).toContain("PREVIEW");
  });

  it("is deterministic — identical input yields byte-identical output", () => {
    const a = renderSalarySlipPdf(BASE);
    const b = renderSalarySlipPdf(BASE);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it("sha256Hex is 64 lowercase hex chars and changes when a value changes", () => {
    const h1 = sha256Hex(renderSalarySlipPdf(BASE));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    const h2 = sha256Hex(renderSalarySlipPdf({ ...BASE, calculatedSalary: "35000.00" }));
    expect(h2).not.toBe(h1);
  });
});
