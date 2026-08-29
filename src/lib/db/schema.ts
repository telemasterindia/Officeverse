/**
 * Officeverse — production database schema (MySQL / MariaDB).
 *
 * Dialect: mysql (drizzle-orm/mysql-core). Target: GoDaddy cPanel MySQL/MariaDB.
 *
 * CONVENTIONS
 * -----------
 * - Every table has an internal auto-increment `id` used for foreign keys.
 *   Business-facing identifiers (Lead code "TMI_00012007", Follow-up code
 *   "FU_00004415", "AG-00001", "CL-00001", "CLT-00001") are kept as their own
 *   UNIQUE `*_code` column so the existing Officeverse ID conventions are
 *   preserved exactly.
 * - `datetime` columns hold IST WALL-CLOCK values ("YYYY-MM-DD HH:MM:SS"),
 *   matching the existing app (buildScheduledAt / scheduledParts / shiftDateIST).
 *   The mysql2 pool is configured with `dateStrings: true` so no timezone
 *   conversion happens. `created_at` / `updated_at` are written by the app from
 *   the canonical shift module — no DB `CURRENT_TIMESTAMP` default, to keep one
 *   timezone convention across every column.
 * - `date` columns (shift_date, capture_date, registered_on, dob) are plain
 *   calendar dates.
 * - Uniquely-indexed varchars are capped at 191 chars (utf8mb4 index-length
 *   safety for older MariaDB).
 * - FK on-delete actions are explicit. Operational rows (leads, follow_ups,
 *   audit) are never hard-deleted by cascade from a user.
 *
 * PASSWORDS: only `users.password_hash` (argon2id). Never exported, never
 * logged, never returned to the client.
 */
import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  datetime,
  decimal,
  index,
  int,
  json,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  text,
  unique,
  varchar,
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";

/* ------------------------------------------------------------------ *
 *  Enums (shared literal sets — mirror src/lib/officeverse/types.ts) *
 * ------------------------------------------------------------------ */

/**
 * `datetime` and `date` columns are handled as STRINGS end to end:
 *   - stored/read as IST wall-clock ("YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DD")
 *   - mysql2 pool uses `dateStrings: true` (see db/index.ts)
 *   - the server time module (src/server/time.ts) produces exactly these strings
 * This keeps one timezone convention across every column and matches the
 * existing client (buildScheduledAt / scheduledParts).
 */
const dt = (name: string) => datetime(name, { mode: "string" });
const dcol = (name: string) => date(name, { mode: "string" });

export const ROLES = ["admin", "agent", "closer", "hr"] as const;
export const PROCESS_CODES = ["US", "UK", "IN", "AU"] as const;
export const USER_STATUSES = ["active", "inactive", "suspended", "on_leave"] as const;

export const LEAD_STATUSES = [
  "NEW",
  "ASSIGNED",
  "ACCEPTED",
  "REJECTED",
  "FOLLOW-UP",
  "COMPLETED",
] as const;
export const LEAD_SOURCES = ["app", "import", "conversion"] as const;

export const FOLLOW_UP_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "CONVERTED"] as const;
export const FOLLOW_UP_OWNER_ROLES = ["agent", "closer"] as const;
export const FOLLOW_UP_SOURCES = ["app", "import"] as const;
/**
 * A follow-up attempt row exists for every scheduled slot in the reschedule
 * chain, INCLUDING the current active one (outcome "SCHEDULED"). On reschedule
 * the current row flips "SCHEDULED" → "RESCHEDULED" and a new "SCHEDULED" row is
 * appended; on complete/cancel/convert the current row flips to the terminal
 * outcome. History is append-only and never overwritten.
 */
export const ATTEMPT_OUTCOMES = [
  "SCHEDULED",
  "RESCHEDULED",
  "COMPLETED",
  "CANCELLED",
  "CONVERTED",
] as const;
export const CURRENT_DEBTS = ["Current", "Late"] as const;

export const CLIENT_STATUSES = ["active", "prospect", "inactive", "closed"] as const;

/**
 * Email template identifiers (Phase 5). EXTENSIBLE: add an id here + a renderer
 * in src/server/email/templates.ts — no enum migration needed because the
 * column is a plain varchar (mirrors `notifications.type`). Full email HTML is
 * never stored in business logic; the template registry renders it.
 */
export const EMAIL_TEMPLATES = [
  "FOLLOW_UP_REMINDER",
  "FOLLOW_UP_RESCHEDULED",
  "LEAD_ASSIGNED",
  "LEAD_STATUS_CHANGED",
  "SYSTEM_NOTIFICATION",
  // legacy outbox identifiers (pre-Phase-5 client renderers)
  "closer-followup",
  "shift-summary",
] as const;
export type EmailTemplateId = (typeof EMAIL_TEMPLATES)[number];
/**
 * queued      → waiting for a worker (also where a retryable failure returns to,
 *               with a future next_attempt_at back-off)
 * processing  → claimed/leased by a worker (locked_at / locked_by set)
 * sent        → delivered (terminal)
 * failed      → gave up after max_retries (terminal, NEVER deleted — auditable)
 */
