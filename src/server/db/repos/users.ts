/**
 * Officeverse — users repository (thin Drizzle wrappers).
 *
 * All DB access for `users` goes through here so the service layer never builds
 * raw SQL and so column selection can exclude `password_hash` by default.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import { staffPhotos, users, type User } from "@/lib/db/schema";
import { nowIST } from "../../time";

/** Public shape returned to clients — never includes password_hash. */
export interface PublicUser {
  id: number;
  email: string;
  fullName: string;
  role: User["role"];
  process: User["process"];
  status: User["status"];
  phone: string | null;
  mustChangePassword: boolean;
  photoUrl: string | null;
}

export function toPublicUser(u: User, photoUrl: string | null = null): PublicUser {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    process: u.process,
    status: u.status,
    phone: u.phone ?? null,
    mustChangePassword: u.mustChangePassword,
    photoUrl,
  };
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const rows = await getDb()
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return rows[0];
}

export async function getUserById(id: number): Promise<User | undefined> {
  const rows = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

/** Resolve a user's current profile photo URL (null → generated avatar fallback). */
export async function getUserPhotoUrl(user: User): Promise<string | null> {
  if (!user.photoAssetId) return null;
  const rows = await getDb()
    .select({ url: staffPhotos.url, path: staffPhotos.path, storage: staffPhotos.storage })
    .from(staffPhotos)
    .where(eq(staffPhotos.id, user.photoAssetId))
    .limit(1);
  const p = rows[0];
  if (!p) return null;
  return p.url ?? p.path ?? null;
}

export async function touchLogin(id: number): Promise<void> {
  const ts = nowIST();
  await getDb().update(users).set({ lastLoginAt: ts, updatedAt: ts }).where(eq(users.id, id));
}

export async function setPasswordHash(id: number, passwordHash: string): Promise<void> {
  const ts = nowIST();
  await getDb()
    .update(users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: ts })
    .where(eq(users.id, id));
}

export interface UserContact {
  id: number;
  email: string;
  fullName: string;
}

/** Batch-load email + name for a set of user ids (notification/email routing). */
export async function loadUserContacts(
  ids: number[],
  ex: DBX = getDb(),
): Promise<Map<number, UserContact>> {
  const map = new Map<number, UserContact>();
  const unique = [...new Set(ids)].filter((n) => Number.isFinite(n));
  if (!unique.length) return map;
  const rows = await ex
    .select({ id: users.id, email: users.email, fullName: users.fullName })
    .from(users)
    .where(inArray(users.id, unique));
  for (const r of rows) map.set(r.id, r);
  return map;
}

export async function countUsers(): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(users);
  return Number(rows[0]?.n ?? 0);
}
