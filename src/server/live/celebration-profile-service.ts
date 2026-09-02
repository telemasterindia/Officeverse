/**
 * Officeverse — CELEBRATION PROFILE · Operations service (Phase 10).
 *
 * Admin + Closer (Operations Manager) compose recognition effects into named
 * profiles, enable / disable them, PREVIEW them safely, and PLAY one on the
 * Office TV on demand. Every mutation is written to the immutable audit log with
 * the server-session actor.
 *
 *   CRM EVENT → SCORING → LEDGER → PERFORMANCE → INCENTIVE
 *             → RECOGNITION EVENT → [ CELEBRATION PROFILE (this) ] → OFFICE TV
 *
 * PRESENTATION ONLY. No BusinessEvent, no scoring, no points ledger row, no
 * `office_tv_events` row on preview/play, no payroll / salary / incentive money.
 */
import type { User } from "@/lib/db/schema";
import { isDbConfigured } from "@/lib/db";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { nowIST } from "../time";
import { assertCanRunOperations } from "../authz/operations";
import * as repo from "../db/repos/celebration-profile";
import { recognitionBus } from "./bus";
import {
  PROFILE_LEVELS,
  PROFILE_TRIGGERS,
  buildCelebrationPayload,
  normalizeProfileConfig,
  validateProfileConfig,
  type CelebrationProfileConfig,
  type ProfileLevel,
  type ProfileTrigger,
} from "./celebration-profile";

type Meta = { ip?: string | null; userAgent?: string | null };
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
const asJson = (v: unknown): JsonValue => (v ?? null) as JsonValue;

export interface ProfileDraft {
  name: string;
  description?: string | null;
  recognitionLevel: ProfileLevel;
  /** null / "MANUAL" → only playable via "Celebrate now" */
  triggerEvent?: ProfileTrigger | null;
  priority?: number;
  config: unknown;
}

export function validateProfileDraft(d: ProfileDraft): string[] {
  const errs: string[] = [];
  if (typeof d.name !== "string" || d.name.trim().length === 0 || d.name.length > 120)
    errs.push("name_invalid");
  if (!(PROFILE_LEVELS as readonly string[]).includes(d.recognitionLevel))
    errs.push("recognition_level_invalid");
  if (d.triggerEvent != null && !(PROFILE_TRIGGERS as readonly string[]).includes(d.triggerEvent))
    errs.push("trigger_invalid");
  if (
    d.priority !== undefined &&
    (!Number.isInteger(d.priority) || d.priority < 0 || d.priority > 100_000)
  )
    errs.push("priority_out_of_range");
  errs.push(...validateProfileConfig(d.config).map((e) => `config:${e}`));
  return errs;
}

export interface ProfileDTO {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  recognitionLevel: string;
  triggerEvent: string | null;
  priority: number;
  config: CelebrationProfileConfig;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

function toDTO(r: Awaited<ReturnType<typeof repo.getProfile>>): ProfileDTO {
  const row = r!;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    enabled: row.enabled,
    recognitionLevel: row.recognitionLevel,
    triggerEvent: row.triggerEvent ?? null,
    priority: row.priority,
    config: normalizeProfileConfig(row.config),
    createdByUserId: row.createdByUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listCelebrationProfiles(
  actor: Pick<User, "role">,
): Promise<{ dbUnavailable?: boolean; profiles: ProfileDTO[] }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, profiles: [] };
  const rows = await repo.listProfiles();
  return { profiles: rows.map((r) => toDTO(r)) };
}

