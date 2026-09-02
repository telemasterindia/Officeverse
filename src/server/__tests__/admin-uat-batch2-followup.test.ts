/**
 * Admin Owner UAT — Batch 2 FOLLOW-UP regression guard.
 *   §1 dynamic shift overrides · §2 joining date · §3 complete salary slip.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyAttendance,
  classifyLate,
  deriveLateRule,
  resolveShift,
} from "../attendance/classify";
import { buildSlipSnapshot, slipSnapshotEquals, type PayrollRunLike } from "../hr/salary-slip";
import { renderSalarySlipPdf, type SalarySlipPdfData } from "../hr/salary-slip-pdf";
import { assertCanManageShiftOverrides } from "../authz/shift-overrides";

const root = join(__dirname, "..", "..");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/* ------------------------- §1 — shift overrides ------------------------- */

describe("§1 — effective shift resolution (pure)", () => {
  it("no override → the frozen defaults are unchanged", () => {
    const us = resolveShift("US");
    expect(us.start).toBe("21:00");
    expect(us.rule).toEqual({
      reportingHHMM: "20:50",
      shortLateFromHHMM: "20:51",
      lateFromHHMM: "21:31",
    });
    const inr = resolveShift("IN");
    expect(inr.rule).toEqual({
      reportingHHMM: "09:30",
      shortLateFromHHMM: "09:31",
      lateFromHHMM: "10:01",
    });
  });

  it("deriveLateRule reproduces the frozen constants from the start time", () => {
    expect(deriveLateRule("US", "21:00")).toEqual({
      reportingHHMM: "20:50",
      shortLateFromHHMM: "20:51",
      lateFromHHMM: "21:31",
    });
    expect(deriveLateRule("IN", "09:30")).toEqual({
      reportingHHMM: "09:30",
      shortLateFromHHMM: "09:31",
      lateFromHHMM: "10:01",
    });
  });

  it("a Saturday early-shift override moves the whole window + late boundaries", () => {
    const eff = resolveShift("IN", { startHHMM: "07:00", endHHMM: "13:00" });
    expect(eff.overridden).toBe(true);
    expect(eff.start).toBe("07:00");
    expect(eff.end).toBe("13:00");
    expect(eff.overnight).toBe(false);
    expect(eff.rule).toEqual({
      reportingHHMM: "07:00",
      shortLateFromHHMM: "07:01",
      lateFromHHMM: "07:31",
    });
  });

  it("explicit boundary fields on the override win over derivation", () => {
    const eff = resolveShift("US", {
      startHHMM: "18:00",
      endHHMM: "02:00",
      reportingHHMM: "18:15",
      lateFromHHMM: "19:00",
    });
    expect(eff.overnight).toBe(true);
    expect(eff.rule?.reportingHHMM).toBe("18:15");
    expect(eff.rule?.shortLateFromHHMM).toBe("18:16"); // derived from reporting
    expect(eff.rule?.lateFromHHMM).toBe("19:00");
  });
});

describe("§1 — classification uses the override for that date", () => {
  const D = "2026-08-29"; // a Saturday
  it("India 09:40 is LATE by default but ON-TIME under an 07:00–13:00 shift set to 10:00 start", () => {
    // default: 09:40 → SHORT_LATE (09:31..10:00)
    expect(classifyLate("IN", D, `${D} 09:40:00`)).toBe("SHORT_LATE");
    // override starting 10:00 → 09:40 is early → NORMAL
    const ov = { startHHMM: "10:00", endHHMM: "19:00" };
    expect(classifyLate("IN", D, `${D} 09:40:00`, ov)).toBe("NORMAL");
    const c = classifyAttendance({
      process: "IN",
      operationalDate: D,
      firstCheckInAt: `${D} 09:40:00`,
      shiftOverride: ov,
    });
    expect(c.shiftStartAt).toBe(`${D} 10:00:00`);
    expect(c.checkInStatus).toBe("ON_TIME");
  });
});

