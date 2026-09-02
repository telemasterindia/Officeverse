import { describe, expect, it } from "vitest";
import {
  formatInr,
  monthLabel,
  renderSalarySlipPdf,
  sha256Hex,
  type SalarySlipPdfData,
} from "../hr/salary-slip-pdf";

const BASE: SalarySlipPdfData = {
  companyName: "TeleMaster India",
  companyLegalName: "TeleMaster India Pvt. Ltd.",
  companyAddress: "42 Example Road, Mohali",
  companyTaxId: "GST-DEMO-0001",
  companyFooter: "This is a system-generated document.",
  logo: null,
  employeeName: "Jane Doe",
  employeeCode: "TMI_CC001",
  userId: 42,
  joiningDate: "2026-07-15",
  process: "US",
  periodMonth: "2026-08",
  baseSalary: "31000.00",
  payableBaseSalary: "31000.00",
  regularityBonus: 0,
  leaveCount: 0,
  offCount: 0,
  unpaidLeaveDays: 0,
  lateShortCount: 0,
  lateFullCount: 2,
  lateUnits: "3.0",
  lateDeduction: "1000.00",
  calculatedSalary: "30000.00",
  payrollStatus: "LOCKED",
  calculationVersion: "v2",
  slipVersion: 1,
  isPreview: false,
  generatedAt: "2026-09-01 10:00:00",
};

// 1x1 PNG (RGBA) and 1x1 JPEG — enough to exercise the embed paths.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG_1x1 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

const text = (d: SalarySlipPdfData) => new TextDecoder("latin1").decode(renderSalarySlipPdf(d));

describe("formatInr / monthLabel", () => {
  it("formats rupees with thousands separators and 2 dp", () => {
    expect(formatInr("30000.00")).toBe("INR 30,000.00");
    expect(formatInr(1000)).toBe("INR 1,000.00");
  });
  it("month label", () => {
    expect(monthLabel("2026-08")).toBe("August 2026");
  });
});

describe("renderSalarySlipPdf — full breakdown snapshot (Batch-2 follow-up §3)", () => {
  const pdf = text(BASE);

  it("is a well-formed single-page PDF", () => {
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("/Type /Page");
    expect(pdf).toContain("xref");
    expect(pdf).toContain("trailer");
  });

  it("uses the central company name as the header (no hard-coded brand)", () => {
    expect(pdf).toContain("TeleMaster India");
    expect(pdf).toContain("TeleMaster India Pvt. Ltd.");
    expect(pdf).toContain("Salary Slip");
    expect(pdf).not.toContain("OFFICEVERSE");
  });

  it("shows the employee ID, joining date and payroll month", () => {
    expect(pdf).toContain("Jane Doe");
    expect(pdf).toContain("TMI_CC001");
    expect(pdf).toContain("2026-07-15");
    expect(pdf).toContain("August 2026");
  });

  it("shows the complete Late-Units breakdown and the net salary", () => {
    expect(pdf).toContain("Short Late Count");
    expect(pdf).toContain("Late Count");
    expect(pdf).toContain("Late Units");
    expect(pdf).toContain("3.0");
    expect(pdf).toContain("Late Deduction");
    expect(pdf).toContain("Regularity Bonus");
    expect(pdf).toContain("Net Salary");
    expect(pdf).toContain("31,000.00"); // monthly base
    expect(pdf).toContain("1,000.00"); // late deduction
    expect(pdf).toContain("30,000.00"); // net
  });

  it("carries NO incentive / commission / sales / tax-statutory wording", () => {
    for (const bad of [/incentive/i, /commission/i, /\bsales\b/i, /\bPF\b/, /ESI/, /TDS/]) {
      expect(pdf).not.toMatch(bad);
    }
  });

  it("marks a preview slip clearly", () => {
    expect(text({ ...BASE, isPreview: true, payrollStatus: "CALCULATED" })).toContain("PREVIEW");
  });

  it("embeds a PNG logo as an image XObject (DeviceRGB, uncompressed)", () => {
    const withPng = text({ ...BASE, logo: { mime: "image/png", dataBase64: PNG_1x1 } });
    expect(withPng).toContain("/Subtype /Image");
    expect(withPng).toContain("/ColorSpace /DeviceRGB");
    expect(withPng).toContain("/Im0 Do");
  });

  it("embeds a JPEG logo via /DCTDecode (bytes passed through)", () => {
    const withJpeg = text({ ...BASE, logo: { mime: "image/jpeg", dataBase64: JPEG_1x1 } });
    expect(withJpeg).toContain("/Subtype /Image");
    expect(withJpeg).toContain("/Filter /DCTDecode");
  });

  it("an SVG / unknown logo is skipped — the name header still renders", () => {
    const withSvg = text({
      ...BASE,
      logo: { mime: "image/svg+xml", dataBase64: Buffer.from("<svg/>").toString("base64") },
    });
    expect(withSvg).not.toContain("/Subtype /Image");
    expect(withSvg).toContain("TeleMaster India");
  });

  it("is deterministic — identical input yields byte-identical output (with a logo too)", () => {
    const a = renderSalarySlipPdf({ ...BASE, logo: { mime: "image/png", dataBase64: PNG_1x1 } });
    const b = renderSalarySlipPdf({ ...BASE, logo: { mime: "image/png", dataBase64: PNG_1x1 } });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it("sha256Hex is 64 lowercase hex and changes when a figure changes", () => {
    const h1 = sha256Hex(renderSalarySlipPdf(BASE));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(renderSalarySlipPdf({ ...BASE, calculatedSalary: "29000.00" }))).not.toBe(h1);
    expect(sha256Hex(renderSalarySlipPdf({ ...BASE, joiningDate: "2020-01-01" }))).not.toBe(h1);
  });
});
