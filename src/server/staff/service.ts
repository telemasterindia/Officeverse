/**
 * Officeverse — staff (agent / closer) directory service (Phase 24A).
 *
 * The AUTHORITATIVE employee records: a `users` row + its 1:1 `agents` /
 * `closers` profile. Replaces the old client-side localStorage `people` store.
 *
 *   - create   → Admin / HR only; argon2-hashed password; one transaction;
 *                server-generated canonical TMI_CC_### / TMI_CL_### code.
 *   - list     → Admin / HR see all; a Closer sees agents/closers in their own
 *                process (read-only, no compensation ever).
 *   - status   → Admin / HR only.
 *
 * Salary is NOT part of staff creation — base salary lives only in the
 * payroll module (`setSalaryProfileFn`, Admin/HR). A Closer never has a salary
 * field anywhere here.
 */
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { assertCanManageStaff, assertCanPromoteStaff, assertCanRemoveStaff } from "../authz/staff";
import { hashPassword } from "../password";
import { currentShiftDate, nowIST } from "../time";
import { validatePhotoUpload } from "../hr/photo";
import { setProfilePhoto } from "../hr/photo-service";
import { setSalaryProfile } from "../hr/payroll-service";
import { revokeAllForUser } from "../session";
import * as repo from "../db/repos/staff";
import { getUserById } from "../db/repos/users";
import type { User } from "@/lib/db/schema";
import type { ProcessCode } from "@/lib/officeverse/types";

type Meta = { ip?: string | null; userAgent?: string | null };

export interface StaffDTO {
  /** the underlying users.id — Admin/HR use it to load the official photo
   *  (the photo endpoint still enforces who may view it). */
  user_id: number;
  code: string;
  kind: "agent" | "closer";
  full_name: string;
  email: string;
  phone: string | null;
  process: string;
  status: string;
  registered_on: string;
  /** Admin UAT Batch-2 follow-up §2 — official joining date (agents). */
  joining_date: string | null;
  /** date of birth (both roles) — Admin/HR correctable */
  dob: string | null;
  /** work anniversary date (both roles) — Admin/HR correctable */
  anniversary_date: string | null;
  photo_available: boolean;
}

function toDTO(r: repo.StaffRow): StaffDTO {
  return {
    user_id: r.userId,
    code: r.code,
    kind: r.kind,
    full_name: r.fullName,
    email: r.email,
    phone: r.phone,
    process: r.process,
    status: r.status,
    registered_on: r.registeredOn,
    joining_date: r.joiningDate,
    dob: r.dob,
    anniversary_date: r.anniversaryDate,
    photo_available: r.photoAvailable,
  };
}

/* ----------------------------- validation --------------------------- */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in `YYYY-MM-DD` — rejects impossible dates
 *  (2024-02-30, 2023-13-01, …) and anything outside a sane range. Exported for
 *  the staff-lifecycle unit tests. */