export async function createCelebrationProfile(
  actor: Pick<User, "id" | "role">,
  draft: ProfileDraft,
  meta: Meta = {},
): Promise<{ id: number }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const errs = validateProfileDraft(draft);
  if (errs.length)
    throw new HttpError(400, `Invalid profile: ${errs.join(", ")}`, "invalid_profile");
  const now = nowIST();
  const config = normalizeProfileConfig(draft.config);
  const id = await repo.insertProfile({
    name: draft.name.trim().slice(0, 120),
    description: draft.description?.trim().slice(0, 400) ?? null,
    enabled: false, // always created disabled — enable after a preview
    recognitionLevel: draft.recognitionLevel,
    triggerEvent: (draft.triggerEvent ?? null) as never,
    priority: draft.priority ?? 100,
    config: config as never,
    createdByUserId: actor.id,
    createdAt: now,
    updatedAt: now,
  });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "CELEBRATION_PROFILE_CREATED",
    entityType: "celebration_profile",
    entityId: id,
    metadata: {
      before: null,
      after: {
        name: draft.name,
        recognitionLevel: draft.recognitionLevel,
        triggerEvent: draft.triggerEvent ?? null,
        priority: draft.priority ?? 100,
        effects: config.effects,
      },
      success: true,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { id };
}

export async function updateCelebrationProfile(
  actor: Pick<User, "id" | "role">,
  id: number,
  draft: ProfileDraft,
  meta: Meta = {},
): Promise<{ id: number }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const errs = validateProfileDraft(draft);
  if (errs.length)
    throw new HttpError(400, `Invalid profile: ${errs.join(", ")}`, "invalid_profile");
  const existing = await repo.getProfile(id);
  if (!existing) throw new HttpError(404, "Profile not found", "not_found");
  const now = nowIST();
  const config = normalizeProfileConfig(draft.config);
  await repo.updateProfile(id, {
    name: draft.name.trim().slice(0, 120),
    description: draft.description?.trim().slice(0, 400) ?? null,
    recognitionLevel: draft.recognitionLevel,
    triggerEvent: (draft.triggerEvent ?? null) as never,
    priority: draft.priority ?? existing.priority,
    config: config as never,
    updatedAt: now,
  });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "CELEBRATION_PROFILE_UPDATED",
    entityType: "celebration_profile",
    entityId: id,
    metadata: {
      before: {
        name: existing.name,
        recognitionLevel: existing.recognitionLevel,
        triggerEvent: existing.triggerEvent ?? null,
        priority: existing.priority,
      },
      after: {
        name: draft.name,
        recognitionLevel: draft.recognitionLevel,
        triggerEvent: draft.triggerEvent ?? null,
        priority: draft.priority ?? existing.priority,
        effects: config.effects,
      },
      success: true,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { id };
}

export async function setCelebrationProfileEnabled(
  actor: Pick<User, "id" | "role">,
  id: number,
  enabled: boolean,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const existing = await repo.getProfile(id);
  if (!existing) throw new HttpError(404, "Profile not found", "not_found");
  await repo.updateProfile(id, { enabled, updatedAt: nowIST() });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: enabled ? "CELEBRATION_PROFILE_ENABLED" : "CELEBRATION_PROFILE_DISABLED",
    entityType: "celebration_profile",
    entityId: id,
    metadata: { before: { enabled: existing.enabled }, after: { enabled }, success: true },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

/**
 * PREVIEW — resolve a profile to the exact renderer payload WITHOUT publishing.
 * No bus event, no audit noise, no records: it just returns what the Office TV
 * *would* render so the builder can show it inline.
 */
export async function previewCelebrationProfile(
  actor: Pick<User, "id" | "role">,
  id: number,
): Promise<{ payload: JsonValue }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const row = await repo.getProfile(id);
  if (!row) throw new HttpError(404, "Profile not found", "not_found");
  const cfg = normalizeProfileConfig(row.config);
  const payload = buildCelebrationPayload({
    config: cfg,
    level: row.recognitionLevel as ProfileLevel,
    kind: row.triggerEvent ?? "PREVIEW",
    employeeName: "Preview Employee",
    employeePhotoRef: null,
    headline: cfg.achievementText ?? (row.triggerEvent ?? "PREVIEW").replace(/_/g, " "),
    points: cfg.show.points ? 500 : 0,
  });
  return { payload: asJson({ ...payload, preview: true }) };
}

export interface PlayProfileInput {
  id: number;
  /** display name to show; falls back to the actor */
  employeeName?: string | null;
  headline?: string | null;
}