export const EMAIL_STATUSES = ["queued", "processing", "sent", "failed"] as const;

export const IMPORT_TYPES = ["leads", "follow_ups", "workbook"] as const;
export const IMPORT_STATUSES = [
  "uploaded",
  "mapping",
  "validating",
  "validated",
  "committing",
  "committed",
  "failed",
  "rolled_back",
] as const;
export const IMPORT_ROW_DECISIONS = [
  "pending",
  "new",
  "update",
  "skip",
  "duplicate",
  "error",
] as const;
export const IMPORT_ROW_TARGETS = ["lead", "follow_up"] as const;

export const AUDIT_ACTOR_ROLES = ["admin", "agent", "closer", "hr", "system"] as const;
export const PHOTO_STORAGES = ["local", "s3", "r2", "supabase"] as const;
export const LEAD_ASSIGNMENT_ACTIONS = ["assign", "reassign", "unassign"] as const;

/* HR Attendance Foundation (Phase 10) — raw-fact enums. Off-conversion,
 * leave, holiday and incentive rules are DEFERRED to a later HR phase. */
export const ATTENDANCE_CHECK_IN_STATUSES = ["ON_TIME", "SHORT", "LATE", "PENDING"] as const;
export const ATTENDANCE_CHECK_OUT_STATUSES = [
  "ON_TIME",
  "SHORT",
  "EARLY_DEPARTURE",
  "PENDING",
] as const;
export const ATTENDANCE_STATUSES = [
  "ON_TIME",
  "SHORT_ATTENDANCE",
  "LATE",
  "EARLY_DEPARTURE",
  "PENDING",
  "ABSENT",
] as const;
export const ATTENDANCE_SOURCES = ["derived", "corrected"] as const;

/* ------------------------------------------------------------------ *
 *  1 · users  (authentication + all staff identity)                  *
 * ------------------------------------------------------------------ */

export const users = mysqlTable(
  "users",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    email: varchar("email", { length: 191 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    fullName: varchar("full_name", { length: 200 }).notNull(),
    role: mysqlEnum("role", ROLES).notNull(),
    process: mysqlEnum("process", PROCESS_CODES).notNull().default("US"),
    status: mysqlEnum("status", USER_STATUSES).notNull().default("active"),
    phone: varchar("phone", { length: 40 }),
    /** current profile photo → staff_photos.id (fallback = generated avatar) */
    photoAssetId: int("photo_asset_id", { unsigned: true }),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    lastLoginAt: dt("last_login_at"),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    emailUq: unique("users_email_uq").on(t.email),
    roleIdx: index("users_role_idx").on(t.role),
    statusIdx: index("users_status_idx").on(t.status),
  }),
);

/* ------------------------------------------------------------------ *
 *  2 · agents   (1:1 profile on top of users)                        *
 * ------------------------------------------------------------------ */

export const agents = mysqlTable(
  "agents",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    /** business "Agent ID", e.g. "AG-00001" */
    agentCode: varchar("agent_code", { length: 24 }).notNull(),
    dob: dcol("dob"),
    monthlySalary: decimal("monthly_salary", { precision: 12, scale: 2 }).notNull().default("0.00"),
    /** Date of Registration = operational SHIFT DATE (Phase 7) */
    registeredOn: dcol("registered_on").notNull(),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    userUq: unique("agents_user_uq").on(t.userId),
    codeUq: unique("agents_code_uq").on(t.agentCode),
  }),
);

/* ------------------------------------------------------------------ *
 *  3 · closers   (1:1 profile on top of users) — NOT an agent        *
 * ------------------------------------------------------------------ */

export const closers = mysqlTable(
  "closers",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    /** business "Closer ID", e.g. "CL-00001" */
    closerCode: varchar("closer_code", { length: 24 }).notNull(),
    dob: dcol("dob"),
    registeredOn: dcol("registered_on").notNull(),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    userUq: unique("closers_user_uq").on(t.userId),
    codeUq: unique("closers_code_uq").on(t.closerCode),
  }),
);

/* ------------------------------------------------------------------ *
 *  4 · clients   (separate entity — not agent / closer)              *
 * ------------------------------------------------------------------ */

