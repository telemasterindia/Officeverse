/**
 * Admin Owner UAT — Batch 2 regression guard.
 *
 * Covers §2 (official photo lock + creation upload), §3 (agent base salary →
 * payroll), §4/§5 (Late-Units → 1-day cut + bonus void, Late/Short→Off
 * conversion disabled), §6/§11 (payroll + branding access), §7 (company
 * branding), §12 (additive migration 0016).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateMonthlyPayroll } from "../hr/payroll";
import { computeRegularityBonus } from "../hr/regularity";
import { computeLateDeduction, computeLateUnits } from "../hr/late-units";

const root = join(__dirname, "..", "..");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/* ------------------------- §5 — Late-Units rule ------------------------- */

describe("§5 — Late Units fold into the regularity bonus", () => {
  it("≥ 3 Late Units voids the ₹1,000 bonus on their own", () => {
    const r = computeRegularityBonus({
      periodMonth: "2026-08",
      approvedLeaveDaysInMonth: 0,
      effectiveOffCountInMonth: 0,
      lateUnitsThresholdReached: true,
    });
    expect(r.eligible).toBe(false);
    expect(r.bonusAmount).toBe(0);
    expect(r.disqualifyingReasons).toContain("LATE_UNITS_THRESHOLD");
  });

  it("< 3 Late Units + no leave/Off still earns ₹1,000", () => {
    const units = computeLateUnits({ shortLateCount: 2, lateCount: 0 }); // 2.0
    const r = computeRegularityBonus({
      periodMonth: "2026-08",
      approvedLeaveDaysInMonth: 0,
      effectiveOffCountInMonth: 0,
      lateUnitsThresholdReached: units.thresholdReached,
    });
    expect(r.bonusAmount).toBe(1000);
  });

  it("omitting the flag is byte-identical to the pre-Batch-2 result", () => {
    const withoutFlag = computeRegularityBonus({
      periodMonth: "2026-08",
      approvedLeaveDaysInMonth: 0,
      effectiveOffCountInMonth: 0,
    });
    expect(withoutFlag).toEqual(
      computeRegularityBonus({
        periodMonth: "2026-08",
        approvedLeaveDaysInMonth: 0,
        effectiveOffCountInMonth: 0,
        lateUnitsThresholdReached: false,
      }),
    );
  });
});

describe("§5 — Late-Units 1-day salary cut in the payroll engine", () => {
  it("lateDeduction reduces gross; the counts are snapshotted", () => {
    const late = computeLateDeduction({
      monthlyBaseSalary: 31_000,
      month: "2026-08",
      shortLateCount: 0,
      lateCount: 2, // 3.0 units → cut
    });
    const r = calculateMonthlyPayroll({
      month: "2026-08",
      monthlyBaseSalary: 31_000,
      regularityBonus: 0, // voided by the same threshold upstream
      lateShortCount: late.shortLateCount,
      lateFullCount: late.lateCount,
      lateUnits: late.lateUnits,
      lateDeduction: late.lateDeductionAmount,
    });
    expect(r.lateUnits).toBe(3);
    expect(r.lateDeduction).toBe("1000.00");
    expect(r.calculatedSalary).toBe("30000.00"); // 31000 − 1000
  });

  it("no lateDeduction → the Phase-13/16 figure is unchanged", () => {
    const base = calculateMonthlyPayroll({
      month: "2026-08",
      monthlyBaseSalary: 31_000,
      regularityBonus: 1_000,
    });
    expect(base.calculatedSalary).toBe("32000.00");
    expect(base.lateDeduction).toBe("0.00");
    expect(base.lateUnits).toBe(0);
  });

  it("Feb is divided by 28 — one day of ₹56,000 is ₹2,000", () => {
    const late = computeLateDeduction({
      monthlyBaseSalary: 56_000,
      month: "2026-02",
      shortLateCount: 2,
      lateCount: 1, // 3.5 units → cut
    });
    expect(late.perDaySalary).toBe(2000);
    expect(late.lateDeductionAmount).toBe(2000);
  });
});

/* --------------------- placement / wiring guards --------------------- */

