/**
 * Phase 6.5 — Operations Control authorization.
 *
 *   Admin  + Closer (Operations Manager)  → Operations Control.
 *   Agent  + HR                           → denied (proper 403).
 *
 * HR keeps its PRE-6.5 scoring-rule-service access (`canManageScoringRules`),
 * but the scoring UI boundary is admin+closer only, so HR gains nothing new.
 */
import { describe, expect, it } from "vitest";
import {
  OPERATIONS_AUDIT_ACTIONS,
  assertCanManageScoringRules,
  assertCanRunOperations,
  canManageScoringRules,
  canRunOperations,
  isOperationsAuditAction,
} from "../authz/operations";
import { HttpError } from "../http-error";

describe("canRunOperations — Admin + Closer only", () => {
  it("admin and closer may run operations", () => {
    expect(canRunOperations("admin")).toBe(true);
    expect(canRunOperations("closer")).toBe(true);
  });
  it("agent and hr may not", () => {
    expect(canRunOperations("agent")).toBe(false);
    expect(canRunOperations("hr")).toBe(false);
    expect(canRunOperations("system")).toBe(false);
    expect(canRunOperations("")).toBe(false);
  });
  it("assertCanRunOperations throws HttpError(403) for a denied role", () => {
    expect(() => assertCanRunOperations("admin")).not.toThrow();
    expect(() => assertCanRunOperations("closer")).not.toThrow();
    for (const role of ["agent", "hr", "system", "nonsense"]) {
      let err: unknown;
      try {
        assertCanRunOperations(role);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(403);
      expect((err as HttpError).code).toBe("forbidden");
    }
  });
});

describe("canManageScoringRules — admin + closer + hr (hr retained from pre-6.5)", () => {
  it("admin, closer, hr may manage scoring RULE DEFINITIONS", () => {
    expect(canManageScoringRules("admin")).toBe(true);
    expect(canManageScoringRules("closer")).toBe(true);
    expect(canManageScoringRules("hr")).toBe(true); // unchanged from assertCanManageGamification
  });
  it("agent may not", () => {
    expect(canManageScoringRules("agent")).toBe(false);
    expect(() => assertCanManageScoringRules("agent")).toThrow(HttpError);
  });
});

describe("OPERATIONS_AUDIT_ACTIONS — the read whitelist", () => {
  it("covers every Phase-6.5 operational mutation family", () => {
    for (const a of [
      "scoring.rule_create",
      "scoring.rule_update",
      "scoring.rule_enable",
      "scoring.rule_disable",
      "office_tv.announcement_schedule",
      "office_tv.announcement_publish",
      "office_tv.announcement_stop",
      "POWER_HOUR_CREATED",
      "POWER_HOUR_STARTED",
      "POWER_HOUR_STOPPED",
      "CELEBRATION_TEST_TRIGGERED",
      "CELEBRATION_AUDIO_TEST_TRIGGERED",
    ]) {
      expect(OPERATIONS_AUDIT_ACTIONS).toContain(a);
      expect(isOperationsAuditAction(a)).toBe(true);
    }
  });
  it("rejects unrelated / HR / payroll audit actions", () => {
    for (const a of [
      "auth.login",
      "password.change",
      "hr.salary_update",
      "payroll.run",
      "user.create",
    ]) {
      expect(isOperationsAuditAction(a)).toBe(false);
    }
  });
});