export const clients = mysqlTable(
  "clients",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    clientCode: varchar("client_code", { length: 24 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    contactName: varchar("contact_name", { length: 200 }),
    email: varchar("email", { length: 191 }),
    phone: varchar("phone", { length: 40 }),
    address: varchar("address", { length: 500 }),
    status: mysqlEnum("status", CLIENT_STATUSES).notNull().default("prospect"),
    registeredOn: dcol("registered_on").notNull(),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    codeUq: unique("clients_code_uq").on(t.clientCode),
    statusIdx: index("clients_status_idx").on(t.status),
  }),
);

/* ------------------------------------------------------------------ *
 *  11 · imports  (declared before leads/follow_ups for FK order)     *
 * ------------------------------------------------------------------ */

export const imports = mysqlTable(
  "imports",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    filename: varchar("filename", { length: 255 }).notNull(),
    /** where the uploaded .xlsx/.csv is retained (path or object key) */
    storedPath: varchar("stored_path", { length: 500 }),
    type: mysqlEnum("type", IMPORT_TYPES).notNull(),
    uploadedByUserId: int("uploaded_by_user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    status: mysqlEnum("status", IMPORT_STATUSES).notNull().default("uploaded"),
    sheetName: varchar("sheet_name", { length: 120 }),
    /** { targetField: sourceHeader } chosen in the column-mapping step */
    columnMapping: json("column_mapping"),
    totalRows: int("total_rows", { unsigned: true }).notNull().default(0),
    validRows: int("valid_rows", { unsigned: true }).notNull().default(0),
    invalidRows: int("invalid_rows", { unsigned: true }).notNull().default(0),
    newRows: int("new_rows", { unsigned: true }).notNull().default(0),
    updateRows: int("update_rows", { unsigned: true }).notNull().default(0),
    duplicateRows: int("duplicate_rows", { unsigned: true }).notNull().default(0),
    skippedRows: int("skipped_rows", { unsigned: true }).notNull().default(0),
    errorRows: int("error_rows", { unsigned: true }).notNull().default(0),
    successCount: int("success_count", { unsigned: true }).notNull().default(0),
    errorCount: int("error_count", { unsigned: true }).notNull().default(0),
    committedAt: dt("committed_at"),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    byUserIdx: index("imports_by_user_idx").on(t.uploadedByUserId),
    statusIdx: index("imports_status_idx").on(t.status),
  }),
);

/* ------------------------------------------------------------------ *
 *  6 · follow_ups  (declared before leads: leads FK references it)   *
 *  A Follow-up is owned by its caller. It carries its OWN customer    *
 *  snapshot — converting to a Lead reuses it (no duplicate entry).   *
 * ------------------------------------------------------------------ */