export function isValidYmd(v: string): boolean {
  if (!YMD_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function assertDate(label: string, v: string | null | undefined): void {
  if (v == null || v === "") return; // clearing a date is allowed
  if (!isValidYmd(v))
    throw new HttpError(400, `${label} must be a valid YYYY-MM-DD date`, "bad_date");
}

export interface CreateStaffInput {
  kind: "agent" | "closer";
  full_name: string;
  email: string;
  password: string;
  phone?: string | undefined;
  dob?: string | undefined;
  process: ProcessCode;
  registered_on?: string | undefined;
  status?: "active" | "inactive" | "suspended" | "on_leave" | undefined;
  /** Admin UAT Batch-2 §3 — monthly base salary (rupees). AGENTS ONLY — a
   *  Closer works on incentives and never has a fixed wage. When present it is
   *  written to `salary_profiles` (effective from the registration date) so it
   *  auto-maps into payroll. Never exposed to the agent themselves. */
  base_salary?: number | undefined;
  /** Admin UAT Batch-2 §2 — official profile photo, raw base64 (no data: URI
   *  prefix). Set by Admin / HR at creation time; the employee cannot change it. */
  photo_base64?: string | undefined;
  /** Admin UAT Batch-2 follow-up §2 — official JOINING DATE ("YYYY-MM-DD",
   *  agents). Authoritative employee data; used as the salary-profile
   *  effective-from date instead of the registration date. */
  joining_date?: string | undefined;
}

export async function createStaff(
  actor: User,
  input: CreateStaffInput,
  meta: Meta = {},
): Promise<StaffDTO> {
  assertCanManageStaff(actor.role);

  const email = input.email.trim().toLowerCase();
  if (await repo.emailExists(email)) {
    throw new HttpError(409, "An account with that email already exists", "email_taken");
  }

  // ---- validate the optional Batch-2 extras BEFORE creating the user, so a
  //      bad photo / salary never leaves a half-created employee behind ----
  const baseSalary = input.base_salary;
  if (baseSalary != null) {
    if (input.kind !== "agent") {
      throw new HttpError(
        400,
        "Base salary applies to agents only — a Closer works on incentives.",
        "salary_not_applicable",
      );
    }
    if (!Number.isFinite(baseSalary) || baseSalary < 0 || baseSalary > 100_000_000) {
      throw new HttpError(
        400,
        "Base salary must be a number between 0 and 100,000,000",
        "bad_amount",
      );
    }
  }

  let photoBytes: Uint8Array | null = null;
  if (input.photo_base64 && input.photo_base64.trim()) {
    photoBytes = new Uint8Array(Buffer.from(input.photo_base64, "base64"));
    const v = validatePhotoUpload(photoBytes, {});
    if (!v.ok) throw new HttpError(422, v.reason, `photo_${v.code}`);
  }

  const joiningDate =
    input.kind === "agent" && input.joining_date && input.joining_date.trim()
      ? input.joining_date.trim()
      : null;
  if (joiningDate && !/^\d{4}-\d{2}-\d{2}$/.test(joiningDate)) {
    throw new HttpError(400, "Joining date must be YYYY-MM-DD", "bad_date");
  }

  const now = nowIST();
  const registeredOn = input.registered_on ?? currentShiftDate(input.process);
  const code = await repo.nextStaffCode(input.kind);
  const passwordHash = await hashPassword(input.password);

  const row = await repo.insertStaff({
    kind: input.kind,
    code,
    dob: input.dob && input.dob.trim() ? input.dob.trim() : null,
    registeredOn,
    joiningDate,
    now,
    user: {
      email,
      passwordHash,
      fullName: input.full_name.trim(),
      role: input.kind, // "agent" | "closer"
      process: input.process,
      status: input.status ?? "active",
      phone: input.phone && input.phone.trim() ? input.phone.trim() : null,
      photoAssetId: null,
      mustChangePassword: true,
      lastLoginAt: null,
    },
  });

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: input.kind === "agent" ? "staff.agent_created" : "staff.closer_created",
    entityType: "user",
    entityId: row.userId,
    entityCode: code,
    metadata: {
      email,
      process: input.process,
      status: row.status,
      baseSalarySet: baseSalary != null,
      photoSet: photoBytes != null,
      joiningDate,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  // Admin UAT Batch-2 §3 + follow-up §2 — map the agent's base salary straight
  // into payroll, effective from the ACTUAL joining date (falling back to the
  // registration date only when no joining date was supplied).
  if (baseSalary != null && input.kind === "agent") {
    await setSalaryProfile(
      actor,
      row.userId,
      {
        baseSalary,
        effectiveFrom: joiningDate ?? registeredOn,
        note: "Set at agent creation",
      },
      meta,
    );
  }

  // Admin UAT Batch-2 §2 — store the official photo (Admin/HR only; re-validated
  // inside the photo service).
  if (photoBytes != null) {
    await setProfilePhoto(actor, { targetUserId: row.userId, bytes: photoBytes }, meta);
    return toDTO({ ...row, photoAvailable: true });
  }

  return toDTO(row);
}

export interface ListStaffResult {
  staff: StaffDTO[];
}

export async function listStaff(
  actor: Pick<User, "role" | "process">,
  input: {
    kind: "agent" | "closer";
    q?: string | undefined;
    process?: string | undefined;
    /** OPERATIONAL rosters pass true → only `users.status = 'active'` rows. The
     *  plain directory keeps inactive rows (badged) for edit / re-activate. */
    activeOnly?: boolean | undefined;
  },
): Promise<ListStaffResult> {
  const isManager = actor.role === "admin" || actor.role === "hr";
  if (!isManager && actor.role !== "closer") {
    throw new HttpError(403, "Not authorized to view the staff directory", "forbidden");
  }
  // Admin UAT §4 — a Closer is ALWAYS forced to their own process; a manager
  // may optionally scope to one process. Enforced server-side.
  const process = isManager ? input.process : (actor.process as string);
  const rows = await repo.listStaffRows(input.kind, {
    ...(process ? { process } : {}),
    ...(input.q ? { q: input.q } : {}),
    ...(input.activeOnly ? { activeOnly: true } : {}),
  });
  return { staff: rows.map(toDTO) };
}

/**
 * §9 — Promote an Agent to Closer. ADMIN ONLY. Preserves the employee record +
 * all lead/follow-up history; applies Closer permissions (via `users.role`) and
 * drops Agent-only permissions; never creates a duplicate account and never
 * moves existing leads/follow-ups.
 */
export interface PromoteResult {
  user_id: number;
  agent_code: string;
  closer_code: string;
  new_role: "closer";
  created_closer_row: boolean;
  leads_moved: 0;
  followups_moved: 0;
}

export async function promoteAgentToCloser(
  actor: User,
  agentCode: string,
  meta: Meta = {},
): Promise<PromoteResult> {
  assertCanPromoteStaff(actor.role); // Admin only — NOT HR

  const agent = await repo.getAgentByCode(agentCode);
  if (!agent) throw new HttpError(404, `Agent ${agentCode} not found`, "not_found");
  const targetUser = await getUserById(agent.userId);
  if (!targetUser) throw new HttpError(404, "Employee record not found", "not_found");
  if (targetUser.role === "closer") {
    throw new HttpError(409, "This employee is already a Closer", "already_closer");
  }
  if (targetUser.role !== "agent") {
    throw new HttpError(422, "Only an Agent can be promoted to Closer", "not_an_agent");
  }

  const now = nowIST();
  const { closerCode, createdCloserRow } = await repo.promoteAgentUserToCloser(
    agent.userId,
    agent.registeredOn,
    agent.dob ?? null,
    now,
    agent.anniversaryDate ?? null,
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "staff.promoted_agent_to_closer",
    entityType: "user",
    entityId: agent.userId,
    entityCode: closerCode,
    metadata: {
      agent_code: agentCode,
      closer_code: closerCode,
      created_closer_row: createdCloserRow,
      from_role: "agent",
      to_role: "closer",
      // explicit: promotion moves NO work
      leads_moved: 0,
      followups_moved: 0,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return {
    user_id: agent.userId,
    agent_code: agentCode,
    closer_code: closerCode,
    new_role: "closer",
    created_closer_row: createdCloserRow,
    leads_moved: 0,
    followups_moved: 0,
  };
}

export async function setStaffStatus(
  actor: User,
  input: { code: string; kind: "agent" | "closer"; status: string; phone?: string | undefined },
  meta: Meta = {},
): Promise<StaffDTO> {
  assertCanManageStaff(actor.role);
  const rows = await repo.listStaffRows(input.kind, {});
  const target = rows.find((r) => r.code === input.code);
  if (!target) throw new HttpError(404, `${input.kind} ${input.code} not found`, "not_found");

  await repo.updateStaffUser(
    target.userId,
    {
      status: input.status,
      ...(input.phone !== undefined ? { phone: input.phone.trim() || null } : {}),
    },
    nowIST(),
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "staff.status_changed",
    entityType: "user",
    entityId: target.userId,
    entityCode: input.code,
    metadata: { from: target.status, to: input.status },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return toDTO({ ...target, status: input.status });
}

/* -------------------- profile edit (Admin + HR) -------------------- */

export interface UpdateStaffProfileInput {
  code: string;
  kind: "agent" | "closer";
  full_name?: string | undefined;
  phone?: string | undefined;
  process?: ProcessCode | undefined;
  status?: "active" | "inactive" | "suspended" | "on_leave" | undefined;
  dob?: string | undefined;
  anniversary_date?: string | undefined;
  /** agents only */
  joining_date?: string | undefined;
  /** agents only — routed to the EXISTING salary-profile model (future-effective) */
  base_salary?: number | undefined;
  salary_effective_from?: string | undefined;
}

/**
 * §1/§2/§4 — Admin/HR correct an Agent/Closer profile. Uses the existing
 * `assertCanManageStaff` (Admin + HR). Dates are server-validated (no impossible
 * dates). Salary is delegated UNCHANGED to `setSalaryProfile` (agents only) —
 * the existing model makes it future-effective. Role and every historical table
 * are untouched. Audit records who / whom / which fields / when — not values.
 */
export async function updateStaffProfile(
  actor: User,
  input: UpdateStaffProfileInput,
  meta: Meta = {},
): Promise<StaffDTO> {
  assertCanManageStaff(actor.role);
  const target = await repo.getStaffRowByCode(input.kind, input.code);
  if (!target) throw new HttpError(404, `${input.kind} ${input.code} not found`, "not_found");

  assertDate("Date of birth", input.dob);
  assertDate("Anniversary date", input.anniversary_date);
  assertDate("Joining date", input.joining_date);
  assertDate("Salary effective-from", input.salary_effective_from);

  if (input.full_name !== undefined && input.full_name.trim().length < 2) {
    throw new HttpError(400, "Full name must be at least 2 characters", "bad_name");
  }
  if (input.joining_date !== undefined && input.kind !== "agent") {
    throw new HttpError(400, "Joining date applies to agents only", "not_applicable");
  }
  if (input.base_salary !== undefined) {
    if (input.kind !== "agent") {
      throw new HttpError(
        400,
        "Base salary applies to agents only — a Closer works on incentives.",
        "salary_not_applicable",
      );
    }
    if (!Number.isFinite(input.base_salary) || input.base_salary < 0) {
      throw new HttpError(400, "Base salary must be a non-negative number", "bad_amount");
    }
  }

  const now = nowIST();
  const patch: repo.StaffProfilePatch = {
    ...(input.full_name !== undefined ? { fullName: input.full_name.trim() } : {}),
    ...(input.phone !== undefined ? { phone: input.phone.trim() || null } : {}),
    ...(input.process !== undefined ? { process: input.process } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.dob !== undefined ? { dob: input.dob || null } : {}),
    ...(input.anniversary_date !== undefined
      ? { anniversaryDate: input.anniversary_date || null }
      : {}),
    ...(input.kind === "agent" && input.joining_date !== undefined
      ? { joiningDate: input.joining_date || null }
      : {}),
  };

  const changed = await repo.updateStaffProfileRow(target.userId, input.kind, patch, now);

  // salary → the EXISTING payroll salary-profile model (unchanged rules)
  if (input.base_salary !== undefined && input.kind === "agent") {
    await setSalaryProfile(
      actor,
      target.userId,
      {
        baseSalary: input.base_salary,
        effectiveFrom: input.salary_effective_from ?? target.joiningDate ?? target.registeredOn,
        note: "Corrected via staff profile edit",
      },
      meta,
    );
    changed.push("base_salary");
  }

  if (changed.length === 0) {
    throw new HttpError(400, "No editable fields were provided", "nothing_to_update");
  }

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "staff.profile_updated",
    entityType: "user",
    entityId: target.userId,
    entityCode: input.code,
    metadata: { kind: input.kind, fields: changed }, // field NAMES only — never values
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return (await repo.getStaffRowByCode(input.kind, input.code).then((r) => (r ? toDTO(r) : null)))!;
}

/* ------------------ remove / deactivate (Admin only) --------------- */

export interface RemoveStaffResult {
  removed: true;
  user_id: number;
  code: string;
  kind: "agent" | "closer";
  /** the lifecycle model actually applied */
  model: "deactivated";
  from_status: string;
  sessions_revoked: true;
}

/**
 * §8/§9 — "Remove" an employee from the active workforce. ADMIN ONLY.
 *
 * LIFECYCLE MODEL: DEACTIVATION / TERMINATION (not physical deletion).
 * `users.id` is the target of ~20 ON DELETE RESTRICT foreign keys (follow_ups,
 * attendance, payroll_runs, salary_slips, salary_profiles, leave_days,
 * off_records, overtime_records, incentive_results, gamification_point_*,
 * milestone_triggers, employment_periods, imports, regularity_bonus,
 * payroll_adjustments, leave_requests) — a hard delete is either FK-blocked or
 * would destroy irreplaceable historical business records. So instead:
 *   - `users.status` → "inactive"  (login is refused; live sessions die on the
 *     next request because `resolveSession` rejects non-active users)
 *   - every session token is revoked immediately
 *   - the row and ALL history stay intact and remain attributable to the person
 *   - operational rosters exclude them (activeOnly filter); the directory keeps
 *     them (badged) so an Admin can re-activate.
 */
export async function removeStaff(
  actor: User,
  input: { code: string; kind: "agent" | "closer" },
  meta: Meta = {},
): Promise<RemoveStaffResult> {
  assertCanRemoveStaff(actor.role); // Admin only — NOT HR
  const target = await repo.getStaffRowByCode(input.kind, input.code);
  if (!target) throw new HttpError(404, `${input.kind} ${input.code} not found`, "not_found");
  if (target.userId === actor.id) {
    throw new HttpError(400, "You cannot remove your own account", "self_remove");
  }

  const now = nowIST();
  await repo.deactivateStaffUser(target.userId, now);
  await revokeAllForUser(target.userId);

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "staff.removed",
    entityType: "user",
    entityId: target.userId,
    entityCode: input.code,
    metadata: {
      kind: input.kind,
      model: "deactivated",
      from_status: target.status,
      to_status: "inactive",
      sessions_revoked: true,
      historical_rows_deleted: 0,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return {
    removed: true,
    user_id: target.userId,
    code: input.code,
    kind: input.kind,
    model: "deactivated",
    from_status: target.status,
    sessions_revoked: true,
  };
}
