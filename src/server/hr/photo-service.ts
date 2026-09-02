/**
 * Officeverse — profile-photo service (Phase 19).
 *
 * Stores ONE real photo per user in `staff_photos` (bytes in the private photo
 * store, metadata in the row) and points `users.photo_asset_id` at it. Replace
 * deletes the previous blob + row; remove nulls the pointer. The stored bytes
 * are the ORIGINAL as uploaded — the visual effects engine is a client display
 * layer and never round-trips through here.
 *
 * No payroll / HR / points impact whatsoever.
 */
import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { staffPhotos, users } from "@/lib/db/schema";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { config } from "../env";
import { nowIST } from "../time";
import { getUserById } from "../db/repos/users";
import { assertCanManagePhotoFor, isPhotoManager, resolvePhotoTarget } from "../authz/photo";
import { safePhotoKey, validatePhotoUpload, type PhotoMime } from "./photo";
import { getPhotoStore } from "./photo-storage";
import type { User } from "@/lib/db/schema";

type Meta = { ip?: string | null; userAgent?: string | null };

export interface PhotoMetaDTO {
  userId: number;
  hasPhoto: boolean;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  updatedAt: string | null;
}

function metaDTO(
  userId: number,
  row?: {
    mime: string | null;
    bytes: number | null;
    width: number | null;
    height: number | null;
    createdAt: string;
  },
): PhotoMetaDTO {
  return {
    userId,
    hasPhoto: Boolean(row),
    mime: row?.mime ?? null,
    bytes: row?.bytes ?? null,
    width: row?.width ?? null,
    height: row?.height ?? null,
    updatedAt: row?.createdAt ?? null,
  };
}