describe("§5 — Late/Short → Off conversion is disabled for pay", () => {
  const svc = read("server/hr/service.ts");
  it("hr/service exports the OFF-conversion switch, set to false", () => {
    expect(svc).toMatch(/LATE_TO_OFF_CONVERSION_ENABLED\s*=\s*false/);
  });
  it("recomputeOff clears converted rows instead of creating them", () => {
    const fn = svc.slice(
      svc.indexOf("export async function recomputeOff"),
      svc.indexOf("export async function recomputeBonus"),
    );
    expect(fn).toMatch(/if \(!LATE_TO_OFF_CONVERSION_ENABLED\)/);
    expect(fn).toMatch(/upsertOffRecords\(userId, month, \[\]/);
  });
  it("recomputeBonus feeds the Late-Units threshold into the bonus", () => {
    expect(svc).toMatch(/countCheckInLatenessInMonth/);
    expect(svc).toMatch(/lateUnitsThresholdReached: lateUnits\.thresholdReached/);
  });
});

describe("§3 — agent base salary is written to payroll at creation", () => {
  const staffSvc = read("server/staff/service.ts");
  it("createStaff routes base_salary through setSalaryProfile (agents only)", () => {
    expect(staffSvc).toMatch(/setSalaryProfile\(/);
    expect(stripComments(staffSvc)).toMatch(/applies to agents only/i);
    expect(staffSvc).not.toMatch(/monthlySalary|monthly_salary/);
  });
  it("the create-agent route collects a base salary; the create-closer route does not", () => {
    expect(read("routes/_shell.agents.new.tsx")).toMatch(/name="base_salary"/);
    expect(read("routes/_shell.closers.new.tsx")).not.toMatch(/base_salary|salary/i);
  });
});

describe("§2 — official photo: HR/Admin only, settable at creation", () => {
  it("the photo service rejects a non-manager writer", () => {
    const ps = read("server/hr/photo-service.ts");
    expect(ps).toMatch(/if \(!isPhotoManager\(actor\.role\)\)/);
  });
  it("createStaff can attach an official photo (re-validated in the service)", () => {
    const s = read("server/staff/service.ts");
    expect(s).toMatch(/setProfilePhoto\(actor, \{ targetUserId: row\.userId, bytes: photoBytes \}/);
    expect(s).toMatch(/validatePhotoUpload\(photoBytes/);
  });
  it("both creation routes expose a photo file input", () => {
    for (const f of ["routes/_shell.agents.new.tsx", "routes/_shell.closers.new.tsx"]) {
      const src = read(f);
      expect(src).toMatch(/name="photo"/);
      expect(src).toMatch(/type="file"/);
    }
  });
});

describe("§6 / §11 — access control", () => {
  it("company branding WRITE requires an Admin (never HR, never the client role)", () => {
    const fns = read("lib/officeverse/company-fns.ts");
    expect(fns).toMatch(/updateCompanyBrandingFn[\s\S]*requireRole\("admin"\)/);
    expect(read("server/branding/service.ts")).toMatch(/actor\.role !== "admin"/);
  });
  it("the company branding route is Admin-gated", () => {
    expect(read("routes/_shell.company.tsx")).toMatch(/RoleGate allow=\{\["admin"\]\}/);
  });
  it("payroll management stays Admin/HR only", () => {
    const hr = read("server/authz/hr.ts");
    expect(hr).toMatch(/canManagePayroll\s*=\s*canManageLeave/);
    expect(hr).toMatch(/canManageLeave[\s\S]{0,120}"admin"[\s\S]{0,40}"hr"/);
  });
});

describe("§12 — migration 0016 is additive-only", () => {
  const sql = read("../drizzle/0016_payroll_late_units.sql");
  it("only ADDs columns to payroll_runs", () => {
    expect(sql).toMatch(/ADD `late_short_count`/);
    expect(sql).toMatch(/ADD `late_full_count`/);
    expect(sql).toMatch(/ADD `late_units`/);
    expect(sql).toMatch(/ADD `late_deduction`/);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|DATABASE|INDEX)/i);
    expect(sql).not.toMatch(/DELETE\s+FROM|\bTRUNCATE\b/i);
  });
});
