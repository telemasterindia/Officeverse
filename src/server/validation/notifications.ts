/**
 * Officeverse — Zod schemas for the notification server functions (Phase 5).
 *
 * Server-side only. The recipient is NEVER part of any schema — it comes from
 * the authenticated session. Unknown keys (e.g. an injected `recipientUserId`)
 * are stripped by Zod's default object parsing.
 */
import { z } from "zod";
import { EMAIL_TEMPLATES } from "@/lib/db/schema";

export const listNotificationsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z.coerce.boolean().default(false),
  /** optional event-type filter (varchar in the DB) */
  type: z.string().trim().min(1).max(60).optional(),
});
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>;

export const markNotificationReadSchema = z.object({
  /** notifications have no business code — the numeric id is the handle */
  id: z.coerce.number().int().positive(),
});
export type MarkNotificationReadInput = z.infer<typeof markNotificationReadSchema>;

export const markAllNotificationsReadSchema = z.object({}).strict();

/* --------------------- internal email-enqueue shape ------------------- *
 * NOT exposed as a server function. Used for type-safety + tests of the
 * internal enqueue path (scheduler / event integration).
 * ------------------------------------------------------------------------ */

export const emailTemplateSchema = z.enum(EMAIL_TEMPLATES as unknown as [string, ...string[]]);

export const enqueueEmailSchema = z.object({
  template: emailTemplateSchema,
  toEmail: z.string().trim().toLowerCase().email().max(191),
  toName: z.string().trim().max(200).optional(),
  toUserId: z.number().int().positive().optional(),
  subject: z.string().trim().min(1).max(500).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  relatedEntityType: z.string().trim().max(40).optional(),
  relatedEntityId: z.number().int().positive().optional(),
  /** REQUIRED business-derived idempotency key */
  dedupeKey: z.string().trim().min(1).max(191),
  scheduledFor: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/, "Invalid timestamp")
    .optional(),
  maxRetries: z.number().int().min(0).max(20).optional(),
});
export type EnqueueEmailInput = z.infer<typeof enqueueEmailSchema>;