export const followUps = mysqlTable(
  "follow_ups",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    /** business "Follow-up ID", e.g. "FU_00004415" — preserved across reschedule */
    followUpCode: varchar("follow_up_code", { length: 32 }).notNull(),

    /** the person who owns the callback (Phase 3) — never reassigned */
    ownerUserId: int("owner_user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    ownerRole: mysqlEnum("owner_role", FOLLOW_UP_OWNER_ROLES).notNull(),

    /* customer snapshot owned by this follow-up */
    customerName: varchar("customer_name", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 40 }).notNull(),
    phoneNormalized: varchar("phone_normalized", { length: 24 }),
    email: varchar("email", { length: 191 }),
    emailNormalized: varchar("email_normalized", { length: 191 }),
    address: varchar("address", { length: 500 }),
    city: varchar("city", { length: 120 }),
    state: varchar("state", { length: 120 }),
    zip: varchar("zip", { length: 20 }),
    debtAmount: decimal("debt_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    creditStatus: varchar("credit_status", { length: 60 }),
    currentDebts: mysqlEnum("current_debts", CURRENT_DEBTS),

    /** operational shift date the customer was captured (Phase 7) */
    captureDate: dcol("capture_date").notNull(),
    /** canonical scheduled instant — IST wall-clock */
    scheduledAt: dt("scheduled_at").notNull(),
    scheduledTz: varchar("scheduled_tz", { length: 10 }).notNull().default("+05:30"),

    comment: text("comment"),
    status: mysqlEnum("status", FOLLOW_UP_STATUSES).notNull().default("SCHEDULED"),

    /* conversion trail (Phase 3) — set only when this follow-up became a Lead */
    leadId: int("lead_id", { unsigned: true }).references((): AnyMySqlColumn => leads.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    convertedLeadCode: varchar("converted_lead_code", { length: 32 }),
    convertedAt: dt("converted_at"),
    completedAt: dt("completed_at"),
    cancelledAt: dt("cancelled_at"),

    createdByUserId: int("created_by_user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    source: mysqlEnum("source", FOLLOW_UP_SOURCES).notNull().default("app"),
    importId: int("import_id", { unsigned: true }).references(() => imports.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    codeUq: unique("follow_ups_code_uq").on(t.followUpCode),
    ownerIdx: index("follow_ups_owner_idx").on(t.ownerUserId),
    ownerStatusIdx: index("follow_ups_owner_status_idx").on(t.ownerUserId, t.status),
    statusIdx: index("follow_ups_status_idx").on(t.status),
    dueScanIdx: index("follow_ups_due_scan_idx").on(t.status, t.scheduledAt),
    leadIdx: index("follow_ups_lead_idx").on(t.leadId),
    phoneIdx: index("follow_ups_phone_idx").on(t.phoneNormalized),
  }),
);

/* ------------------------------------------------------------------ *
 *  5 · leads  (real persistent customer record)                      *
 * ------------------------------------------------------------------ */

export const leads = mysqlTable(
  "leads",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    /** business "Lead ID", e.g. "TMI_00012007" — globally unique */
    leadCode: varchar("lead_code", { length: 32 }).notNull(),
    /** operational / shift date (Phase 7 canonical) */
    shiftDate: dcol("shift_date").notNull(),

    customerName: varchar("customer_name", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 40 }).notNull(),
    phoneNormalized: varchar("phone_normalized", { length: 24 }),
    email: varchar("email", { length: 191 }),
    emailNormalized: varchar("email_normalized", { length: 191 }),
    address: varchar("address", { length: 500 }),
    city: varchar("city", { length: 120 }),
    state: varchar("state", { length: 120 }),
    zip: varchar("zip", { length: 20 }),
    debtAmount: decimal("debt_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    creditStatus: varchar("credit_status", { length: 60 }),
    currentDebts: mysqlEnum("current_debts", CURRENT_DEBTS).notNull().default("Current"),
    leadFile: varchar("lead_file", { length: 200 }),
    comments: text("comments"),

    /**
     * ORIGINATING agent — the agent who submitted the lead. Nullable: a lead
     * created by CONVERTING a closer-owned follow-up has no originating agent
     * (the closer is operationally responsible via `assignedCloserId`).
     * Agent lead-visibility / reporting keys off this column.
     */
    agentId: int("agent_id", { unsigned: true }).references(() => agents.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    /**
     * OPERATIONAL closer responsible for the lead — null until an agent
     * transfers it; set immediately when a closer-owned follow-up converts
     * (and stays with that same closer — never reassigned by conversion).
     */
    assignedCloserId: int("assigned_closer_id", { unsigned: true }).references(() => closers.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    status: mysqlEnum("status", LEAD_STATUSES).notNull().default("NEW"),

    /** set when a Follow-up was converted into this Lead (Phase 3) */
    convertedFromFollowUpId: int("converted_from_follow_up_id", { unsigned: true }).references(
      () => followUps.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    source: mysqlEnum("source", LEAD_SOURCES).notNull().default("app"),
    importId: int("import_id", { unsigned: true }).references(() => imports.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),

    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    codeUq: unique("leads_code_uq").on(t.leadCode),
    agentIdx: index("leads_agent_idx").on(t.agentId),
    closerIdx: index("leads_closer_idx").on(t.assignedCloserId),
    statusIdx: index("leads_status_idx").on(t.status),
    shiftDateIdx: index("leads_shift_date_idx").on(t.shiftDate),
    phoneIdx: index("leads_phone_idx").on(t.phoneNormalized),
    emailIdx: index("leads_email_idx").on(t.emailNormalized),
  }),
);

/* ------------------------------------------------------------------ *
 *  5b · lead_assignments  (closer transfer/reassignment history)     *
 *  The submitting agent (leads.agent_id) is immutable; this table    *
 *  preserves the timeline of closer assignment so ownership history  *
 *  is never lost when the current assignee changes (Phase 3).        *
 * ------------------------------------------------------------------ */

export const leadAssignments = mysqlTable(
  "lead_assignments",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    leadId: int("lead_id", { unsigned: true })
      .notNull()
      .references(() => leads.id, { onDelete: "cascade", onUpdate: "cascade" }),
    fromCloserId: int("from_closer_id", { unsigned: true }).references(() => closers.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    toCloserId: int("to_closer_id", { unsigned: true }).references(() => closers.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    action: mysqlEnum("action", LEAD_ASSIGNMENT_ACTIONS).notNull(),
    byUserId: int("by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    note: varchar("note", { length: 500 }),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    leadIdx: index("lead_assignments_lead_idx").on(t.leadId),
    createdIdx: index("lead_assignments_created_idx").on(t.createdAt),
  }),
);

/* ------------------------------------------------------------------ *
 *  7 · follow_up_attempts  (append-only reschedule / close history)  *
 * ------------------------------------------------------------------ */

export const followUpAttempts = mysqlTable(
  "follow_up_attempts",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    followUpId: int("follow_up_id", { unsigned: true })
      .notNull()
      .references(() => followUps.id, { onDelete: "cascade", onUpdate: "cascade" }),
    /** 1-based ordinal of this attempt within the follow-up */
    attemptNo: int("attempt_no", { unsigned: true }).notNull(),
    /** the schedule this attempt covered — IST wall-clock */
    scheduledAt: dt("scheduled_at").notNull(),
    outcome: mysqlEnum("outcome", ATTEMPT_OUTCOMES).notNull(),
    note: text("note"),
    /** the Lead this attempt produced — set only on the CONVERTED entry */
    relatedLeadId: int("related_lead_id", { unsigned: true }).references(
      (): AnyMySqlColumn => leads.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    relatedLeadCode: varchar("related_lead_code", { length: 32 }),
    recordedAt: dt("recorded_at").notNull(),
    recordedByUserId: int("recorded_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (t) => ({
    fuAttemptUq: unique("fu_attempts_no_uq").on(t.followUpId, t.attemptNo),
    fuIdx: index("fu_attempts_fu_idx").on(t.followUpId),
    relatedLeadIdx: index("fu_attempts_related_lead_idx").on(t.relatedLeadId),
  }),
);

/* ------------------------------------------------------------------ *
 *  8 · notifications  (single source of truth for the bell feed)     *
 * ------------------------------------------------------------------ */

export const notifications = mysqlTable(
  "notifications",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    /** recipient — ALWAYS resolved server-side, never taken from a client body */
    recipientUserId: int("recipient_user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    /**
     * event type (varchar so new events need no migration), e.g.
     *   followup.reminder | followup.overdue | followup.rescheduled
     *   followup.converted | followup.completed | followup.cancelled
     *   lead.assigned | lead.transferred | lead.status_changed | system
     */
    type: varchar("type", { length: 60 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    message: varchar("message", { length: 1000 }).notNull(),
    relatedEntityType: varchar("related_entity_type", { length: 40 }),
    relatedEntityId: int("related_entity_id", { unsigned: true }),
    relatedEntityCode: varchar("related_entity_code", { length: 32 }),
    readAt: dt("read_at"),
    /** structured context for the future scheduler (reminder threshold,
     *  scheduled occurrence…). MUST NOT contain secrets or unnecessary PII. */
    metadata: json("metadata"),
    /**
     * DB-level idempotency (Phase 4/5). Derived from the BUSINESS EVENT, never
     * from "now" — e.g. followup:FU_00004415:reminder:2026-08-29T22:00. NULL is
     * allowed for one-off notifications (MySQL lets multiple NULLs coexist in a
     * UNIQUE index). Re-running the scheduler with the same key is a no-op.
     */
    dedupeKey: varchar("dedupe_key", { length: 191 }),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    dedupeUq: unique("notifications_dedupe_uq").on(t.dedupeKey),
    recipientIdx: index("notifications_recipient_idx").on(t.recipientUserId, t.createdAt),
    unreadIdx: index("notifications_unread_idx").on(t.recipientUserId, t.readAt),
  }),
);

/* ------------------------------------------------------------------ *
 *  9 · email_jobs  (queue → worker → Resend → sent/failed)           *
 * ------------------------------------------------------------------ */

export const emailJobs = mysqlTable(
  "email_jobs",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    /** template identifier — see EMAIL_TEMPLATES / src/server/email/templates.ts */
    kind: varchar("kind", { length: 60 }).notNull(),
    toEmail: varchar("to_email", { length: 191 }).notNull(),
    toName: varchar("to_name", { length: 200 }),
    /** recipient user when known — resolved server-side, never from a client body */
    toUserId: int("to_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    subject: varchar("subject", { length: 500 }).notNull(),
    /** rendered bodies — nullable so a future worker MAY render lazily from `payload` */
    bodyText: mediumtext("body_text"),
    bodyHtml: mediumtext("body_html"),
    /** structured template data — kept so the future worker can (re)render */
    payload: json("payload"),
    relatedEntityType: varchar("related_entity_type", { length: 40 }),
    relatedEntityId: int("related_entity_id", { unsigned: true }),
    /**
     * required UNIQUE idempotency key, derived from the business event
     * (e.g. followup:FU_00004415:reminder:2026-08-29T22:00:email). Enqueuing
     * the same event twice is a no-op.
     */
    dedupeKey: varchar("dedupe_key", { length: 191 }).notNull(),
    status: mysqlEnum("status", EMAIL_STATUSES).notNull().default("queued"),
    /** attempts consumed (incremented when a worker CLAIMS the job) */
    retryCount: int("retry_count", { unsigned: true }).notNull().default(0),
    maxRetries: int("max_retries", { unsigned: true }).notNull().default(5),
    /** earliest instant a worker may (re)attempt — a.k.a. available_at */
    nextAttemptAt: dt("next_attempt_at").notNull(),
    /** hard "do not send before" (pre-scheduled summaries) */
    scheduledFor: dt("scheduled_for"),
    provider: varchar("provider", { length: 40 }),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    errorMessage: varchar("error_message", { length: 1000 }),
    /** worker claim/lease — a stale lock (locked_at older than the lease) is recoverable */
    lockedAt: dt("locked_at"),
    lockedBy: varchar("locked_by", { length: 80 }),
    sentAt: dt("sent_at"),
    failedAt: dt("failed_at"),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    dedupeUq: unique("email_jobs_dedupe_uq").on(t.dedupeKey),
    drainIdx: index("email_jobs_drain_idx").on(t.status, t.nextAttemptAt),
    leaseIdx: index("email_jobs_lease_idx").on(t.status, t.lockedAt),
    toUserIdx: index("email_jobs_to_user_idx").on(t.toUserId),
  }),
);

/* ------------------------------------------------------------------ *
 *  10 · audit_logs                                                   *
 * ------------------------------------------------------------------ */

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    actorUserId: int("actor_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    actorRole: mysqlEnum("actor_role", AUDIT_ACTOR_ROLES),
    /** e.g. lead.created | lead.assigned | followup.rescheduled | auth.login
     *       | import.commit | export.run | password.change */
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 40 }),
    entityId: int("entity_id", { unsigned: true }),
    entityCode: varchar("entity_code", { length: 32 }),
    /** structured context — MUST NOT contain passwords or secrets */
    metadata: json("metadata"),
    ip: varchar("ip", { length: 45 }),
    userAgent: varchar("user_agent", { length: 255 }),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    actorIdx: index("audit_actor_idx").on(t.actorUserId),
    actionIdx: index("audit_action_idx").on(t.action),
    entityIdx: index("audit_entity_idx").on(t.entityType, t.entityId),
    createdIdx: index("audit_created_idx").on(t.createdAt),
  }),
);