describe("§1 — placement / access", () => {
  it("shift overrides are Admin-only (HR / Closer / Agent rejected)", () => {
    expect(() => assertCanManageShiftOverrides("admin")).not.toThrow();
    for (const r of ["hr", "closer", "agent"]) {
      expect(() => assertCanManageShiftOverrides(r)).toThrow();
    }
  });
  it("the shift-timing route is Admin-gated", () => {
    expect(read("routes/_shell.shifts.tsx")).toMatch(/RoleGate allow=\{\["admin"\]\}/);
  });
  it("touchAttendance only ever recomputes the CURRENT operational date", () => {
    const svc = read("server/attendance/service.ts");
    const fn = svc.slice(
      svc.indexOf("export async function touchAttendance"),
      svc.indexOf("export async function deriveAttendanceForDate"),
    );
    expect(fn).toMatch(/shiftDateIST\(nowMs, process\)/);
    expect(stripComments(fn)).not.toMatch(/operationalDate\s*=\s*input|for \(/);
  });
  it("deriveAttendanceForDate still skips a corrected row", () => {
    const svc = read("server/attendance/service.ts");
    expect(svc).toMatch(/existing\?\.source === "corrected"/);
    expect(svc).toMatch(/getShiftOverride\(process, operationalDate/);
  });
});

/* ------------------------- §2 — joining date ------------------------- */

describe("§2 — joining date is authoritative + drives the salary profile", () => {
  const staffSvc = read("server/staff/service.ts");
  it("createStaff uses the joining date as the salary-profile effective-from", () => {
    expect(staffSvc).toMatch(/effectiveFrom:\s*joiningDate \?\? registeredOn/);
  });
  it("the joining date is persisted on the agents row + surfaced on the DTO", () => {
    expect(read("server/db/repos/staff.ts")).toMatch(/joiningDate: input\.joiningDate \?\? null/);
    expect(staffSvc).toMatch(/joining_date: r\.joiningDate/);
  });
  it("the create-agent form + profile editor show a joining date", () => {
    expect(read("routes/_shell.agents.new.tsx")).toMatch(/name="joining_date"/);
    // the employee directory row shows PHOTO | NAME | EMPLOYEE ID | ROLE |
    // PROCESS | STATUS | ACTION (Admin UAT — HR staff view); the joining date
    // lives in the Admin/HR profile editor opened from the Action column.
    expect(read("routes/_shell.employees.tsx")).toMatch(/StaffEditDialog/);
    expect(read("components/officeverse/staff-edit-dialog.tsx")).toMatch(/Joining date/);
  });
});

/* ------------------------- §3 — salary slip ------------------------- */

const RUN: PayrollRunLike = {
  process: "US",
  status: "LOCKED",
  baseSalary: "31000.00",
  monthlyBaseSalary: "31000.00",
  payableBaseSalary: "31000.00",
  regularityBonus: 0,
  calculatedSalary: "30000.00",
  leaveCount: 0,
  offCount: 0,
  unpaidLeaveDays: 0,
  lateShortCount: 0,
  lateFullCount: 2,
  lateUnits: "3.0",
  lateDeduction: "1000.00",
  calculationVersion: "v2",
};

const BRANDING = {
  companyName: "TeleMaster India",
  legalName: "TeleMaster India Pvt. Ltd.",
  address: "Mohali",
  taxId: "GST-1",
  footer: "system generated",
  logoMime: null,
  logoDataBase64: null,
};

describe("§3 — the slip snapshot freezes the full breakdown", () => {
  it("buildSlipSnapshot carries late units / deduction / joining date / branding", () => {
    const s = buildSlipSnapshot(RUN, {
      employeeCode: "TMI_CC001",
      joiningDate: "2026-07-15",
      branding: BRANDING,
    });
    expect(s.lateUnits).toBe("3.0");
    expect(s.lateDeduction).toBe("1000.00");
    expect(s.calculatedSalary).toBe("30000.00");
    expect(s.employeeCode).toBe("TMI_CC001");
    expect(s.joiningDate).toBe("2026-07-15");
    expect(s.branding.companyName).toBe("TeleMaster India");
  });

  it("slipSnapshotEquals reacts to a change in the late figures", () => {
    const a = buildSlipSnapshot(RUN);
    const b = buildSlipSnapshot({ ...RUN, lateUnits: "1.0", lateDeduction: "0.00" });
    expect(slipSnapshotEquals(a, a)).toBe(true);
    expect(slipSnapshotEquals(a, b)).toBe(false);
  });
});

describe("§3 — the PDF renders the required lines from the central branding", () => {
  const data: SalarySlipPdfData = {
    companyName: BRANDING.companyName,
    companyLegalName: BRANDING.legalName,
    companyAddress: BRANDING.address,
    companyTaxId: BRANDING.taxId,
    companyFooter: BRANDING.footer,
    logo: null,
    employeeName: "Jane Doe",
    employeeCode: "TMI_CC001",
    userId: 7,
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
  const pdf = new TextDecoder("latin1").decode(renderSalarySlipPdf(data));

  it("has company header, employee ID, joining date, late breakdown and net salary", () => {
    expect(pdf).toContain("TeleMaster India");
    expect(pdf).toContain("TMI_CC001");
    expect(pdf).toContain("2026-07-15");
    expect(pdf).toContain("Short Late Count");
    expect(pdf).toContain("Late Count");
    expect(pdf).toContain("Late Units");
    expect(pdf).toContain("Late Deduction");
    expect(pdf).toContain("Regularity Bonus");
    expect(pdf).toContain("Net Salary");
    expect(pdf).toContain("30,000.00");
  });

  it("the slip service snapshots the ONE central branding source (no separate logo config)", () => {
    const svc = read("server/hr/salary-slip-service.ts");
    expect(svc).toMatch(/from "\.\.\/branding\/service"/);
    expect(svc).toMatch(/getCompanyBranding\(\)/);
    expect(svc).toMatch(/getCompanyLogo\(\)/);
  });
});

describe("§3 — migration 0017 is additive-only", () => {
  const sql = read("../drizzle/0017_shift_overrides_joining_date_slip_snapshot.sql");
  it("only CREATE TABLE + ADD COLUMN (no destructive statement)", () => {
    expect(sql).toMatch(/CREATE TABLE `shift_overrides`/);
    expect(sql).toMatch(/ALTER TABLE `agents` ADD `joining_date`/);
    expect(sql).toMatch(/ALTER TABLE `salary_slips` ADD `late_units`/);
    expect(sql).toMatch(/ALTER TABLE `salary_slips` ADD `company_logo_data`/);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|DATABASE|INDEX)/i);
    expect(sql).not.toMatch(/DELETE\s+FROM|\bTRUNCATE\b/i);
  });
});
