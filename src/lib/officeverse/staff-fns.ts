/**
 * Officeverse — client-callable staff (agent / closer) directory functions.
 *
 * Replaces the old localStorage `people` store. Every handler authenticates
 * (`requireUser`) and the service enforces Admin/HR for writes + Closer
 * process-scoping for reads. Server generates the canonical TMI_CC_### /
 * TMI_CL_### code and argon2-hashes the password; the client never chooses the
 * id or the role.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRole, requireUser, requestInfo } from "@/server/context";
import { AGENT_CODE_RE } from "@/lib/officeverse/staff-codes";
import * as svc from "@/server/staff/service";

const kind = z.enum(["agent", "closer"]);
const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const statusEnum = z.enum(["active", "inactive", "suspended", "on_leave"]);

const createInput = z.object({
  kind,
  full_name: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().max(191),
  password: z.string().min(8).max(200),
  phone: z.string().trim().max(40).optional(),
  dob: ymd.optional(),
  process: z.enum(["US", "IN", "UK", "AU"]),
  registered_on: ymd.optional(),
  status: statusEnum.optional(),
  // Admin UAT Batch-2 §3 — agent monthly base salary (rupees). Service rejects
  // it for a Closer. Never returned to / visible to the employee.
  base_salary: z.number().nonnegative().max(100_000_000).optional(),
  // Admin UAT Batch-2 §2 — official profile photo, raw base64 (no data: prefix).
  photo_base64: z.string().max(12_000_000).optional(),
  // Admin UAT Batch-2 follow-up §2 — official joining date (agents).
  joining_date: ymd.optional(),
});

const listInput = z.object({
  kind,
  q: z.string().trim().max(120).optional(),
  /** Admin UAT §4 — a manager may scope the directory to one process; a Closer
   *  is always forced to their own process server-side. */
  process: z.enum(["US", "IN", "UK", "AU"]).optional(),
});

const staffCode = z
  .string()
  .trim()
  .regex(/^(TMI_CC_\d{3,}|TMI_CL_\d{3,}|TMI_CC\d{3,}|AG-\d{5}|CL-\d{5})$/);
const agentCode = z.string().trim().regex(AGENT_CODE_RE);

const statusInput = z.object({
  kind,
  code: staffCode,
  status: statusEnum,
  phone: z.string().trim().max(40).optional(),
});

/** §1/§2/§4 — Admin/HR profile correction. Every field is optional; the server
 *  validates dates and delegates salary to the existing payroll model. */
const updateProfileInput = z.object({
  kind,
  code: staffCode,
  full_name: z.string().trim().min(2).max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  process: z.enum(["US", "IN", "UK", "AU"]).optional(),
  status: statusEnum.optional(),
  dob: z.union([ymd, z.literal("")]).optional(),
  anniversary_date: z.union([ymd, z.literal("")]).optional(),
  joining_date: z.union([ymd, z.literal("")]).optional(),
  base_salary: z.number().nonnegative().max(100_000_000).optional(),
  salary_effective_from: ymd.optional(),
});

const removeInput = z.object({ kind, code: staffCode });

export const createStaffFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ data }): Promise<{ staff: svc.StaffDTO }> => {
    const user = await requireUser();
    return { staff: await svc.createStaff(user, data, requestInfo()) };
  });

export const listStaffFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listInput.parse(d))
  .handler(async ({ data }): Promise<svc.ListStaffResult> => {
    const user = await requireUser();
    return svc.listStaff(user, data);
  });

export const setStaffStatusFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => statusInput.parse(d))
  .handler(async ({ data }): Promise<{ staff: svc.StaffDTO }> => {
    const user = await requireUser();
    return { staff: await svc.setStaffStatus(user, data, requestInfo()) };
  });

/**
 * §9 — Promote an Agent to Closer. ADMIN ONLY (`requireRole("admin")` at the
 * boundary AND `assertCanPromoteStaff` in the service). Preserves the employee
 * record + history; moves no leads / follow-ups.
 */
export const promoteAgentFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ agent_code: agentCode }).parse(d))
  .handler(async ({ data }): Promise<svc.PromoteResult> => {
    const user = await requireRole("admin");
    return svc.promoteAgentToCloser(user, data.agent_code, requestInfo());
  });

/**
 * §1/§2/§4 — Edit an Agent/Closer profile. Admin + HR (`assertCanManageStaff`
 * in the service). Reuses the existing photo + salary architecture; touches no
 * historical table and never the role.
 */
export const updateStaffProfileFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateProfileInput.parse(d))
  .handler(async ({ data }): Promise<{ staff: svc.StaffDTO }> => {
    const user = await requireUser();
    return { staff: await svc.updateStaffProfile(user, data, requestInfo()) };
  });

/**
 * §8 — Remove (deactivate / terminate) an employee. ADMIN ONLY
 * (`requireRole("admin")` + `assertCanRemoveStaff`). No row is deleted; login is
 * blocked, sessions revoked, all history preserved.
 */
export const removeStaffFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => removeInput.parse(d))
  .handler(async ({ data }): Promise<svc.RemoveStaffResult> => {
    const user = await requireRole("admin");
    return svc.removeStaff(user, data, requestInfo());
  });
