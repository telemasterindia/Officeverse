/**
 * Officeverse — server-side environment access.
 *
 * The ONLY place env vars are read. Values are never logged. Missing required
 * vars throw a clear error naming the variable (not its value).
 */

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export function envInt(name: string, fallback: number): number {
  const v = env(name);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function envBool(name: string, fallback = false): boolean {
  const v = env(name)?.toLowerCase();
  if (v === undefined) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export const isProd = (): boolean => (env("NODE_ENV") ?? "development") === "production";

/**
 * True when this process is running as a Vercel Function (build or runtime).
 * `VERCEL=1` is set automatically by the platform — never something we ask
 * anyone to configure. GoDaddy/cPanel and local dev never set it.
 *
 * Vercel Functions have NO writable persistent filesystem outside `/tmp`
 * (which is scratch space for one invocation, not durable storage) — unlike
 * GoDaddy's plain Node host, where a configured local/filesystem storage
 * root is a real, durable directory. Storage modules use this to refuse a
 * local-disk write path on Vercel instead of failing with a raw ENOENT deep
 * inside `mkdir`/`writeFile`.
 */
export const isVercel = (): boolean => env("VERCEL") === "1";

/** Non-secret config bundle (safe to reference; never printed). */
export const config = {
  appUrl: () => env("APP_URL") ?? "http://localhost:3000",
  sessionCookieName: () => env("SESSION_COOKIE_NAME") ?? "ov_session",
  sessionTtlHours: () => envInt("SESSION_TTL_HOURS", 12),
  emailFrom: () => env("EMAIL_FROM") ?? "no-reply@officeverse.local",
  emailReplyTo: () => env("EMAIL_REPLY_TO"),
  photoStorage: () => (env("PHOTO_STORAGE") ?? "local") as "local" | "s3" | "r2" | "supabase",
  photoLocalDir: () => env("PHOTO_LOCAL_DIR") ?? "./storage/photos",
  photoPublicBase: () => env("PHOTO_PUBLIC_BASE") ?? "/media/photos",
  // Admin UAT Batch-2 §2 — official employee photos: allow a normal
  // high-quality phone photo (the browser still crops/compresses first).
  photoMaxBytes: () => envInt("PHOTO_MAX_BYTES", 5 * 1024 * 1024),
  importUploadDir: () => env("IMPORT_UPLOAD_DIR") ?? "./storage/imports",
  importMaxBytes: () => envInt("IMPORT_MAX_BYTES", 25 * 1024 * 1024),
};
