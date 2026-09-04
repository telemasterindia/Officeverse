# Vercel production storage — photos & celebration assets

> Current production topology: **GitHub** (source) → **Vercel** (app hosting,
> Node serverless functions) → **GoDaddy MySQL** (database + domain), at
> `https://crm.telemasterindia.com`. Vercel Functions have **no persistent
> filesystem** outside `/tmp` (scratch space for one invocation only) — see
> `src/server/env.ts`'s `isVercel()`.

## What this is

Employee/profile photos (`src/server/hr/photo-storage.ts`) and Live-Experience
celebration clips (`src/server/live/asset-storage.ts`) are small binary
uploads (≤ `PHOTO_MAX_BYTES`, default 5 MB; ≤ `MAX_CELEBRATION_BYTES`, 8 MB).
On GoDaddy / local dev they're written to local disk (`PHOTO_STORAGE=local` /
`CELEBRATION_STORAGE=local`, the default). On Vercel, local disk isn't
available, so both stores **automatically use the existing MySQL database**
instead — a new `storage_blobs` table (migration `drizzle/0027_storage_blobs.sql`),
via `src/server/db-blob-store.ts`.

This is not a new storage provider in the "add a service" sense — it's the
same `DATABASE_URL` / `DB_*` connection every other table already uses,
already proven reachable from Vercel. It also isn't a new idea in this
codebase: `company_profile.logo_data` already stores the company logo's bytes
in this exact database (as base64 text) — `storage_blobs` generalises that to
a keyed table with a real `LONGBLOB` column, for many rows instead of one.

**Deliberately not used for** salary-slip PDFs or lead documents — those keep
their existing `filesystem` (GoDaddy) / `memory` (dev) providers
(`hr/salary-slip-storage.ts`, `leads/document-storage.ts`). Those are
larger/unbounded documents; selecting `DOCUMENT_STORAGE_PROVIDER=filesystem`
on Vercel now fails loudly with a clear config error rather than losing files
silently — see the Sept 2026 Vercel ENOENT fix.

## How the provider is chosen

| Where | `PHOTO_STORAGE` / `CELEBRATION_STORAGE` unset (default: `local`) | explicit `database` |
| --- | --- | --- |
| Local dev / GoDaddy | `local` — files on disk, unchanged | `database` |
| Vercel, DB configured | **`database`** (automatic upgrade) | `database` |
| Vercel, DB NOT configured | `memory` (last resort — logged with `console.warn`; uploads do not survive a cold start) | n/a |

No new Vercel environment variable is required — the upgrade is automatic
because `DATABASE_URL` (or `DB_HOST`/`DB_NAME`/`DB_USER`) is already required
for the rest of the app to function at all.

## Deployment steps

1. Apply the migration against the GoDaddy database (same process as every
   other migration — see `docs/godaddy-deployment.md` §5):
   ```bash
   npm run check:db      # confirm db name / user, current applied count
   npm run db:migrate     # applies drizzle/0027_storage_blobs.sql
   npm run check:db      # confirm applied count increased by 1
   ```
2. Deploy the app to Vercel as usual (this PR's code, once merged to `main`).
3. No Vercel environment variable changes are required. If you want GoDaddy
   to also use the database instead of local disk, set `PHOTO_STORAGE=database`
   and/or `CELEBRATION_STORAGE=database` there explicitly — optional.
4. Verify: upload a profile photo (Admin/HR → Staff) and a celebration asset
   (Admin → Live Experience) in production, then trigger a new deployment
   (forces a cold start) and confirm both are still there.

## Rollback

`storage_blobs` is purely additive — dropping it only affects rows written
through it; every other table is untouched. If a production issue requires
disabling the database provider, set `PHOTO_STORAGE=local` /
`CELEBRATION_STORAGE=local` — on Vercel this only re-arms the automatic
database upgrade (see table above), it will not resurrect the old
filesystem/ENOENT bug.
