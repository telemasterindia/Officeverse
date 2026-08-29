/**
 * Officeverse — follow-up event integration (Phase 5).
 *
 * Turns a follow-up lifecycle event that ALREADY happened into persisted
 * in-app notifications + queued email JOBS. Called by the follow-up service
 * AFTER its transaction commits.
 *
 * BEST-EFFORT: a failure here (including a dedupe collision) must never roll
 * back or fail the underlying follow-up mutation. Everything is wrapped; on
 * error we log a short, secret-free warning and move on.
 *
 * This module enqueues WORK. It never sends email and never schedules timers.
 */
import { recordAudit, type AuditActorRole } from "../audit";
import { loadUserContacts } from "../db/repos/users";
import { createNotifications } from "./service";
import { enqueueEmails, type EnqueueEmailInput } from "../email/service";
import { planFollowUpEvent, type FollowUpEventContext, type FollowUpEventKind } from "./event-plan";

export interface EmitFollowUpEventInput {
  kind: FollowUpEventKind;
  followUpCode: string;
  followUpId: number;
  ownerUserId: number;
  scheduledAt: string;
  previousScheduledAt?: string | null;
  customerName: string;
  comment?: string | null;
  reason?: string | null;
  /* conversion only */
  leadCode?: string | null;
  leadId?: number | null;
  responsibleCloserUserId?: number | null;
  source?: string | null;
  /* audit context */
  actorUserId?: number | null;
  actorRole?: AuditActorRole | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Plan + persist notifications/email jobs for a follow-up event. Never throws.
 * Returns a small summary (handy for tests / future observability).
 */
export async function emitFollowUpEvent(
  input: EmitFollowUpEventInput,
): Promise<{ notifications: number; emails: number; ok: boolean }> {
  try {
    const ids = [input.ownerUserId];
    if (input.responsibleCloserUserId != null) ids.push(input.responsibleCloserUserId);
    const contacts = await loadUserContacts(ids);

    const ctx: FollowUpEventContext = {
      followUpCode: input.followUpCode,
      followUpId: input.followUpId,
      ownerUserId: input.ownerUserId,
      ownerName: contacts.get(input.ownerUserId)?.fullName ?? null,
      scheduledAt: input.scheduledAt,
      previousScheduledAt: input.previousScheduledAt ?? null,
      customerName: input.customerName,
      comment: input.comment ?? null,
      reason: input.reason ?? null,
      leadCode: input.leadCode ?? null,
      leadId: input.leadId ?? null,
      responsibleCloserUserId: input.responsibleCloserUserId ?? null,
      responsibleCloserName:
        input.responsibleCloserUserId != null
          ? (contacts.get(input.responsibleCloserUserId)?.fullName ?? null)
          : null,
      source: input.source ?? null,
    };

    const plan = planFollowUpEvent(input.kind, ctx);

    let insertedNotifs = 0;
    if (plan.notifications.length) {
      const r = await createNotifications(
        plan.notifications.map((n) => ({
          recipientUserId: n.recipientUserId,
          type: n.type,
          title: n.title,
          message: n.message,
          relatedEntityType: n.relatedEntityType,
          relatedEntityCode: n.relatedEntityCode,
          dedupeKey: n.dedupeKey,
          metadata: n.metadata,
        })),
      );
      insertedNotifs = r.inserted;
    }

    let insertedEmails = 0;
    const emailInputs: EnqueueEmailInput[] = [];
    for (const e of plan.emails) {
      const to = contacts.get(e.toUserId);
      if (!to?.email) continue; // cannot address it — skip silently
      emailInputs.push({
        template: e.template,
        toEmail: to.email,
        toName: to.fullName,
        toUserId: e.toUserId,
        payload: e.payload,
        relatedEntityType: e.relatedEntityType,
        relatedEntityCode: e.relatedEntityCode,
        dedupeKey: e.dedupeKey,
      });
    }
    if (emailInputs.length) {
      insertedEmails = (await enqueueEmails(emailInputs)).inserted;
    }

    if (plan.notifications.length || plan.emails.length) {
      await recordAudit({
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole ?? "system",
        action: "followup.notifications_enqueued",
        entityType: "follow_up",
        entityId: input.followUpId,
        entityCode: input.followUpCode,
        metadata: {
          event: input.kind,
          notifications_planned: plan.notifications.length,
          notifications_inserted: insertedNotifs,
          emails_planned: plan.emails.length,
          emails_inserted: insertedEmails,
        },
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      });
    }

    return { notifications: insertedNotifs, emails: insertedEmails, ok: true };
  } catch (err) {
    // Never let notification plumbing break a committed follow-up mutation.
    console.warn(
      `[notifications] emitFollowUpEvent(${input.kind}) failed for ${input.followUpCode}: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    );
    return { notifications: 0, emails: 0, ok: false };
  }
}
