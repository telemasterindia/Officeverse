# Monthly salary-slip delivery — production configuration (Phase 15)

> **Status: UNVERIFIED against a live GoDaddy host.** The adapters and the
> configuration layer are implemented and unit-tested; the values below are the
> intended production setup and have **not** been deployed or run on GoDaddy.
> Nothing here requires a developer machine to stay online.

## 1. Environment variables (server-side only — never in client code)

| Variable | Purpose | Example |
| --- | --- | --- |
| `DOCUMENT_STORAGE_PROVIDER` | `filesystem` for durable PDF storage; `memory` (default) is dev-only | `filesystem` |
| `OFFICEVERSE_DOCUMENT_ROOT` | Absolute or relative directory that holds salary-slip PDFs. Put it **outside** `public_html` / the web root. Never hard-coded in the app. | `/home/<cpanel-user>/officeverse-documents` |
| `OFFICEVERSE_EMAIL_PROVIDER` | `resend` in production, `devlog` in dev, `none` to disable | `resend` |
| `RESEND_API_KEY` | Resend transactional API key. Read only by `src/server/email/provider.ts`. Never logged, never in audit metadata, never returned to a client. | `re_xxx` |
| `OFFICEVERSE_EMAIL_FROM` (or `EMAIL_FROM`) | Verified sender address for salary-slip email | `hr@yourdomain.com` |
| `OFFICEVERSE_CRON_SECRET` | Shared secret the monthly cron presents. Compared with a constant-time check. | a long random string |

If `OFFICEVERSE_EMAIL_PROVIDER=resend` but `RESEND_API_KEY` is missing, sending is
**disabled** — the batch records the affected employees as `failed`
(`no_email_provider`) and never fakes a `SENT`.

## 2. Durable document storage

- The DB row (`salary_slips`) stays the source of truth for every value.
- Only the PDF **bytes** are stored under `OFFICEVERSE_DOCUMENT_ROOT`, keyed by a
  server-generated path (`salary-slips/<YYYY-MM>/u<userId>/v<version>.pdf`).
- The filesystem adapter rejects absolute keys, `..` traversal, `.` segments and
  NUL bytes, and resolves every key strictly underneath the root.
- On download/send: read the file → verify SHA-256 against `content_sha256`; if
  missing or corrupt, regenerate deterministically from the immutable snapshot,
  re-verify, restore the file, and audit `salary_slip.storage_regenerated`.

## 3. Monthly cron (GoDaddy / cPanel)

The orchestration is `runSalarySlipCron({ cronSecret, month?, source })` in
`src/server/hr/salary-slip-cron.ts`. It:

1. requires `OFFICEVERSE_CRON_SECRET` to be configured (else refuses);
2. constant-time-compares the presented secret;
3. defaults `month` to the **previous calendar month** (IST) when not given;
4. runs `processMonthlySalarySlips` as the `system` principal — LOCKED payroll
   runs only, one employee per row, no wrapping transaction, one failure never
   stops the batch;
5. audits `salary_slip.batch_process` + per-employee `salary_slip.auto_send` /
   `salary_slip.auto_send_failed`.

### Invocation options

- **HTTP (cPanel "Cron Jobs" running `curl`/`wget`)** — call the
  `cronRunMonthlyDeliveryFn` server function endpoint with a JSON body
  `{"secret":"<OFFICEVERSE_CRON_SECRET>"}` (optionally `"month":"YYYY-MM"`).
  The exact server-function URL is produced by the build; capture it from the
  running app's network calls or a generated manifest before wiring the cron.
  Example shape:

  ```
  0 6 1 * *  curl -fsS -X POST "https://<host>/_serverFn/<generated-id>" \
       -H "Content-Type: application/json" \
       -d "{\"secret\":\"$OFFICEVERSE_CRON_SECRET\"}"
  ```

- **Direct call** — from any authenticated server-side context, call
  `runSalarySlipCron(...)`. Use this if a future build adds a dedicated CLI/API
  route.

There is **no unauthenticated public trigger**. A missing/invalid secret returns
a generic error with no detail.

## 4. What is NOT included

- No automatic scheduler is registered by the app itself — the cron entry is a
  callable adapter only.
- No statutory deductions / tax / PF / ESI / TDS / proration / Closer incentive —
  those remain deferred and are not part of payroll or the salary slip.
- Object storage (S3/R2) is not implemented; `getSalarySlipStore()` is the seam
  where it would be added.
