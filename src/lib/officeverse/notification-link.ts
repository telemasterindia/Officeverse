/**
 * Officeverse — safe navigation target for a DB notification (Phase 6).
 *
 * PURE. Never builds an arbitrary URL from server/client data: the related
 * entity CODE is validated against its known shape before a route is returned.
 * An unknown type, a missing code, or a malformed code → `null` (the UI then
 * renders the notification normally with the navigation action disabled).
 */

export interface LinkableNotification {
  related_entity_type: string | null;
  related_entity_code: string | null;
}

export type NotificationHref =
  | { to: "/leads/$leadId"; params: { leadId: string } }
  | { to: "/followups/$followUpId"; params: { followUpId: string } }
  | null;

const LEAD_CODE = /^TMI_\d{8}$/;
const FOLLOW_UP_CODE = /^FU_\d{8}$/;

export function notificationHref(n: LinkableNotification): NotificationHref {
  const code = n.related_entity_code?.trim() ?? "";
  if (!code) return null;

  switch (n.related_entity_type) {
    case "lead":
      return LEAD_CODE.test(code) ? { to: "/leads/$leadId", params: { leadId: code } } : null;
    case "follow_up":
      return FOLLOW_UP_CODE.test(code)
        ? { to: "/followups/$followUpId", params: { followUpId: code } }
        : null;
    default:
      // system / unknown → no navigation
      return null;
  }
}

/** Convenience for components: is this notification clickable? */
export function isNotificationLinkable(n: LinkableNotification): boolean {
  return notificationHref(n) !== null;
}