async function currentPhotoRow(userId: number) {
  const db = getDb();
  const u = await db
    .select({ photoAssetId: users.photoAssetId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const assetId = u[0]?.photoAssetId ?? null;
  if (assetId) {
    const rows = await db.select().from(staffPhotos).where(eq(staffPhotos.id, assetId)).limit(1);
    if (rows[0]) return rows[0];
  }
  // Self-heal: the pointer is missing / stale (e.g. a 0 written by an older
  // build) but a real upload exists — fall back to this user's latest photo row.
  const latest = await db
    .select()
    .from(staffPhotos)
    .where(eq(staffPhotos.userId, userId))
    .orderBy(desc(staffPhotos.id))
    .limit(1);
  return latest[0] ?? null;
}

/* ------------------------------ set ------------------------------ */

export interface SetPhotoInput {
  /** requested target — only honoured for Admin / HR, else forced to self */
  targetUserId?: number | null | undefined;
  /** raw image bytes (client already cropped / resized / compressed) */
  bytes: Uint8Array;
}

export async function setProfilePhoto(
  actor: Pick<User, "id" | "role">,
  input: SetPhotoInput,
  meta: Meta = {},
): Promise<{ ok: true; photo: PhotoMetaDTO }> {
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  // UAT #1: the official employee photo is an HR record — only Admin / HR may
  // set or replace it. Agents / Closers can VIEW their photo but not change it.
  if (!isPhotoManager(actor.role)) {
    throw new HttpError(
      403,
      "Your profile photo is managed by HR / Admin — please contact them to update it.",
      "forbidden",
    );
  }
  const targetUserId = resolvePhotoTarget(actor.role, actor.id, input.targetUserId ?? null);
  assertCanManagePhotoFor(actor.role, actor.id, targetUserId);

  const v = validatePhotoUpload(input.bytes, { maxBytes: config.photoMaxBytes() });
  if (!v.ok) throw new HttpError(422, v.reason, `photo_${v.code}`);

  const target = await getUserById(targetUserId);
  if (!target) throw new HttpError(404, "Employee not found", "not_found");

  const db = getDb();
  const store = getPhotoStore();
  const prev = await currentPhotoRow(targetUserId);

  const version = 1 + (prev ? Number((prev.path.match(/\/v(\d+)\./) ?? [])[1] ?? 1) : 0);
  const key = safePhotoKey(targetUserId, v.mime as PhotoMime, version);
  await store.put(key, input.bytes);

  const now = nowIST();
  // Drizzle mysql2 returns [ResultSetHeader, …] from .values() — reading
  // `.insertId` off that array yields undefined (→ 0). `.$returningId()` gives
  // the real new PK: [{ id: N }].
  const inserted = await db
    .insert(staffPhotos)
    .values({
      userId: targetUserId,
      storage: "local",
      path: key,
      url: null,
      mime: v.mime,
      bytes: v.bytes,
      width: v.width,
      height: v.height,
      uploadedByUserId: actor.id,
      createdAt: now,
    })
    .$returningId();
  const newId = Number(inserted[0]?.id ?? 0);
  if (!newId)
    throw new HttpError(500, "Could not persist the photo record", "photo_persist_failed");

  await db
    .update(users)
    .set({ photoAssetId: newId, updatedAt: now })
    .where(eq(users.id, targetUserId));

  // "one real photo per user" — drop every OTHER row (+ its blob) for this
  // user, self-correcting any orphans left by an older build.
  const stale = await db
    .select({ id: staffPhotos.id, path: staffPhotos.path })
    .from(staffPhotos)
    .where(eq(staffPhotos.userId, targetUserId));
  for (const s of stale) {
    if (s.id === newId) continue;
    if (s.path !== key) await store.deleteKey(s.path).catch(() => undefined);
    await db.delete(staffPhotos).where(eq(staffPhotos.id, s.id));
  }

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "profile_photo.set",
    entityType: "user",
    entityId: targetUserId,
    metadata: {
      self: targetUserId === actor.id,
      mime: v.mime,
      bytes: v.bytes,
      dimensions: `${v.width}x${v.height}`,
      replaced: Boolean(prev),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return {
    ok: true,
    photo: metaDTO(targetUserId, {
      mime: v.mime,
      bytes: v.bytes,
      width: v.width,
      height: v.height,
      createdAt: now,
    }),
  };
}

/* ---------------------------- remove --------------------------- */

export async function removeProfilePhoto(
  actor: Pick<User, "id" | "role">,
  requestedUserId: number | null | undefined,
  meta: Meta = {},
): Promise<{ ok: true; photo: PhotoMetaDTO }> {
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  // UAT #1: only Admin / HR may remove the official employee photo.
  if (!isPhotoManager(actor.role)) {
    throw new HttpError(
      403,
      "Your profile photo is managed by HR / Admin — please contact them to update it.",
      "forbidden",
    );
  }
  const targetUserId = resolvePhotoTarget(actor.role, actor.id, requestedUserId ?? null);
  assertCanManagePhotoFor(actor.role, actor.id, targetUserId);

  const db = getDb();
  const now = nowIST();
  await db
    .update(users)
    .set({ photoAssetId: null, updatedAt: now })
    .where(eq(users.id, targetUserId));
  // remove EVERY photo row + blob for this user (there should only be one)
  const rows = await db
    .select({ id: staffPhotos.id, path: staffPhotos.path })
    .from(staffPhotos)
    .where(eq(staffPhotos.userId, targetUserId));
  const store = getPhotoStore();
  for (const r of rows) {
    await store.deleteKey(r.path).catch(() => undefined);
    await db.delete(staffPhotos).where(eq(staffPhotos.id, r.id));
  }
  const prev = rows[0] ?? null;

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "profile_photo.remove",
    entityType: "user",
    entityId: targetUserId,
    metadata: { self: targetUserId === actor.id, hadPhoto: Boolean(prev) },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, photo: metaDTO(targetUserId) };
}

/* ----------------------------- read --------------------------- */

export async function photoMeta(
  actor: Pick<User, "id" | "role">,
  requestedUserId: number | null | undefined,
): Promise<{ dbUnavailable?: boolean; photo: PhotoMetaDTO }> {
  const targetUserId =
    requestedUserId == null || requestedUserId === actor.id
      ? actor.id
      : isPhotoManager(actor.role)
        ? requestedUserId
        : actor.id;
  if (!isDbConfigured()) {
    return { dbUnavailable: true, photo: metaDTO(targetUserId) };
  }
  const row = await currentPhotoRow(targetUserId);
  return { photo: metaDTO(targetUserId, row ?? undefined) };
}

/** The image bytes for an authorised viewer (self, or Admin / HR). */
export async function profilePhotoBytes(
  actor: Pick<User, "id" | "role">,
  requestedUserId: number | null | undefined,
): Promise<{ dbUnavailable?: boolean; mime: string | null; dataBase64: string | null }> {
  const targetUserId =
    requestedUserId == null || requestedUserId === actor.id
      ? actor.id
      : isPhotoManager(actor.role)
        ? requestedUserId
        : (() => {
            throw new HttpError(403, "Not allowed to view that photo", "forbidden");
          })();
  if (!isDbConfigured()) return { dbUnavailable: true, mime: null, dataBase64: null };
  const row = await currentPhotoRow(targetUserId);
  if (!row) return { mime: null, dataBase64: null };
  const bytes = await getPhotoStore().get(row.path);
  if (!bytes) return { mime: row.mime, dataBase64: null };
  return { mime: row.mime, dataBase64: Buffer.from(bytes).toString("base64") };
}
