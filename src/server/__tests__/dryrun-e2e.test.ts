/**
 * Phase 18 — LOCAL PRODUCTION DRY RUN, end-to-end.
 *
 * Wires the authoritative server-side PURE engines for one deterministic
 * DRYRUN employee through the whole chain:
 *   attendance → Late/Short → Off conversion → leave + sandwich + holiday →
 *   Regularity Bonus → payroll lifecycle + breakdown → salary-slip snapshot +
 *   PDF + integrity → storage round-trip → email payload (devlog, NOT SENT) →
 *   monthly-delivery eligibility → health check.
 *
 * No DB, no network, no GoDaddy. Every business rule is the existing frozen one.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { planOffRecords } from "../hr/off-conversion";
import { buildHolidayMap } from "../hr/holiday-map";
import { holidayAwareProvider } from "../hr/non-working";
import { planLeaveDays } from "../hr/sandwich";
import { computeRegularityBonus } from "../hr/regularity";
import {
  assertPayrollTransition,
  calculateMonthlyPayroll,
  pickEffectiveProfile,
  PAYROLL_CALC_VERSION_V2,
} from "../hr/payroll";
import {
  buildSlipSnapshot,
  salarySlipEligibility,
  sanitizeSlipFilename,
  slipSnapshotEquals,
} from "../hr/salary-slip";
import { renderSalarySlipPdf, sha256Hex } from "../hr/salary-slip-pdf";
import { buildSalarySlipEmail } from "../hr/salary-slip-email";
import { deliveryDisposition } from "../hr/salary-slip-batch";
import {
  __resetSalarySlipStore,
  getSalarySlipStore,
  salarySlipStorageKey,
} from "../hr/salary-slip-storage";
import { devLogEmailProvider, getDevEmailOutbox, resetDevEmailOutbox } from "../email/provider";
import { collectHealth } from "../health";

const MONTH = "2026-08";
const DRYRUN_USER_ID = 99001;
const DRYRUN_NAME = "DRYRUN Test Employee";

let docRoot: string;
beforeEach(async () => {
  docRoot = await mkdtemp(join(tmpdir(), "ov-dryrun-"));
  process.env["DOCUMENT_STORAGE_PROVIDER"] = "filesystem";
  process.env["OFFICEVERSE_DOCUMENT_ROOT"] = docRoot;
  __resetSalarySlipStore();
  resetDevEmailOutbox();
});
afterEach(async () => {
  delete process.env["DOCUMENT_STORAGE_PROVIDER"];
  delete process.env["OFFICEVERSE_DOCUMENT_ROOT"];
  __resetSalarySlipStore();
  resetDevEmailOutbox();
  await rm(docRoot, { recursive: true, force: true });
});

describe("Phase 18 dry run — one deterministic DRYRUN employee, full chain", () => {
  it("attendance: 2 LATE = 1 Off and 3 SHORT = 1 Off (frozen conversions)", () => {
    const plan = planOffRecords({ periodMonth: MONTH, lateCount: 2, shortCount: 3 });
    expect(plan.lateOffCount).toBe(1);
    expect(plan.shortOffCount).toBe(1);
    // 1 Late + 2 Short must NOT roll into an Off (counters stay separate)
    const partial = planOffRecords({ periodMonth: MONTH, lateCount: 1, shortCount: 2 });
    expect(partial.lateOffCount + partial.shortOffCount).toBe(0);
  });

  it("leave + weekend sandwich + company holiday expand through the ONE engine", () => {
    // 2026-08-14 Fri leave; 15 Sat, 16 Sun weekend; 17 Mon is a COMPANY holiday;
    // 18 Tue leave → the whole connected block counts.
    const holidayMap = buildHolidayMap(
      [
        {
          holidayDate: "2026-08-17",
          observedDate: null,
          holidayType: "COMPANY",
          appliesToProcess: null,
          active: true,
        },
      ],
      "US",
    );
    const plan = planLeaveDays(
      [
        { id: 1, startDate: "2026-08-14", endDate: "2026-08-14" },
        { id: 2, startDate: "2026-08-18", endDate: "2026-08-18" },
      ],
      holidayAwareProvider(holidayMap),
    );
    // 14,15,16,17,18 all count
    expect(plan.allLeaveDates).toEqual([
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
    ]);
  });

  it("Regularity Bonus: any Leave OR Off → ₹0; clean month → ₹1,000", () => {
    const withLeaveAndOff = computeRegularityBonus({
      periodMonth: MONTH,
      approvedLeaveDaysInMonth: 5,
      effectiveOffCountInMonth: 2,
    });
    expect(withLeaveAndOff.bonusAmount).toBe(0);
    expect(withLeaveAndOff.eligible).toBe(false);

    const clean = computeRegularityBonus({
      periodMonth: MONTH,
      approvedLeaveDaysInMonth: 0,
      effectiveOffCountInMonth: 0,
    });
    expect(clean.bonusAmount).toBe(1000);
  });

  it("payroll: DRAFT→CALCULATED→APPROVED→LOCKED; gross = payable base + bonus (+ HR adjustment)", () => {
    // effective-dated base salary
    const profile = pickEffectiveProfile(
      [
        {
          id: 1,
          baseSalary: "30000.00",
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          active: true,
        },
      ],
      MONTH,
    );
    expect(profile?.baseSalary).toBe("30000.00");

    // clean month → bonus 1000; one HR-typed adjustment of −250.50
    const calc = calculateMonthlyPayroll({
      month: MONTH,
      monthlyBaseSalary: Number(profile!.baseSalary),
      regularityBonus: 1000,
      adjustmentsTotal: -250.5,
      // undefined rates stay ₹0 — nothing invented
      unpaidLeaveDeduction: 0,
      offDeduction: 0,
      overtimeAmount: 0,
    });
    expect(calc.payableBaseSalary).toBe("30000.00"); // no proration basis configured
    expect(calc.prorationApplied).toBe(false);
    expect(calc.overtimeAmount).toBe("0.00");
    expect(calc.unpaidLeaveDeduction).toBe("0.00");
    expect(calc.offDeduction).toBe("0.00");
    expect(calc.calculatedSalary).toBe("30749.50"); // 30000 + 1000 - 250.50
    expect(calc.calculationVersion).toBe(PAYROLL_CALC_VERSION_V2);

    // lifecycle
    expect(() => assertPayrollTransition("DRAFT", "calculate")).not.toThrow();
    expect(() => assertPayrollTransition("CALCULATED", "approve")).not.toThrow();
    expect(() => assertPayrollTransition("APPROVED", "lock")).not.toThrow();
    expect(() => assertPayrollTransition("DRAFT", "approve")).toThrow();
    expect(() => assertPayrollTransition("LOCKED", "calculate")).toThrow();
  });

  it("salary slip: LOCKED only for a final slip; snapshot + PDF + integrity + storage", async () => {
    const run = {
      process: "US",
      status: "LOCKED",
      baseSalary: "30000.00",
      regularityBonus: 1000,
      calculatedSalary: "31000.00",
      leaveCount: 0,
      offCount: 0,
      calculationVersion: PAYROLL_CALC_VERSION_V2,
    };
    expect(salarySlipEligibility("DRAFT").ok).toBe(false);
    expect(salarySlipEligibility("CALCULATED").ok).toBe(false);
    expect(salarySlipEligibility("APPROVED").ok).toBe(true);
    const elig = salarySlipEligibility("LOCKED");
    expect(elig.ok).toBe(true);
    expect(elig.isPreview).toBe(false);

    const snap = buildSlipSnapshot(run);
    const fileName = sanitizeSlipFilename(MONTH, DRYRUN_NAME, DRYRUN_USER_ID);
    expect(fileName).toBe("Officeverse_Salary_Slip_2026-08_DRYRUN_Test_Employee.pdf");

    const slipPdfInput = {
      companyName: "TMI Officeverse",
      companyLegalName: null,
      companyAddress: null,
      companyTaxId: null,
      companyFooter: null,
      logo: null,
      employeeName: DRYRUN_NAME,
      employeeCode: "TMI_CC001",
      userId: DRYRUN_USER_ID,
      joiningDate: "2026-07-01",
      process: run.process,
      periodMonth: MONTH,
      baseSalary: snap.baseSalary,
      payableBaseSalary: snap.payableBaseSalary,
      regularityBonus: snap.regularityBonus,
      calculatedSalary: snap.calculatedSalary,
      leaveCount: snap.leaveCount,
      offCount: snap.offCount,
      unpaidLeaveDays: snap.unpaidLeaveDays,
      lateShortCount: snap.lateShortCount,
      lateFullCount: snap.lateFullCount,
      lateUnits: snap.lateUnits,
      lateDeduction: snap.lateDeduction,
      payrollStatus: "LOCKED",
      calculationVersion: snap.calculationVersion,
      slipVersion: 1,
      isPreview: false,
      generatedAt: "2026-09-01 10:00:00",
    };
    const pdf = renderSalarySlipPdf(slipPdfInput);
    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("30,000.00");
    expect(text).toContain("31,000.00");
    expect(text).toContain("DRYRUN Test Employee");
    // NO Closer incentive / commission / sales anywhere in the document
    for (const bad of [/incentive/i, /commission/i, /\bsales\b/i]) expect(text).not.toMatch(bad);

    const sha = sha256Hex(pdf);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);

    // storage round-trip + immutability + regeneration
    const store = getSalarySlipStore();
    expect(store.kind).toBe("filesystem");
    const key = salarySlipStorageKey(DRYRUN_USER_ID, MONTH, 1);
    await store.put(key, pdf);
    const got = await store.get(key);
    expect(got && sha256Hex(got) === sha).toBe(true);
    // re-render from the same snapshot → byte-identical (immutable content)
    const pdf2 = renderSalarySlipPdf(slipPdfInput);
    expect(sha256Hex(pdf2)).toBe(sha);
    expect(slipSnapshotEquals(snap, buildSlipSnapshot(run))).toBe(true);
  });

  it("email: payload built, recipient/attachment resolved, DELIVERED VIA DEVLOG — NOT SENT to Resend", async () => {
    const email = buildSalarySlipEmail({
      employeeName: DRYRUN_NAME,
      periodMonth: MONTH,
      isPreview: false,
      fileName: "Officeverse_Salary_Slip_2026-08_DRYRUN_Test_Employee.pdf",
    });
    expect(email.subject).toBe("Officeverse Salary Slip - August 2026");
    expect(email.text).toContain("DRYRUN Test Employee");
    // no salary figures in the body; the PDF is authoritative
    expect(email.text).not.toMatch(/\d{2,}[.,]\d{2}/);
    for (const bad of [/incentive/i, /commission/i, /\bsales\b/i, /\btax\b/i]) {
      expect(email.text).not.toMatch(bad);
    }

    // the dev-safe provider "delivers" to an in-process log — no network call
    const res = await devLogEmailProvider.send({
      to: "dryrun-employee@dryrun.local",
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments: [
        { filename: "slip.pdf", contentBase64: "QUJD", contentType: "application/pdf" },
      ],
    });
    expect(res.providerMessageId).toMatch(/^devlog-/);
    const box = getDevEmailOutbox();
    expect(box).toHaveLength(1);
    expect(box[0]!.to).toBe("dryrun-employee@dryrun.local");
    expect(box[0]!.attachmentNames).toEqual(["slip.pdf"]);
    // provider name proves nothing real was sent
    expect(devLogEmailProvider.name).toBe("devlog");
  });

  it("monthly delivery: LOCKED-only; first pass generates+sends, second pass is ALREADY_SENT (no duplicate)", () => {
    const lockedRun = {
      process: "US",
      status: "LOCKED",
      baseSalary: "30000.00",
      regularityBonus: 1000,
      calculatedSalary: "31000.00",
      leaveCount: 0,
      offCount: 0,
      calculationVersion: PAYROLL_CALC_VERSION_V2,
    };
    // no slip yet → generate + send
    expect(deliveryDisposition(null, lockedRun, true)).toBe("GENERATE_AND_SEND");
    // slip already SENT with the same figures → not re-sent
    const sentSlip = {
      process: "US",
      baseSalary: "30000.00",
      regularityBonus: 1000,
      calculatedSalary: "31000.00",
      leaveCount: 0,
      offCount: 0,
      calculationVersion: PAYROLL_CALC_VERSION_V2,
      payrollStatusAtGeneration: "LOCKED",
      isPreview: false,
      status: "SENT",
    };
    expect(deliveryDisposition(sentSlip, lockedRun, true)).toBe("ALREADY_SENT");
    // no email address → generate the doc, do not send
    expect(deliveryDisposition(null, lockedRun, false)).toBe("GENERATE_NO_EMAIL");
  });

  it("health check: status only, no secret VALUE, DB-unavailable is a clean report (not a throw)", async () => {
    process.env["OFFICEVERSE_EMAIL_PROVIDER"] = "devlog";
    process.env["RESEND_API_KEY"] = "re_DRYRUN_SECRET_should_not_appear";
    process.env["OFFICEVERSE_CRON_SECRET"] = "DRYRUN_CRON_should_not_appear";
    const report = await collectHealth();
    expect(report.database.configured).toBe(false); // no DB in the dry run
    expect(report.storage).toEqual({ provider: "filesystem", rootConfigured: true, durable: true });
    expect(report.email).toEqual({ configured: true, provider: "devlog", reason: null });
    expect(report.migrations.localCount).toBeGreaterThanOrEqual(11);
    expect(report.automation.cronSecretConfigured).toBe(true);
    const blob = JSON.stringify(report);
    expect(blob).not.toContain("re_DRYRUN_SECRET_should_not_appear");
    expect(blob).not.toContain("DRYRUN_CRON_should_not_appear");
    expect(blob).not.toMatch(/mysql:\/\/|Bearer\s/);
    delete process.env["OFFICEVERSE_EMAIL_PROVIDER"];
    delete process.env["RESEND_API_KEY"];
    delete process.env["OFFICEVERSE_CRON_SECRET"];
  });
});
