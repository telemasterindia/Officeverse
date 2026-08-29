# Officeverse — GoDaddy production deployment runbook

> **Status: NOT DEPLOYED / NOT VERIFIED.** This document is the procedure. No
> step below has been executed against GoDaddy from the development environment.
> All secrets are placeholders — never commit real values.

Canonical stack (do not change): TanStack Start + Nitro, Drizzle ORM, **MySQL**
(GoDaddy cPanel). No Postgres, no Laravel, no second ORM, no SQLite in
production. The Mac is development-only and must never be a runtime dependency.

---

## 1. Build (Node runtime, not Cloudflare)

The default `npm run build` targets the Cloudflare Workers preset
(`.wrangler/`), which does **not** run on GoDaddy. Build with the Node preset:

```bash
NITRO_PRESET=node-server npm run build     # == npm run build:node
```

Output: `.output/` — `.output/server/index.mjs` is the server entry, run with
`node .output/server/index.mjs` (== `npm run start:node`), and `.output/public/`
is the static asset dir. `.output/nitro.json` should show `"preset": "node-server"`.

Verify locally before uploading: `npm run typecheck && npm run test && npm run build:node`.

## 2. Environment variables

Set these on the GoDaddy host (cPanel → *Setup Node.js App* → *Environment
variables*, or a `.env` next to the app if the runtime loads it). Copy
`.env.example`, fill real values, keep the file off git.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV=production` | turns on `secure` session cookies |
| `NITRO_PRESET=node-server` | build-time (see step 1) |
| `APP_URL` | public https URL |
| `TZ=Asia/Kolkata` | belt-and-suspenders (code is IST-explicit) |
| `DATABASE_URL` **or** `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` | GoDaddy MySQL. DB name `TMI_officeverse`, user `officeverse`. |
| `DB_POOL_LIMIT` | default 10 |
| `SESSION_COOKIE_NAME` (default `ov_session`), `SESSION_TTL_HOURS` (default 12) | sessions |
| `CRON_SECRET` **and** `OFFICEVERSE_CRON_SECRET` | long random string; set BOTH to the same value. Required by `/internal/*`. |
| `OFFICEVERSE_EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `OFFICEVERSE_EMAIL_FROM` (or `EMAIL_FROM`), `EMAIL_REPLY_TO` | transactional email |
| `DOCUMENT_STORAGE_PROVIDER=filesystem`, `OFFICEVERSE_DOCUMENT_ROOT` | salary-slip PDF storage (see step 9) |
| `OFFICEVERSE_PRORATION_BASIS` | leave **unset** until the business picks a denominator; only `CALENDAR_DAYS` is implemented |
| `PHOTO_*`, `IMPORT_*` | legacy file dirs |
| `SENTRY_DSN` | optional |

Secrets are read **server-side only** (`src/server/env.ts` / `src/lib/db/index.ts`).
They never reach the client bundle, logs, audit metadata, or the health payload.

## 3. GoDaddy Node configuration

cPanel *Setup Node.js App*:
- Application root: the uploaded project dir.
- Application startup file: `.output/server/index.mjs`.
- Node version: ≥ 20 (mysql2 + `node:crypto` + global `fetch`).
- Add the environment variables from step 2.
- Passenger/nginx proxies `APP_URL` → the Node app.

If cPanel cannot run an arbitrary startup file, use `npm run start:node` via the
app's configured start command.

## 4. MySQL connection

`src/lib/db/index.ts` opens a lazy `mysql2` pool from `DATABASE_URL` or the
`DB_*` vars — `dateStrings: true`, `timezone: "+05:30"`, `charset: utf8mb4`.
Nothing connects at import time, so the build never needs the DB.

Probe connectivity (read-only, never prints the password):

```bash
node --env-file=.env scripts/check-db.mjs      # == npm run check:db (with env exported)
```

It reports the DB name, current user, table count, and `__drizzle_migrations`
state (applied vs local file count).

## 5. Migration process

The canonical schema is **`drizzle/*.sql` + `drizzle/meta/`** — never phpMyAdmin,
never hand-written SQL, never editing an applied migration.

```bash
npm run check:db          # confirm db name = TMI_officeverse, user = officeverse, current applied count
npm run db:migrate        # drizzle-kit migrate — applies pending files IN ORDER
npm run check:db          # confirm applied count == local file count (currently 11)
```

`drizzle-kit migrate` reads the same `DATABASE_URL` / `DB_*` env. It applies only
pending migrations and records them in `__drizzle_migrations`. Current sequence
(0000 → 0010): init, lead_assignments, followup_history, leads_agent_nullable,
notifications_email_jobs, attendance_foundation, hr_leave_off_sandwich,
holidays_regularity_bonus, payroll_salary_foundation, salary_slips_email,
payroll_breakdown_inputs.

If a migration fails: **STOP**. Do not improvise SQL. Restore from the backup
(step 6), fix the migration file locally, regenerate, re-test, retry.

## 6. Backup before migration (REQUIRED)

Before the first `db:migrate` on GoDaddy:

- cPanel → *Backup* → *Download a MySQL Database Backup* → select
  `TMI_officeverse` → download the `.sql.gz`.
- Or phpMyAdmin → database → *Export* → *Custom* → *Save output to a file* →
  Go. (Export only — never *Import*, never *Drop*.)
- Keep the dump off the server.

The development environment **cannot take this backup for you** — the user must
do it and confirm before migrating. Do not proceed on an unverified backup.

## 7. Cron setup (cPanel)

The Mac is never involved. cPanel → *Cron Jobs*. The endpoints are on the
running app and authenticated by the `x-cron-secret` header (constant-time
compared; missing/wrong → 401; no unauthenticated trigger exists).

Monthly salary-slip delivery — **dry run** (safe, sends nothing):

```
0 5 1 * *  curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" \
  "https://APP_URL/internal/monthly-salary-slips?month=$(date -d 'last month' +\%Y-\%m)"
```

Add `&run=1` to actually generate + email slips for **LOCKED** payroll runs
(the LOCKED-only eligibility rule is enforced in the batch service and is not
changed here). Already-SENT slips are skipped; failures are retried on the same
document; one employee's failure never stops the batch.

`/internal/tick` and `/internal/drain-email` return `501 not_implemented` — the
reminder scheduler and email-job outbox drain are future phases; do not schedule
them yet.

## 8. Email setup (Resend)

`getEmailProvider()` resolves `OFFICEVERSE_EMAIL_PROVIDER`:
`resend` → real provider **iff `RESEND_API_KEY` is set** (else `null` — the
batch records a controlled failure and never fakes `SENT`); `devlog` → in-memory
(dev/test); `none` → disabled. Set `OFFICEVERSE_EMAIL_FROM` to a Resend-verified
sender domain. Do **not** send a real production email as a smoke test — check
`GET /api/health` (`email_provider: configured`) instead.

## 9. Storage setup (salary-slip PDFs)

The DB row is the source of truth; only the PDF bytes need durable storage.
Set `DOCUMENT_STORAGE_PROVIDER=filesystem` and `OFFICEVERSE_DOCUMENT_ROOT` to an
**absolute path outside `public_html`** (e.g. `/home/<cpanel-user>/officeverse-documents`),
writable by the Node app. The filesystem adapter rejects `..`, absolute keys and
NUL, and resolves every key under that root. If the GoDaddy plan provides no
persistent writable path outside the web root, storage is a **deployment
blocker** — do not substitute an external provider without a decision. (A lost
blob is still recoverable: `renderSalarySlipPdf` is deterministic and the slip
row keeps every input; it is regenerated and re-verified against `content_sha256`.)

## 10. Health check

- Public: `GET https://APP_URL/api/health` → `{ ok, service, time, database,
  migrations, email_provider, storage, automation }` — **status strings only, no
  secrets.**
- Deep (DB reachability + applied-migration count): `GET /api/health?deep=1`
  with the `x-cron-secret` header.
- Admin UI: **Settings → Production readiness** (Admin role only) shows the same
  status rows.

## 11. Rollback

- **App**: keep the previous `.output/` (or the previous git tag); redeploy it.
  Sessions survive (DB-backed); no client cache invalidation needed.
- **Database**: restore the step-6 dump via cPanel *Restore* / phpMyAdmin
  *Import*. Drizzle migrations are forward-only — there is no down-migration; the
  backup is the rollback.
- **A single bad migration**: restore the backup, fix + regenerate the migration
  file locally, re-test, re-apply the full sequence.

## 12. Verification checklist

- [ ] `npm run build:node` locally → `.output/nitro.json` preset = `node-server`
- [ ] `npm run typecheck && npm run test` green
- [ ] Backup of `TMI_officeverse` downloaded and stored off-server
- [ ] `npm run check:db` → correct db/user, expected applied count
- [ ] `npm run db:migrate` → `check:db` shows applied == 11 (local)
- [ ] `GET /api/health` → `database: configured`, `migrations: present`
- [ ] `GET /api/health?deep=1` (with secret) → `database.reachable: true`,
      `migrations.upToDate: true`
- [ ] `email_provider: configured`, `storage: configured`, `automation: configured`
- [ ] Log in as an existing user; session cookie is `Secure; HttpOnly; SameSite=Lax`
- [ ] Cron dry-run returns a summary; **not** scheduled with `run=1` until sign-off
- [ ] No secret appears in any HTTP response, log line or audit row