/* ------------------------------------------------------------------ *
 *  12 · import_rows + import_errors  (per-row import tracking)        *
 * ------------------------------------------------------------------ */

export const importRows = mysqlTable(
  "import_rows",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    importId: int("import_id", { unsigned: true })
      .notNull()
      .references(() => imports.id, { onDelete: "cascade", onUpdate: "cascade" }),
    /** 1-based source row number (for the downloadable error report) */
    rowNumber: int("row_number", { unsigned: true }).notNull(),
    /** the source row exactly as read from the sheet */
    raw: json("raw").notNull(),
    /** mapped + normalized values (after column mapping) */
    parsed: json("parsed"),
    decision: mysqlEnum("decision", IMPORT_ROW_DECISIONS).notNull().default("pending"),
    targetEntityType: mysqlEnum("target_entity_type", IMPORT_ROW_TARGETS),
    /** filled after commit — enables per-import rollback */
    targetEntityId: int("target_entity_id", { unsigned: true }),
    targetEntityCode: varchar("target_entity_code", { length: 32 }),
    committed: boolean("committed").notNull().default(false),
  },
  (t) => ({
    rowUq: unique("import_rows_row_uq").on(t.importId, t.rowNumber),
    importIdx: index("import_rows_import_idx").on(t.importId),
    decisionIdx: index("import_rows_decision_idx").on(t.importId, t.decision),
  }),
);

