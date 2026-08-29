import { describe, expect, it } from "vitest";
import {
  buildSlipSnapshot,
  salarySlipEligibility,
  sanitizeSlipFilename,
  slipSnapshotEquals,
  slipStatusAfterSend,
  type PayrollRunLike,
} from "../hr/salary-slip";

describe("salarySlipEligibility — only APPROVED / LOCKED produce a final slip", () => {
  it("DRAFT → rejected", () => {
    const e = salarySlipEligibility("DRAFT");
    expect(e.ok).toBe(false);
    expect(e.isPreview).toBe(false);
  });

  it("CALCULATED → rejected for a final slip", () => {
    expect(salarySlipEligibility("CALCULATED").ok).toBe(false);
  });

  it("CALCULATED + allowPreview → allowed but marked preview", () => {
    const e = salarySlipEligibility("CALCULATED", { allowPreview: true });
    expect(e.ok).toBe(true);
    expect(e.isPreview).toBe(true);
  });

  it("APPROVED → final slip", () => {
    const e = salarySlipEligibility("APPROVED");
    expect(e.ok).toBe(true);
    expect(e.isPreview).toBe(false);
  });

  it("LOCKED → final slip", () => {
    const e = salarySlipEligibility("LOCKED");
    expect(e.ok).toBe(true);
    expect(e.isPreview).toBe(false);
  });
});

describe("sanitizeSlipFilename — deterministic and path-traversal-safe", () => {
  it("builds the standard name", () => {
    expect(sanitizeSlipFilename("2026-08", "Jane Doe", 42)).toBe(
      "Officeverse_Salary_Slip_2026-08_Jane_Doe.pdf",
    );
  });
  it("strips slashes, dots and traversal sequences", () => {
    const f = sanitizeSlipFilename("2026-08", "../../etc/passwd", 7);
    expect(f).not.toContain("/");
    expect(f).not.toContain("..");
    expect(f).toBe("Officeverse_Salary_Slip_2026-08_etc_passwd.pdf");
  });
  it("falls back to user<id> when the name has no usable characters", () => {
    expect(sanitizeSlipFilename("2026-08", "！！！", 9)).toBe(
      "Officeverse_Salary_Slip_2026-08_user9.pdf",
    );
  });
  it("marks a preview file", () => {
    expect(sanitizeSlipFilename("2026-08", "Jane", 1, true)).toBe(
      "Officeverse_Salary_Slip_2026-08_Jane_PREVIEW.pdf",
    );
  });
  it("rejects a malformed month", () => {
    expect(sanitizeSlipFilename("2026/08", "Jane", 1)).toContain("unknown-month");
  });
});

const run = (over: Partial<PayrollRunLike> = {}): PayrollRunLike => ({
  process: "US",
  status: "LOCKED",
  baseSalary: "30000.00",
  regularityBonus: 1000,
  calculatedSalary: "31000.00",
  leaveCount: 0,
  offCount: 0,
  calculationVersion: "v1",
  ...over,
});

describe("snapshot equality — controls whether a regenerate makes a new version", () => {
  it("same figures → equal (regenerate reuses the existing slip)", () => {
    expect(slipSnapshotEquals(buildSlipSnapshot(run()), buildSlipSnapshot(run()))).toBe(true);
  });
  it("a changed figure after reopen+recalc → not equal (new version required)", () => {
    const before = buildSlipSnapshot(run());
    const after = buildSlipSnapshot(run({ baseSalary: "35000.00", calculatedSalary: "36000.00" }));
    expect(slipSnapshotEquals(before, after)).toBe(false);
  });
  it("payroll status change (APPROVED → LOCKED) also forces a new version", () => {
    expect(
      slipSnapshotEquals(
        buildSlipSnapshot(run({ status: "APPROVED" })),
        buildSlipSnapshot(run({ status: "LOCKED" })),
      ),
    ).toBe(false);
  });
});

describe("slipStatusAfterSend", () => {
  it("success → SENT, failure → FAILED (document itself never regenerated)", () => {
    expect(slipStatusAfterSend(true)).toBe("SENT");
    expect(slipStatusAfterSend(false)).toBe("FAILED");
  });
});
