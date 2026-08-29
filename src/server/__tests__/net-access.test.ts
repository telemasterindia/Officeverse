import { describe, expect, it } from "vitest";
import { accessMessage, evaluateAccess } from "../net/access";

const P = { policyConfigured: true };

describe("evaluateAccess — role / IP matrix (Phase 23 §37)", () => {
  it("Agent + office IP → CRM allowed, attendance recorded", () => {
    expect(evaluateAccess({ role: "agent", officeMatch: true, ...P })).toEqual({
      crmAllowed: true,
      attendanceEligible: true,
      code: "office",
    });
  });

  it("Agent + remote IP → CRM DENIED, attendance NOT recorded", () => {
    expect(evaluateAccess({ role: "agent", officeMatch: false, ...P })).toEqual({
      crmAllowed: false,
      attendanceEligible: false,
      code: "agent_remote_denied",
    });
  });

  it("Closer + office IP → CRM allowed, attendance recorded", () => {
    expect(evaluateAccess({ role: "closer", officeMatch: true, ...P })).toEqual({
      crmAllowed: true,
      attendanceEligible: true,
      code: "office",
    });
  });

  it("Closer + remote IP → CRM ALLOWED, attendance NOT recorded", () => {
    expect(evaluateAccess({ role: "closer", officeMatch: false, ...P })).toEqual({
      crmAllowed: true,
      attendanceEligible: false,
      code: "closer_remote_no_attendance",
    });
  });

  it("HR / Admin → CRM allowed (existing authz), never auto-attendance-eligible here", () => {
    for (const role of ["hr", "admin"]) {
      const d = evaluateAccess({ role, officeMatch: true, ...P });
      expect(d.crmAllowed).toBe(true);
      expect(d.attendanceEligible).toBe(false);
    }
  });

  it("SAFETY: with NO office network configured, nobody is locked out and nothing is eligible", () => {
    expect(evaluateAccess({ role: "agent", officeMatch: false, policyConfigured: false })).toEqual({
      crmAllowed: true,
      attendanceEligible: false,
      code: "policy_unconfigured",
    });
    expect(
      evaluateAccess({ role: "closer", officeMatch: false, policyConfigured: false }).crmAllowed,
    ).toBe(true);
  });

  it("a denied agent message is generic — never reveals an office IP", () => {
    expect(accessMessage("agent_remote_denied")).toMatch(/authorized office network/i);
    expect(accessMessage("agent_remote_denied")).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});