export const importErrors = mysqlTable(
  "import_errors",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    importId: int("import_id", { unsigned: true })
      .notNull()
      .references(() => imports.id, { onDelete: "cascade", onUpdate: "cascade" }),
    rowNumber: int("row_number", { unsigned: true }).notNull(),
    field: varchar("field", { length: 80 }),
    value: varchar("value", { length: 500 }),
    /** machine code, e.g. agent_not_found | invalid_date | duplicate_lead_id */
    code: varchar("code", { length: 60 }).notNull(),
    message: varchar("message", { length: 500 }).notNull(),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    importIdx: index("import_errors_import_idx").on(t.importId),
    rowIdx: index("import_errors_row_idx").on(t.importId, t.rowNumber),
  }),
);

/* ------------------------------------------------------------------ *
 *  13 · staff_photos  (production-safe photo reference — NOT base64)  *
 * ------------------------------------------------------------------ */

export const staffPhotos = mysqlTable(
  "staff_photos",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    storage: mysqlEnum("storage", PHOTO_STORAGES).notNull().default("local"),
    /** relative path (protected upload dir) or object-storage key */
    path: varchar("path", { length: 500 }).notNull(),
    /** resolved public/signed URL, when applicable */
    url: varchar("url", { length: 1000 }),
    mime: varchar("mime", { length: 100 }),
    bytes: int("bytes", { unsigned: true }),
    width: int("width", { unsigned: true }),
    height: int("height", { unsigned: true }),
    uploadedByUserId: int("uploaded_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    userIdx: index("staff_photos_user_idx").on(t.userId),
  }),
);

