/**
 * Officeverse — client-safe notification DTO (Phase 5).
 *
 * The numeric `id` IS exposed here (unlike Lead/Follow-up DTOs) because a
 * notification has no business code and the id is the handle the bell UI needs
 * to mark a row read. `recipientUserId`, `metadata` and the raw numeric
 * `relatedEntityId` are NOT exposed.
 */
import { wallToIstIso } from "../time";
import type { Notification } from "@/lib/db/schema";

export interface NotificationDTO {
  id: number;
  type: string;
  title: string;
  message: string;
  related_entity_type: string | null;
  related_entity_code: string | null;
  unread: boolean;
  read_at: string | null;
  created_at: string;
}

export function toNotificationDTO(n: Notification): NotificationDTO {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    related_entity_type: n.relatedEntityType ?? null,
    related_entity_code: n.relatedEntityCode ?? null,
    unread: n.readAt == null,
    read_at: n.readAt ? wallToIstIso(n.readAt) : null,
    created_at: wallToIstIso(n.createdAt),
  };
}
