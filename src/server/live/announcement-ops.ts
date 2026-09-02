/**
 * Officeverse — ANNOUNCEMENT COMMAND CENTER · Operations service (Phase 10
 * Stage 2). Server-side only.
 *
 *   Admin / Operations-Manager → create · edit · enable · disable · PREVIEW ·
 *   PLAY ON TV · view history
 *
 * PREVIEW resolves the full airport-style sequence WITHOUT any side effect — no
 * bus event, no `office_tv_events` row, no ledger row, no production audit.
 * PLAY ON TV publishes ONE `"announcement"` moment onto the EXISTING recognition
 * bus (the bus already carries that type) so the token-authenticated Office TV
 * picks it up on its next poll — the client never mutates the TV DB, the TV
 * stays read-only, display-token security is untouched.
 *
 * PRESENTATION ONLY. No BusinessEvent, no scoring, no points, no payroll /
 * salary / incentive money. Every mutation/action is audited with the
 * server-session actor.
 */
import type { User } from "@/lib/db/schema";
import { isDbConfigured } from "@/lib/db";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { assertCanRunOperations } from "../authz/operations";
import * as repo from "../db/repos/office-tv";
import { recognitionBus } from "./bus";
import {
  buildAnnouncementBusPayload,
  buildSpokenText,
  normalizeAnnouncementAudio,
} from "./announcement-audio";
import { celebrationPayloadForProfileId } from "./celebration-profile-service";

type Meta = { ip?: string | null; userAgent?: string | null };
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
const asJson = (v: unknown): JsonValue => (v ?? null) as JsonValue;

async function resolvePayload(
  id: number,
  opts: {
    preview: boolean;
    source: "operator" | "power_hour" | "milestone";
    fields?: { employeeName?: string | null; points?: number | null; headline?: string | null };
  },
): Promise<Record<string, unknown>> {
  const row = await repo.getAnnouncement(id);
  if (!row) throw new HttpError(404, "Announcement not found", "not_found");
  const audio = normalizeAnnouncementAudio({
    ttsEnabled: row.ttsEnabled,
    ttsConfig: row.ttsConfig,
    openingSound: row.openingSound,
    closingSound: row.closingSound,
  });
  const spokenText = audio.ttsEnabled ? buildSpokenText(row.message, opts.fields ?? {}) : "";
  const celebration = row.celebrationProfileId
    ? await celebrationPayloadForProfileId(row.celebrationProfileId, {
        employeeName: null,
        headline: row.title,
        points: null,
      })
    : null;
  return buildAnnouncementBusPayload({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle ?? null,
    message: row.message,
    effect: row.effect ?? null,
    priority: row.priority,
    durationMs: row.durationMs,
    audio,
    spokenText,
    celebration,
    preview: opts.preview,
    source: opts.source,
  });
}

/**
 * PREVIEW — the exact payload the Office TV would receive, so the builder can
 * run the whole opening-sound → pause → TTS → optional celebration → closing
 * sound sequence locally. Never publishes, never audits a production action.
 */
export async function previewAnnouncement(
  actor: Pick<User, "id" | "role">,
  id: number,
): Promise<{ payload: JsonValue }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const payload = await resolvePayload(id, { preview: true, source: "operator" });
  return { payload: asJson(payload) };
}

/**
 * PLAY ON TV — an explicit operator action. It MAY be repeated (unlike an
 * automatic business-event announcement, which is idempotent on its dedupe key).
 * Publishes one moment onto the existing bus; writes no TV DB row directly.
 */
export async function playAnnouncementNow(
  actor: Pick<User, "id" | "role">,
  id: number,
  meta: Meta = {},
): Promise<{ ok: true; seq: number }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const payload = await resolvePayload(id, { preview: false, source: "operator" });
  const published = recognitionBus.publish("announcement", payload);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "ANNOUNCEMENT_PLAYED",
    entityType: "office_tv_announcement",
    entityId: id,
    metadata: {
      seq: published.seq,
      priority: payload["priority"],
      ttsEnabled: (payload["audio"] as { ttsEnabled?: boolean }).ttsEnabled ?? false,
      openingSound: (payload["audio"] as { openingSound?: string }).openingSound ?? "none",
      closingSound: (payload["audio"] as { closingSound?: string }).closingSound ?? "none",
      hasCelebration: payload["celebration"] != null,
      source: "operator",
      success: true,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, seq: published.seq };
}

/**
 * Power Hour reuses this exact path — one announcement moment on the bus when a
 * Power Hour starts (opening bell → "Power Hour is now active" → closing bell).
 * It is NOT a second announcement subsystem and it changes NO scoring behaviour.
 * Called from `power-hour.ts::startPowerHour`.
 */
export async function firePowerHourAnnouncement(
  actor: Pick<User, "id" | "role">,
  announcementId: number,
  meta: Meta = {},
): Promise<{ ok: true; seq: number } | { ok: false }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) return { ok: false };
  const payload = await resolvePayload(announcementId, {
    preview: false,
    source: "power_hour",
  }).catch(() => null);
  if (!payload) return { ok: false };
  const published = recognitionBus.publish("announcement", payload);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "POWER_HOUR_ANNOUNCEMENT_TRIGGERED",
    entityType: "office_tv_announcement",
    entityId: announcementId,
    metadata: { seq: published.seq, source: "power_hour", success: true },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, seq: published.seq };
}

/**
 * Phase 10 Stage 4 — a MILESTONE may optionally also play an announcement (bell
 * → TTS → optional celebration → closing bell). Internal engine call — no
 * operator actor, no separate audit row (the `MILESTONE_TRIGGERED` audit
 * records `announcementId` + the bus seq). Best-effort; never throws.
 */
export async function fireMilestoneAnnouncement(
  announcementId: number,
  fields: { employeeName?: string | null; points?: number | null; headline?: string | null },
): Promise<number | null> {
  if (!isDbConfigured()) return null;
  const payload = await resolvePayload(announcementId, {
    preview: false,
    source: "milestone",
    fields,
  }).catch(() => null);
  if (!payload) return null;
  return recognitionBus.publish("announcement", payload).seq;
}