/* ------------------------------------------------------------------ *
 *  14 · sessions  (server-side auth — httpOnly cookie holds the id)  *
 * ------------------------------------------------------------------ */

export const sessions = mysqlTable(
  "sessions",
  {
    /** opaque random token (store the value; rotate on login) */
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    createdAt: dt("created_at").notNull(),
    lastSeenAt: dt("last_seen_at").notNull(),
    expiresAt: dt("expires_at").notNull(),
    ip: varchar("ip", { length: 45 }),
    userAgent: varchar("user_agent", { length: 255 }),
    revokedAt: dt("revoked_at"),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
    expiresIdx: index("sessions_expires_idx").on(t.expiresAt),
  }),
);

/* ------------------------------------------------------------------ *
 *  16 · attendance  (HR Attendance Foundation — Phase 10)            *
 *                                                                    *
 *  ONE row per (user, operational shift date). DERIVED from the      *
 *  authenticated `sessions` (Phase 9A) — NOT a second login tracker  *
 *  — and persisted so future HR rules (2 late = 1 off, regularity    *
 *  bonus, salary slip…) keep working after old session rows are      *
 *  purged. Raw facts only: no leave / holiday / off-conversion /     *
 *  incentive logic here.                                             *
 * ------------------------------------------------------------------ */

export const attendance = mysqlTable(
  "attendance",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    /** role / process snapshot at record time (a user's role can change later) */
    role: mysqlEnum("role", ROLES).notNull(),
    process: mysqlEnum("process", PROCESS_CODES).notNull(),
    shiftName: varchar("shift_name", { length: 40 }).notNull(),

    /** operational SHIFT DATE (shiftDateIST) — the business day */
    operationalDate: dcol("operational_date").notNull(),

    /** shift anchors for that operational date, IST wall-clock */
    reportingAt: dt("reporting_at").notNull(),
    shiftStartAt: dt("shift_start_at").notNull(),
    shiftEndAt: dt("shift_end_at").notNull(),

    firstCheckInAt: dt("first_check_in_at"),
    lastCheckOutAt: dt("last_check_out_at"),

    /** merged (de-overlapped) total session duration for the day, minutes */
    totalMinutes: int("total_minutes", { unsigned: true }).notNull().default(0),
    lateMinutes: int("late_minutes", { unsigned: true }).notNull().default(0),
    earlyDepartureMinutes: int("early_departure_minutes", { unsigned: true }).notNull().default(0),

    checkInStatus: mysqlEnum("check_in_status", ATTENDANCE_CHECK_IN_STATUSES)
      .notNull()
      .default("PENDING"),
    checkOutStatus: mysqlEnum("check_out_status", ATTENDANCE_CHECK_OUT_STATUSES)
      .notNull()
      .default("PENDING"),
    status: mysqlEnum("status", ATTENDANCE_STATUSES).notNull().default("PENDING"),
    shortAttendance: boolean("short_attendance").notNull().default(false),

    /** distinct sessions that contributed to this day */
    sessionCount: int("session_count", { unsigned: true }).notNull().default(0),

    source: mysqlEnum("source", ATTENDANCE_SOURCES).notNull().default("derived"),

    /* --- correction / audit trail (set only when an Admin/HR corrects a row) --- */
    correctedByUserId: int("corrected_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    correctedAt: dt("corrected_at"),
    correctionReason: varchar("correction_reason", { length: 500 }),
    /** the derived values BEFORE the first correction — history is never lost */
    originalSnapshot: json("original_snapshot"),

    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    dayUq: unique("attendance_user_day_uq").on(t.userId, t.operationalDate),
    dateIdx: index("attendance_date_idx").on(t.operationalDate),
    userDateIdx: index("attendance_user_date_idx").on(t.userId, t.operationalDate),
    statusIdx: index("attendance_status_idx").on(t.status),
    processIdx: index("attendance_process_idx").on(t.process),
  }),
);

/* ------------------------------------------------------------------ *
 *  15 · schema_meta  (one-row marker: has production been seeded?)    *
 *  Keeps demo/seed data strictly separate from production (Phase 19). *
 * ------------------------------------------------------------------ */

export const schemaMeta = mysqlTable("schema_meta", {
  id: int("id", { unsigned: true }).primaryKey().default(1),
  /** "empty" until an admin explicitly imports or an admin user is created */
  dataMode: mysqlEnum("data_mode", ["empty", "production", "demo"]).notNull().default("empty"),
  seededAt: dt("seeded_at"),
  appVersion: varchar("app_version", { length: 40 }),
  note: varchar("note", { length: 255 }),
});

