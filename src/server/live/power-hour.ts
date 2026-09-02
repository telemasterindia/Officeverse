/**
 * Officeverse — POWER HOUR · Operations control (Phase 6.5).
 *
 * A Power Hour is a time-boxed team-performance window shown on the Office TV.
 * It is NOT a new scoring subsystem and NOT a new table — it is an EXISTING
 * `office_tv_announcements` row, marked `effect = "POWERHOUR"`, whose
 * `publishAt` / `expiresAt` are the window start / end.
 *
 * If a Power Hour should also affect points, the Operations Manager creates a
 * normal SCORING RULE (existing engine) with a matching `effectiveFrom` — the
 * two are audited independently and never hard-wired together here.
 *
 * Every mutation delegates to the existing announcement service (which does its
 * own authorization + audit) and then records a dedicated POWER_HOUR_* audit
 * row with before / after snapshots.
 */
import type { User } from "@/lib/db/schema";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { assertCanRunOperations } from "../authz/operations";
import {
  createAnnouncement,
  listAnnouncements,
  publishAnnouncementNow,
  stopAnnouncement,
  type AnnouncementDTO,
} from "./service";
import { firePowerHourAnnouncement } from "./announcement-ops";

type Meta = { ip?: string | null; userAgent?: string | null };

/** marker stored in the reused `office_tv_announcements.effect` column */
export const POWER_HOUR_EFFECT = "POWERHOUR";

const DT_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;

export interface PowerHourDTO {
  id: number;
  title: string;
  message: string;
  audience: string;
  process: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  priority: string;
  createdAt: string;
}

function toPowerHour(a: AnnouncementDTO): PowerHourDTO {
  return {
    id: a.id,
    title: a.title,
    message: a.message,
    audience: a.audience,
    process: a.process,
    startsAt: a.publishAt ?? null,
    endsAt: a.expiresAt ?? null,
    status: a.status,
    priority: a.priority,
    createdAt: a.createdAt,
  };
}

export async function listPowerHours(
  actor: Pick<User, "role">,
): Promise<{ dbUnavailable?: boolean; rows: PowerHourDTO[] }> {
  assertCanRunOperations(actor.role);
  const res = await listAnnouncements(actor);
  if (res.dbUnavailable) return { dbUnavailable: true, rows: [] };
  return { rows: res.rows.filter((a) => a.effect === POWER_HOUR_EFFECT).map(toPowerHour) };
}

export interface CreatePowerHourInput {
  title: string;
  message: string;
  /** IST wall-clock "YYYY-MM-DD HH:MM[:SS]" */
  startsAt: string;
  endsAt: string;
  audience?: "all" | "agents" | "closers";
  process?: "US" | "UK" | "IN" | "AU" | null;
}

export async function createPowerHour(
  actor: Pick<User, "id" | "role">,
  input: CreatePowerHourInput,
  meta: Meta = {},
): Promise<{ ok: true; id: number; status: string }> {
  assertCanRunOperations(actor.role);
  if (!DT_RE.test(input.startsAt) || !DT_RE.test(input.endsAt)) {
    throw new HttpError(400, "startsAt / endsAt must be 'YYYY-MM-DD HH:MM'", "bad_window");
  }
  if (input.endsAt <= input.startsAt) {
    throw new HttpError(400, "endsAt must be after startsAt", "bad_window");
  }

  const res = await createAnnouncement(
    actor,
    {
      title: input.title,
      message: input.message,
      effect: POWER_HOUR_EFFECT,
      priority: "IMPORTANT",
      audience: input.audience ?? "all",
      ...(input.process != null ? { process: input.process } : {}),
      publishAt: input.startsAt,
      expiresAt: input.endsAt,
      publishNow: false,
    },
    meta,
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "POWER_HOUR_CREATED",
    entityType: "power_hour",
    entityId: res.id,
    metadata: {
      before: null,
      after: {
        title: input.title,
        window: { startsAt: input.startsAt, endsAt: input.endsAt },
        audience: input.audience ?? "all",
        process: input.process ?? null,
        status: res.status,
      },
      success: true,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, id: res.id, status: res.status };
}

export async function startPowerHour(
  actor: Pick<User, "id" | "role">,
  id: number,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanRunOperations(actor.role);
  await publishAnnouncementNow(actor, id, meta);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "POWER_HOUR_STARTED",
    entityType: "power_hour",
    entityId: id,
    metadata: { before: { status: "scheduled" }, after: { status: "published" }, success: true },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  // Fire ONE announcement moment on the existing bus (opening bell → TTS →
  // closing bell). Best-effort — a bus/audio failure never blocks the start,
  // and this changes NO scoring behaviour.
  await firePowerHourAnnouncement(actor, id, meta).catch(() => undefined);
  return { ok: true };
}

export async function stopPowerHour(
  actor: Pick<User, "id" | "role">,
  id: number,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanRunOperations(actor.role);
  await stopAnnouncement(actor, id, meta);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "POWER_HOUR_STOPPED",
    entityType: "power_hour",
    entityId: id,
    metadata: { before: { status: "published" }, after: { status: "stopped" }, success: true },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}
