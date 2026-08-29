/**
 * Officeverse — event → (notification + email job) PLANNING (Phase 5). PURE.
 *
 * Given a follow-up lifecycle event that ACTUALLY happened, produce the set of
 * in-app notifications and email JOBS to enqueue. No DB, no sending, no timers.
 *
 * Deliberate rules (spec §10, §11):
 *   - "created" produces NOTHING. Scheduling a follow-up is not a reminder; the
 *     future scheduler decides when a reminder is generated.
 *   - No plan ever contains a "reminder" / "overdue" type — those are
 *     time-based and belong to the future scheduler, not to event integration.
 *   - A converted / completed / cancelled follow-up is terminal and can never
 *     yield active reminder work (`canGenerateReminderWork` → false).
 *   - Every dedupe key is derived from the business event (follow-up CODE — which
 *     survives reschedules — plus the event name and the relevant scheduled
 *     instant), never from the current time.
 */
import { emailDedupeKey, followUpEventDedupeKey, notificationDedupeKey } from "../ids";
import type { EmailTemplateId } from "@/lib/db/schema";

export type FollowUpEventKind = "created" | "rescheduled" | "converted" | "completed" | "cancelled";

export interface NotificationPlan {
  recipientUserId: number;
  type: string;
  title: string;
  message: string;
  relatedEntityType: string;
  relatedEntityCode: string;
  dedupeKey: string;
  metadata: Record<string, unknown>;
}

export interface EmailPlan {
  template: EmailTemplateId;
  toUserId: number;
  payload: Record<string, unknown>;
  relatedEntityType: string;
  relatedEntityCode: string;
  dedupeKey: string;
}

export interface FollowUpEventPlan {
  notifications: NotificationPlan[];
  emails: EmailPlan[];
}

export interface FollowUpEventContext {
  followUpCode: string;
  followUpId: number;
  ownerUserId: number;
  ownerName?: string | null;
  /** the current / target scheduled instant (IST wall-clock) */
  scheduledAt: string;
  /** for a reschedule — the instant it moved FROM */
  previousScheduledAt?: string | null;
  customerName: string;
  comment?: string | null;
  reason?: string | null;
  /* conversion only */
  leadCode?: string | null;
  leadId?: number | null;
  responsibleCloserUserId?: number | null;
  responsibleCloserName?: string | null;
  source?: string | null;
}

/** Only an active SCHEDULED follow-up can ever generate reminder work. */
export function canGenerateReminderWork(status: string): boolean {
  return status === "SCHEDULED";
}

const EMPTY: FollowUpEventPlan = { notifications: [], emails: [] };

export function planFollowUpEvent(
  kind: FollowUpEventKind,
  ctx: FollowUpEventContext,
): FollowUpEventPlan {
  switch (kind) {
    case "created":
      // Intentionally nothing — see file header.
      return { notifications: [], emails: [] };

    case "rescheduled": {
      const key = followUpEventDedupeKey("rescheduled", ctx.followUpCode, ctx.scheduledAt);
      const from = ctx.previousScheduledAt ?? "its previous time";
      const notif: NotificationPlan = {
        recipientUserId: ctx.ownerUserId,
        type: "followup.rescheduled",
        title: `Follow-up rescheduled — ${ctx.customerName}`,
        message: `${ctx.followUpCode} moved from ${from} to ${ctx.scheduledAt}.`,
        relatedEntityType: "follow_up",
        relatedEntityCode: ctx.followUpCode,
        dedupeKey: key,
        metadata: { follow_up_id: ctx.followUpId, from, to: ctx.scheduledAt },
      };
      const email: EmailPlan = {
        template: "FOLLOW_UP_RESCHEDULED",
        toUserId: ctx.ownerUserId,
        payload: {
          recipient_name: ctx.ownerName ?? "",
          follow_up_code: ctx.followUpCode,
          customer_name: ctx.customerName,
          from,
          to: ctx.scheduledAt,
          reason: ctx.reason ?? "",
        },
        relatedEntityType: "follow_up",
        relatedEntityCode: ctx.followUpCode,
        dedupeKey: emailDedupeKey(key),
      };
      return { notifications: [notif], emails: [email] };
    }

    case "completed":
    case "cancelled": {
      const key = followUpEventDedupeKey(kind, ctx.followUpCode, ctx.scheduledAt);
      const verb = kind === "completed" ? "completed" : "cancelled";
      return {
        notifications: [
          {
            recipientUserId: ctx.ownerUserId,
            type: `followup.${verb}`,
            title: `Follow-up ${verb} — ${ctx.customerName}`,
            message: `${ctx.followUpCode} was ${verb}.`,
            relatedEntityType: "follow_up",
            relatedEntityCode: ctx.followUpCode,
            dedupeKey: key,
            metadata: { follow_up_id: ctx.followUpId, occurrence: ctx.scheduledAt },
          },
        ],
        emails: [], // terminating a follow-up does not warrant an email
      };
    }

    case "converted": {
      const leadCode = ctx.leadCode ?? "the new lead";
      const ownerKey = followUpEventDedupeKey("converted", ctx.followUpCode, ctx.scheduledAt);
      const notifications: NotificationPlan[] = [
        {
          recipientUserId: ctx.ownerUserId,
          type: "followup.converted",
          title: `Follow-up converted — ${ctx.customerName}`,
          message: `${ctx.followUpCode} became lead ${leadCode}.`,
          relatedEntityType: "lead",
          relatedEntityCode: ctx.leadCode ?? ctx.followUpCode,
          dedupeKey: ownerKey,
          metadata: {
            follow_up_id: ctx.followUpId,
            lead_id: ctx.leadId ?? null,
            occurrence: ctx.scheduledAt,
          },
        },
      ];
      const emails: EmailPlan[] = [];

      const closerUserId = ctx.responsibleCloserUserId ?? null;
      if (closerUserId != null && closerUserId !== ctx.ownerUserId && ctx.leadCode) {
        const assignKey = notificationDedupeKey("lead.assigned", ctx.leadCode, closerUserId);
        notifications.push({
          recipientUserId: closerUserId,
          type: "lead.assigned",
          title: `Lead assigned — ${ctx.customerName}`,
          message: `${ctx.leadCode} is now assigned to you (from ${ctx.followUpCode}).`,
          relatedEntityType: "lead",
          relatedEntityCode: ctx.leadCode,
          dedupeKey: assignKey,
          metadata: { lead_id: ctx.leadId ?? null, from_follow_up: ctx.followUpCode },
        });
        emails.push({
          template: "LEAD_ASSIGNED",
          toUserId: closerUserId,
          payload: {
            recipient_name: ctx.responsibleCloserName ?? "",
            lead_code: ctx.leadCode,
            customer_name: ctx.customerName,
            source: ctx.source ?? "conversion",
          },
          relatedEntityType: "lead",
          relatedEntityCode: ctx.leadCode,
          dedupeKey: emailDedupeKey(assignKey),
        });
      }
      return { notifications, emails };
    }

    default:
      return EMPTY;
  }
}