/* ------------------------------------------------------------------ *
 *  Relations (typed joins for Drizzle query API)                     *
 * ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ one, many }) => ({
  agent: one(agents, { fields: [users.id], references: [agents.userId] }),
  closer: one(closers, { fields: [users.id], references: [closers.userId] }),
  photo: one(staffPhotos, { fields: [users.photoAssetId], references: [staffPhotos.id] }),
  ownedFollowUps: many(followUps),
  notifications: many(notifications),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  user: one(users, { fields: [agents.userId], references: [users.id] }),
  leads: many(leads),
}));

export const closersRelations = relations(closers, ({ one, many }) => ({
  user: one(users, { fields: [closers.userId], references: [users.id] }),
  assignedLeads: many(leads),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  agent: one(agents, { fields: [leads.agentId], references: [agents.id] }),
  assignedCloser: one(closers, { fields: [leads.assignedCloserId], references: [closers.id] }),
  convertedFromFollowUp: one(followUps, {
    fields: [leads.convertedFromFollowUpId],
    references: [followUps.id],
  }),
  import: one(imports, { fields: [leads.importId], references: [imports.id] }),
  assignments: many(leadAssignments),
}));

export const leadAssignmentsRelations = relations(leadAssignments, ({ one }) => ({
  lead: one(leads, { fields: [leadAssignments.leadId], references: [leads.id] }),
  fromCloser: one(closers, { fields: [leadAssignments.fromCloserId], references: [closers.id] }),
  toCloser: one(closers, { fields: [leadAssignments.toCloserId], references: [closers.id] }),
  by: one(users, { fields: [leadAssignments.byUserId], references: [users.id] }),
}));

export const followUpsRelations = relations(followUps, ({ one, many }) => ({
  owner: one(users, { fields: [followUps.ownerUserId], references: [users.id] }),
  createdBy: one(users, { fields: [followUps.createdByUserId], references: [users.id] }),
  lead: one(leads, { fields: [followUps.leadId], references: [leads.id] }),
  attempts: many(followUpAttempts),
  import: one(imports, { fields: [followUps.importId], references: [imports.id] }),
}));

export const followUpAttemptsRelations = relations(followUpAttempts, ({ one }) => ({
  followUp: one(followUps, { fields: [followUpAttempts.followUpId], references: [followUps.id] }),
  recordedBy: one(users, { fields: [followUpAttempts.recordedByUserId], references: [users.id] }),
  relatedLead: one(leads, { fields: [followUpAttempts.relatedLeadId], references: [leads.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, { fields: [notifications.recipientUserId], references: [users.id] }),
}));

export const emailJobsRelations = relations(emailJobs, ({ one }) => ({
  toUser: one(users, { fields: [emailJobs.toUserId], references: [users.id] }),
}));

export const importsRelations = relations(imports, ({ one, many }) => ({
  uploadedBy: one(users, { fields: [imports.uploadedByUserId], references: [users.id] }),
  rows: many(importRows),
  errors: many(importErrors),
}));

export const importRowsRelations = relations(importRows, ({ one }) => ({
  import: one(imports, { fields: [importRows.importId], references: [imports.id] }),
}));

export const importErrorsRelations = relations(importErrors, ({ one }) => ({
  import: one(imports, { fields: [importErrors.importId], references: [imports.id] }),
}));

export const staffPhotosRelations = relations(staffPhotos, ({ one }) => ({
  user: one(users, { fields: [staffPhotos.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

/* ------------------------------------------------------------------ *
 *  Inferred row types (for the API / service layer)                  *
 * ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type Closer = typeof closers.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadAssignment = typeof leadAssignments.$inferSelect;
export type NewLeadAssignment = typeof leadAssignments.$inferInsert;
export type FollowUp = typeof followUps.$inferSelect;
export type NewFollowUp = typeof followUps.$inferInsert;
export type FollowUpAttempt = typeof followUpAttempts.$inferSelect;
export type NewFollowUpAttempt = typeof followUpAttempts.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type EmailJob = typeof emailJobs.$inferSelect;
export type NewEmailJob = typeof emailJobs.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type ImportBatch = typeof imports.$inferSelect;
export type NewImportBatch = typeof imports.$inferInsert;
export type ImportRow = typeof importRows.$inferSelect;
export type NewImportRow = typeof importRows.$inferInsert;
export type ImportError = typeof importErrors.$inferSelect;
export type NewImportError = typeof importErrors.$inferInsert;
export type StaffPhoto = typeof staffPhotos.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Attendance = typeof attendance.$inferSelect;
export type NewAttendance = typeof attendance.$inferInsert;
