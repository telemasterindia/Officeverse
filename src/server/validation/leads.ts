/**
 * Officeverse — Zod schemas for Lead server functions (Phase 3).
 *
 * Server-side validation only. Client-supplied identity/ownership fields
 * (role, user id, agent id, closer id except the explicit transfer target,
 * status except closer transitions) are NOT trusted — they are derived from the
 * authenticated session in the service layer.
 *
 * Field names use the existing app's `Lead` / `CreateLeadInput` shape so the
 * later UI wiring is a direct pass-through.
 */
import { z } from "zod";
import { LEAD_STATUSES } from "@/lib/db/schema";
import { AGENT_CODE_RE, CLOSER_CODE_RE } from "@/lib/officeverse/staff-codes";
import { usPhoneSchema } from "./phone";

const LEAD_STATUS_ENUM = z.enum(LEAD_STATUSES as unknown as [string, ...string[]]);

export const leadCodeSchema = z
  .string()
  .trim()
  .regex(/^TMI_\d{8}$/, "Invalid Lead ID (expected TMI_########)");
export const closerCodeSchema = z
  .string()
  .trim()
  // Canonical Closer Employee ID "TMI_CL_###"; legacy "CL-#####" still accepted.
  .regex(CLOSER_CODE_RE, "Invalid Closer ID (expected TMI_CL_###)");
export const agentCodeSchema = z
  .string()
  .trim()
  // Canonical Agent Employee ID "TMI_CC_###"; legacy "TMI_CC###" / "AG-#####" still accepted.
  .regex(AGENT_CODE_RE, "Invalid Agent ID (expected TMI_CC_###)");

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const optStr = (max: number) => z.string().trim().max(max).optional();
const emailField = z
  .union([z.string().trim().toLowerCase().email().max(191), z.literal("")])
  .optional();
const money = z
  .union([z.number(), z.string().transform((s) => Number(s.replace(/[^0-9.]/g, "")))])
  .pipe(z.number().nonnegative().max(1_000_000_000))
  .optional();
const currentLate = z.enum(["Current", "Late"]).optional();

export const createLeadSchema = z.object({
  customer_name: z.string().trim().min(1).max(200),
  phone: usPhoneSchema,
  email: emailField,
  /** operational SHIFT DATE; default = server-computed current shift date */
  date: ymd.optional(),
  address: optStr(500),
  city: optStr(120),
  state: optStr(120),
  zip: optStr(20),
  debt_amount: money,
  credit: optStr(60),
  current_late: currentLate,
  comment: optStr(5000),
  file_name: optStr(200),
  /** optional: create the lead already transferred to this closer */
  assigned_closer_code: closerCodeSchema.optional(),
  /** admin-only: which agent submitted it. Ignored for agent callers. */
  agent_code: agentCodeSchema.optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z
  .object({
    customer_name: z.string().trim().min(1).max(200).optional(),
    phone: usPhoneSchema.optional(),
    email: emailField,
    address: optStr(500),
    city: optStr(120),
    state: optStr(120),
    zip: optStr(20),
    debt_amount: money,
    credit: optStr(60),
    current_late: currentLate,
    comment: optStr(5000),
    file_name: optStr(200),
    status: LEAD_STATUS_ENUM.optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), {
    message: "No fields to update",
  });
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const getLeadSchema = z.object({ code: leadCodeSchema });

export const updateLeadArgsSchema = z.object({
  code: leadCodeSchema,
  patch: updateLeadSchema,
});

export const transferLeadSchema = z.object({
  code: leadCodeSchema,
  to_closer_code: closerCodeSchema,
  note: optStr(500),
});
export type TransferLeadInput = z.infer<typeof transferLeadSchema>;

export const listLeadsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: LEAD_STATUS_ENUM.optional(),
  q: optStr(120),
  shiftDateFrom: ymd.optional(),
  shiftDateTo: ymd.optional(),
  /** admin-only filters — silently ignored for non-admin callers (Admin UAT §3/§4) */
  process: z.enum(["US", "UK", "IN", "AU"]).optional(),
  closerCode: closerCodeSchema.optional(),
  agentCode: agentCodeSchema.optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
});
export type ListLeadsInput = z.infer<typeof listLeadsSchema>;