/**
 * PLAY ON TV — publish ONE synthetic celebration to the EXISTING recognition
 * bus so the Office TV plays this profile on its next poll. No BusinessEvent, no
 * dispatcher, no scoring, no `office_tv_events` row, no ledger row. `points` is
 * always demonstration-only (0) — this screen never creates points.
 */
export async function playCelebrationProfile(
  actor: Pick<User, "id" | "role" | "fullName">,
  input: PlayProfileInput,
  meta: Meta = {},
): Promise<{ ok: true; seq: number }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const row = await repo.getProfile(input.id);
  if (!row) throw new HttpError(404, "Profile not found", "not_found");
  const cfg = normalizeProfileConfig(row.config);
  const name = (input.employeeName ?? actor.fullName ?? "Officeverse")
    .toString()
    .trim()
    .slice(0, 80);
  const headline = (input.headline ?? cfg.achievementText ?? row.triggerEvent ?? "CELEBRATION")
    .toString()
    .replace(/_/g, " ")
    .trim()
    .slice(0, 60);
  const profilePayload = buildCelebrationPayload({
    config: cfg,
    level: row.recognitionLevel as ProfileLevel,
    kind: "CELEBRATION_PROFILE_PLAY",
    employeeName: name,
    employeePhotoRef: null,
    headline,
    points: 0,
  });
  const published = recognitionBus.publish("celebration", {
    kind: "CELEBRATION_PROFILE_PLAY",
    tier: 1,
    effect: "ENERGY",
    assetCategory: "none",
    assetId: null,
    hasVideo: false,
    durationMs: cfg.durationMs,
    headline,
    subheadline: `Operations · profile "${row.name}" — not a real recognition`,
    celebrationLevel: row.recognitionLevel,
    celebrationProfile: profilePayload,
    points: 0,
    subject: { userId: actor.id, name, role: actor.role, photoAvailable: false },
  });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "CELEBRATION_PLAYED",
    entityType: "celebration_profile",
    entityId: row.id,
    metadata: {
      profileId: row.id,
      profileName: row.name,
      seq: published.seq,
      viaProfile: true,
      demo: true,
      success: true,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, seq: published.seq };
}

/* ------------------- recognition-bridge integration ------------------- */

/**
 * Resolve ONE celebration profile (by id) to its renderer payload — used by the
 * Announcement Command Center to attach an optional mid-sequence visual. Total —
 * never throws; returns null when the id is unknown / DB unavailable.
 */
export async function celebrationPayloadForProfileId(
  id: number,
  ctx: { employeeName: string | null; headline: string | null; points: number | null },
): Promise<Record<string, unknown> | null> {
  if (!isDbConfigured()) return null;
  try {
    const row = await repo.getProfile(id);
    if (!row) return null;
    const cfg = normalizeProfileConfig(row.config);
    return buildCelebrationPayload({
      config: cfg,
      level: row.recognitionLevel as ProfileLevel,
      kind: "ANNOUNCEMENT",
      employeeName: ctx.employeeName,
      employeePhotoRef: null,
      headline: ctx.headline ?? cfg.achievementText ?? row.name,
      points: ctx.points,
    });
  } catch {
    return null;
  }
}

/**
 * The enabled profile that should render for `triggerEvent`, or null. Total —
 * never throws, returns null when the DB is unavailable so the bridge falls
 * back to the frozen `decideCelebration()` default (no behaviour change when no
 * profile exists).
 */
export async function pickCelebrationProfileForTrigger(
  triggerEvent: string,
): Promise<{ level: ProfileLevel; config: CelebrationProfileConfig; name: string } | null> {
  if (!isDbConfigured()) return null;
  try {
    const rows = await repo.listEnabledProfilesForTrigger(triggerEvent);
    const chosen = rows[0];
    if (!chosen) return null;
    return {
      level: chosen.recognitionLevel as ProfileLevel,
      config: normalizeProfileConfig(chosen.config),
      name: chosen.name,
    };
  } catch {
    return null;
  }
}
