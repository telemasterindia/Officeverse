/**
 * Officeverse — Zod schemas for Follow-up server functions (Phase 4).
 *
 * Server-side only. Owner / role / actor / status-transition are NEVER taken
 * from the body — the owner comes from the session and the legal transition is
 * decided by the state machine in ../authz/followups.ts.
 *
 * Customer field names match the existing app's `FollowUpCustomer` shape
 * (full_name, credit, current_late, …) so later UI wiring is a pass-through.
 */
import { z } from "zod";
import { FOLLOW_UP_STATUSES } from "@/lib/db/schema";

const FU_STATUS = z.enum(FOLLOW_UP_STATUSES as unknown as [string, ...string[]]);

export const followUpCodeSchema = z
  .string()
  .trim()
  .regex(/^FU_\d{8}$/, "Invalid Follow-up ID (expected FU_########)");
export const closerCodeSchema = z
  .string()
  .trim()
  .regex(/^CL-\d{5}$/, "Invalid Closer ID (expected CL-#####)");

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const hm = z
  .string()
  .trim()
  .regex(/^\d{1,2}:\d{2}$/, "Expected HH:MM");
const wallOrIso = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\+05:30)?$/, "Invalid timestamp");
const optStr = (max: number) => z.string().trim().max(max).optional();
const note = optStr(2000);
const emailField = z
  .union([z.string().trim().toLowerCase().email().max(191), z.literal("")])
  .optional();
const money = z
  .union([z.number(), z.string().transform((s) => Number(s.replace(/[^0-9.]/g, "")))])
  .pipe(z.number().nonnegative().max(1_000_000_000))
  .optional();
const currentLate = z.enum(["Current", "Late"]).optional();

/* --------------------------- customer payload ------------------------- */

export const customerCreateSchema = z.object({
  full_name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(3).max(40),
  email: emailField,
  address: optStr(500),
  city: optStr(120),
  state: optStr(120),
  zip: optStr(20),
  debt_amount: money,
  credit: optStr(60),
  current_late: currentLate,
  comment: optStr(5000),
});

export const customerPatchSchema = z
  .object({
    full_name: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().min(3).max(40).optional(),
    email: emailField,
    address: optStr(500),
    city: optStr(120),
    state: optStr(120),
    zip: optStr(20),
    debt_amount: money,
    credit: optStr(60),
    current_late: currentLate,
    comment: optStr(5000),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), {
    message: "No fields to update",
  });
export type CustomerPatchInput = z.infer<typeof customerPatchSchema>;

/* ------------------------------ operations -------------------------- */

export const createFollowUpSchema = customerCreateSchema.extend({
  /** operational SHIFT DATE of capture; default = server-computed */
  date: ymd.optional(),
  /** the scheduled callback — a literal calendar date + time (IST) */
  scheduled_date: ymd,
  scheduled_time: hm,
});
export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;

export const getFollowUpSchema = z.object({ code: followUpCodeSchema });
export const historySchema = z.object({ code: followUpCodeSchema });

export const updateCustomerArgsSchema = z.object({
  code: followUpCodeSchema,
  patch: customerPatchSchema,
});

export const rescheduleSchema = z.object({
  code: followUpCodeSchema,
  scheduled_date: ymd,
  scheduled_time: hm,
  reason: note,
  /** optimistic-concurrency guard — the schedule the client believes is current */
  expected_scheduled_at: wallOrIso.optional(),
});
export type RescheduleInput = z.infer<typeof rescheduleSchema>;

export const completeSchema = z.object({ code: followUpCodeSchema, note });
export const cancelSchema = z.object({ code: followUpCodeSchema, reason: note });

export const convertSchema = z.object({
  code: followUpCodeSchema,
  /**
   * Required for AGENT-owned conversions (pick the Closer). Omitted for
   * CLOSER-owned conversions (the same closer stays responsible). The service
   * enforces the required/forbidden rule by the follow-up owner's role.
   */
  to_closer_code: closerCodeSchema.optional(),
  note,
});
export type ConvertInput = z.infer<typeof convertSchema>;

export const listFollowUpsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  bucket: z.enum(["today", "upcoming", "overdue", "completed"]).optional(),
  status: FU_STATUS.optional(),
  scheduledFrom: ymd.optional(),
  scheduledTo: ymd.optional(),
  q: optStr(120),
  sort: z.enum(["soonest", "latest", "newest"]).default("soonest"),
  /** admin-only — filter to one owner by users.id; ignored for non-admin */
  ownerUserId: z.coerce.number().int().positive().optional(),
});
export type ListFollowUpsInput = z.infer<typeof listFollowUpsSchema>;
