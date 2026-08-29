/**
 * Officeverse — network access + attendance-eligibility decision (Phase 23).
 * PURE. Given only the role, whether the server-observed IP matched an active
 * office network, and whether any IP policy exists at all, decide:
 *
 *   crmAllowed          — may this login establish a CRM session?
 *   attendanceEligible  — should this session's day count toward attendance?
 *
 * FROZEN BUSINESS RULES:
 *   AGENT  — office network REQUIRED. Remote agent → CRM DENIED, no attendance.
 *   CLOSER — remote CRM ALLOWED, but attendance is recorded ONLY from an office
 *            network.
 *   HR / ADMIN — CRM per existing authorization; their attendance is not
 *            office-gated here (HR/Admin attendance is not auto-tracked).
 *
 * SAFETY: if NO office network is configured yet (`policyConfigured=false`), the
 * IP gate is treated as "not yet in force" — Agents are NOT locked out, but no
 * session is attendance-eligible until a network exists. This prevents a
 * first-deploy / misconfiguration lockout (spec §24).
 */

export type AccessRole = "admin" | "agent" | "closer" | "hr";

export interface AccessInput {
  role: string;
  /** did the server-observed IP fall inside an ACTIVE office_networks row? */
  officeMatch: boolean;
  /** are there ANY active office networks at all? */
  policyConfigured: boolean;
}

export interface AccessDecision {
  crmAllowed: boolean;
  attendanceEligible: boolean;
  /** machine reason — surfaced to the client only as a generic message */
  code:
    | "office"
    | "agent_remote_denied"
    | "closer_remote_no_attendance"
    | "not_office_gated"
    | "policy_unconfigured";
}

export function evaluateAccess(input: AccessInput): AccessDecision {
  const role = input.role;
  const officeGated = role === "agent" || role === "closer";

  if (!officeGated) {
    // HR / Admin — existing authorization decides CRM access elsewhere; never
    // office-gated, never auto-attendance-eligible here.
    return { crmAllowed: true, attendanceEligible: false, code: "not_office_gated" };
  }

  if (!input.policyConfigured) {
    // No networks configured — do not lock anyone out; nothing is eligible.
    return { crmAllowed: true, attendanceEligible: false, code: "policy_unconfigured" };
  }

  if (input.officeMatch) {
    return { crmAllowed: true, attendanceEligible: true, code: "office" };
  }

  if (role === "closer") {
    return { crmAllowed: true, attendanceEligible: false, code: "closer_remote_no_attendance" };
  }

  // agent, remote, policy in force → hard deny
  return { crmAllowed: false, attendanceEligible: false, code: "agent_remote_denied" };
}

/** Generic, non-revealing message for a denied / non-eligible login. */
export function accessMessage(code: AccessDecision["code"]): string {
  switch (code) {
    case "agent_remote_denied":
      return "You can only sign in from an authorized office network.";
    case "closer_remote_no_attendance":
    case "policy_unconfigured":
      return "Attendance can only be recorded from an authorized office network.";
    default:
      return "";
  }
}
