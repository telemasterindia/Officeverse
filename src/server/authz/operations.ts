/**
 * Officeverse — OPERATIONS CONTROL authorization (Phase 6.5). PURE.
 *
 * A NEW capability layer for running team RECOGNITION / INCENTIVE / POWER HOUR /
 * ANNOUNCEMENT operations. It is granted to exactly two roles:
 *
 *   ADMIN                          — full platform administrator.
 *   CLOSER (= Operations Manager)  — in this business the Closer role IS the
 *                                    Operations Manager and runs team ops.
 *
 * It is deliberately NARROW. It does NOT grant, and must never be used for:
 *   HR administration · payroll · salary · employee create/delete ·
 *   authentication administration · unrestricted DB access · editing or
 *   deleting audit records · editing historical point transactions directly.
 * Those keep their existing, separate authorization modules unchanged.
 *
 * Server authorization is mandatory — never a hidden button / disabled control.
 */
import { HttpError } from "../http-error";

export type OpsRole = "admin" | "agent" | "closer" | "hr";

/** May this role operate the Celebration / Power Hour / Announcement surface? */
export function canRunOperations(role: string): boolean {
  return role === "admin" || role === "closer";
}

export function assertCanRunOperations(role: string): void {
  if (!canRunOperations(role)) {
    throw new HttpError(
      403,
      "Operations Control is limited to an Admin or the Operations Manager (Closer)",
      "forbidden",
    );
  }
}

/**
 * May this role manage SCORING / INCENTIVE rule DEFINITIONS through the
 * business UI? Admin + Closer (Operations Manager). HR is retained because the
 * pre-6.5 scoring rule service already authorised HR (`assertCanManageGamification`)
 * — Phase 6.5 widens, it does not remove an existing boundary.
 *
 * This governs RULE DEFINITIONS only. It never authorises editing a historical
 * `gamification_point_transactions` row or a computed award — those remain on
 * `authz/gamification` (Admin / HR).
 */
export function canManageScoringRules(role: string): boolean {
  return role === "admin" || role === "closer" || role === "hr";
}

export function assertCanManageScoringRules(role: string): void {
  if (!canManageScoringRules(role)) {
    throw new HttpError(403, "Not authorized to manage scoring / incentive rules", "forbidden");
  }
}

/**
 * Phase 9 — approving / finalizing / reversing an incentive RESULT (money-ish
 * entitlement, historical, immutable once finalized) is Admin-only. The Closer
 * (Operations Manager) may create schemes, dry-run and CALCULATE / REVIEW, but
 * never finalize or edit a finalized result — mirrors "Closer must not directly
 * pay money / edit historical finalized results".
 */
export function canFinalizeIncentive(role: string): boolean {
  return role === "admin";
}

export function assertCanFinalizeIncentive(role: string): void {
  if (!canFinalizeIncentive(role)) {
    throw new HttpError(
      403,
      "Approving / finalizing / reversing an incentive result is limited to an Admin",
      "forbidden",
    );
  }
}

/**
 * Phase 10 Stage 4 — creating / editing / enabling MILESTONE DEFINITIONS is
 * GOVERNANCE → Admin only. There is no existing product requirement granting the
 * Closer milestone configuration, so it is NOT broadened here. The Closer keeps
 * OPERATIONAL visibility (list + dry-run simulate) via `canRunOperations`.
 * Milestones fire automatically from authoritative events — there is no manual
 * "run" for anyone.
 */
export function canManageMilestones(role: string): boolean {
  return role === "admin";
}

export function assertCanManageMilestones(role: string): void {
  if (!canManageMilestones(role)) {
    throw new HttpError(
      403,
      "Configuring milestone definitions is limited to an Admin",
      "forbidden",
    );
  }
}

/**
 * The whitelist of `audit_logs.action` values the Operations Control audit view
 * is allowed to read. Read-only: this module never writes or deletes an audit
 * row. Every entry here is produced by an EXISTING `recordAudit` call in the
 * scoring / live services or by the Phase-6.5 ops services.
 */
export const OPERATIONS_AUDIT_ACTIONS = [
  // scoring / incentive rule definitions (scoring/service.ts — pre-existing)
  "scoring.rule_create",
  "scoring.rule_update",
  "scoring.rule_enable",
  "scoring.rule_disable",
  // team announcements (live/service.ts — pre-existing)
  "office_tv.announcement_schedule",
  "office_tv.announcement_publish",
  "office_tv.announcement_stop",
  // announcement command center (Phase 10 Stage 2)
  "ANNOUNCEMENT_CREATED",
  "ANNOUNCEMENT_UPDATED",
  "ANNOUNCEMENT_ENABLED",
  "ANNOUNCEMENT_DISABLED",
  "ANNOUNCEMENT_PLAYED",
  // power hour (Phase 6.5 · Phase 10 Stage 2)
  "POWER_HOUR_CREATED",
  "POWER_HOUR_STARTED",
  "POWER_HOUR_STOPPED",
  "POWER_HOUR_ANNOUNCEMENT_TRIGGERED",
  // milestone engine (Phase 10 Stage 4)
  "MILESTONE_CREATED",
  "MILESTONE_UPDATED",
  "MILESTONE_ENABLED",
  "MILESTONE_DISABLED",
  "MILESTONE_TRIGGERED",
  "MILESTONE_SIMULATED",
  // celebration operations (Phase 6.5 · Phase 7)
  "CELEBRATION_TEST_TRIGGERED",
  "CELEBRATION_AUDIO_TEST_TRIGGERED",
  // celebration profile builder (Phase 10 — Recognition Command Center)
  "CELEBRATION_PROFILE_CREATED",
  "CELEBRATION_PROFILE_UPDATED",
  "CELEBRATION_PROFILE_ENABLED",
  "CELEBRATION_PROFILE_DISABLED",
  "CELEBRATION_PLAYED",
  // incentive engine (Phase 9)
  "INCENTIVE_SCHEME_CREATED",
  "INCENTIVE_SCHEME_UPDATED",
  "INCENTIVE_SCHEME_ENABLED",
  "INCENTIVE_SCHEME_DISABLED",
  "INCENTIVE_CALCULATION_RUN",
  "INCENTIVE_RESULT_RECALCULATED",
  "INCENTIVE_RESULT_REVIEWED",
  "INCENTIVE_RESULT_APPROVED",
  "INCENTIVE_RESULT_FINALIZED",
  "INCENTIVE_RESULT_REVERSED",
] as const;

export type OperationsAuditAction = (typeof OPERATIONS_AUDIT_ACTIONS)[number];

export function isOperationsAuditAction(v: string): v is OperationsAuditAction {
  return (OPERATIONS_AUDIT_ACTIONS as readonly string[]).includes(v);
}
