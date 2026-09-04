/**
 * Officeverse — production database schema (MySQL / MariaDB).
 *
 * Dialect: mysql (drizzle-orm/mysql-core). Target: GoDaddy cPanel MySQL/MariaDB.
 *
 * CONVENTIONS
 * -----------
 * - Every table has an internal auto-increment `id` used for foreign keys.
 *   Business-facing identifiers (Lead code "TMI_00012007", Follow-up code
 *   "FU_00004415", Agent "TMI_CC_001", Closer "TMI_CL_001", Client "CLT-00001")
 *   are kept as their own UNIQUE `*_code` column so the existing Officeverse ID
 *   conventions are preserved exactly.
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
  customType,
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

/** Arbitrary binary bytes, stored as a genuine SQL LONGBLOB (not base64 text). */
const longblob = customType<{ data: Buffer }>({
  dataType() {
    return "longblob";
  },
});

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
  // Agent-side UAT #15 / #16 — cron-driven daily emails
  "FOLLOW_UP_DAILY_SUMMARY",
  "BIRTHDAY_GREETING",
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
export const PHOTO_STORAGES = ["local", "s3", "r2", "supabase", "database", "memory"] as const;
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

/* HR Leave / Off / Sandwich engine (Phase 11). Regularity bonus, salary
 * slip, closer incentive and holiday-calendar POPULATION remain DEFERRED. */
export const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export const LEAVE_DAY_TYPES = ["ORIGINAL", "SANDWICH_WEEKEND", "SANDWICH_HOLIDAY"] as const;
export const OFF_TYPES = [
  "LATE_CONVERSION",
  "SHORT_ATTENDANCE_CONVERSION",
  "WEEKLY_OFF",
  "OTHER_COMPANY_OFF",
] as const;
export const OFF_STATUSES = ["ACTIVE", "VOID"] as const;
export const HOLIDAY_TYPES = ["US_FEDERAL", "INDIAN", "COMPANY", "WEEKLY_OFF"] as const;

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
    /** canonical business "Agent ID", e.g. "TMI_CC_001" (legacy "AG-#####" rows
     *  migrated by 0025) */
    agentCode: varchar("agent_code", { length: 24 }).notNull(),
    dob: dcol("dob"),
    monthlySalary: decimal("monthly_salary", { precision: 12, scale: 2 }).notNull().default("0.00"),
    /** Date of Registration = operational SHIFT DATE (Phase 7) */
    registeredOn: dcol("registered_on").notNull(),
    /** Admin UAT Batch-2 follow-up §2 — official JOINING DATE. Authoritative
     *  employee data; drives the salary-profile effective-from date and appears
     *  on the salary slip. Nullable only so pre-existing rows migrate cleanly —
     *  the create form always supplies it. */
    joiningDate: dcol("joining_date"),
    /** Staff Profile Management — work anniversary date, Admin/HR-correctable.
     *  Distinct from `joiningDate`; nullable (not captured at creation). */
    anniversaryDate: dcol("anniversary_date"),
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
    /** canonical business "Closer ID", e.g. "TMI_CL_001" (legacy "CL-#####" rows
     *  migrated by 0025) */
    closerCode: varchar("closer_code", { length: 24 }).notNull(),
    dob: dcol("dob"),
    registeredOn: dcol("registered_on").notNull(),
    /** Staff Profile Management — work anniversary date, Admin/HR-correctable. */
    anniversaryDate: dcol("anniversary_date"),
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
 *  13a · storage_blobs  (durable key→bytes store, existing MySQL DB) *
 *  Backs the Vercel-safe "database" provider for photo-storage.ts and *
 *  live/asset-storage.ts — the same role `company_profile.logo_data`  *
 *  already plays for the company logo, generalised to a keyed table   *
 *  instead of one singleton row. Callers own the key namespace        *
 *  (e.g. "photos/…", "celebrations/…"); this table has no opinion on  *
 *  what a key means. NOT for large/unbounded files — salary-slip PDFs *
 *  and lead documents keep their existing filesystem/memory stores.   *
 * ------------------------------------------------------------------ */

export const storageBlobs = mysqlTable("storage_blobs", {
  storageKey: varchar("storage_key", { length: 500 }).primaryKey(),
  bytes: longblob("bytes").notNull(),
  mime: varchar("mime", { length: 100 }),
  sizeBytes: int("size_bytes", { unsigned: true }).notNull(),
  createdAt: dt("created_at").notNull(),
  updatedAt: dt("updated_at"),
});

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
    /* Phase 23 — office-network context, resolved SERVER-SIDE at login */
    /** the server-observed public request IP at session creation */
    originIp: varchar("origin_ip", { length: 45 }),
    /** matched office_networks.id, or null when the login was remote */
    officeNetworkId: int("office_network_id", { unsigned: true }),
    /** true only when the login came from an authorized office network AND the
     *  role's attendance is office-gated — the ONLY sessions attendance counts */
    attendanceEligible: boolean("attendance_eligible").notNull().default(false),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
    expiresIdx: index("sessions_expires_idx").on(t.expiresAt),
  }),
);

/* ------------------------------------------------------------------ *
 *  16a · office_networks  (Phase 23 — authorized office IP/CIDR)      *
 *                                                                    *
 *  Server-observed public request IP is matched against the ACTIVE   *
 *  rows here to decide (a) whether an Agent may access the CRM at all *
 *  and (b) whether a session's day counts toward attendance. Managed  *
 *  by HR / Admin only; every change is audited. Never a single        *
 *  hard-coded IP.                                                     *
 * ------------------------------------------------------------------ */

export const officeNetworks = mysqlTable(
  "office_networks",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    /** IPv4/IPv6 CIDR, e.g. "203.0.113.7/32" or "198.51.100.0/24" */
    cidr: varchar("cidr", { length: 64 }).notNull(),
    /** null = applies to every process; otherwise scoped to one process */
    process: mysqlEnum("process", PROCESS_CODES),
    enabled: boolean("enabled").notNull().default(true),
    note: varchar("note", { length: 255 }),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    updatedByUserId: int("updated_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
    disabledAt: dt("disabled_at"),
  },
  (t) => ({
    enabledIdx: index("office_networks_enabled_idx").on(t.enabled),
    processIdx: index("office_networks_process_idx").on(t.process),
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
 *  16b · shift_overrides  (Admin UAT Batch-2 follow-up §1)           *
 *  A per-(process, operational-date) replacement of the default      *
 *  shift window + late boundaries — temporary Saturday shifts, early *
 *  shifts, DST / seasonal changes. Admin-only. Attendance for that   *
 *  date classifies against the effective row; a row added later for  *
 *  a different date never rewrites earlier attendance (touch only    *
 *  ever recomputes the CURRENT operational date, and never a         *
 *  corrected row).                                                   *
 * ------------------------------------------------------------------ */

export const shiftOverrides = mysqlTable(
  "shift_overrides",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    process: mysqlEnum("process", PROCESS_CODES).notNull(),
    /** the operational SHIFT DATE this override applies to ("YYYY-MM-DD") */
    operationalDate: dcol("operational_date").notNull(),
    /** "HH:MM" 24h IST */
    startHhmm: varchar("start_hhmm", { length: 5 }).notNull(),
    endHhmm: varchar("end_hhmm", { length: 5 }).notNull(),
    /** optional explicit late boundaries; when null they are derived from the
     *  start time (reporting = start[-10m for US], short-late = reporting+1m,
     *  late = start+31m) — the same shape as the frozen default rules. */
    reportingHhmm: varchar("reporting_hhmm", { length: 5 }),
    shortLateFromHhmm: varchar("short_late_from_hhmm", { length: 5 }),
    lateFromHhmm: varchar("late_from_hhmm", { length: 5 }),
    reason: varchar("reason", { length: 255 }),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    updatedByUserId: int("updated_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    processDateUq: unique("shift_overrides_process_date_uq").on(t.process, t.operationalDate),
    dateIdx: index("shift_overrides_date_idx").on(t.operationalDate),
  }),
);

/* ------------------------------------------------------------------ *
 *  17 · leave_requests  (HR Leave / Off / Sandwich — Phase 11)       *
 *  Calendar-date based (NOT operational shift date). Only APPROVED   *
 *  rows participate in the sandwich calculation.                     *
 * ------------------------------------------------------------------ */

export const leaveRequests = mysqlTable(
  "leave_requests",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    /** simple extensible label — not a fixed catalogue */
    leaveType: varchar("leave_type", { length: 40 }).notNull().default("general"),
    /** Phase 16 foundation: paid (default) vs unpaid. Regularity-Bonus
     *  eligibility is UNAFFECTED — any approved leave still forfeits the bonus.
     *  The per-day monetary deduction rate for an unpaid day is an undefined
     *  business decision, so payroll currently deducts ₹0 for unpaid leave. */
    unpaid: boolean("unpaid").notNull().default(false),
    startDate: dcol("start_date").notNull(),
    endDate: dcol("end_date").notNull(),
    status: mysqlEnum("status", LEAVE_STATUSES).notNull().default("PENDING"),
    reason: varchar("reason", { length: 500 }),
    createdByUserId: int("created_by_user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    approvedByUserId: int("approved_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    approvedAt: dt("approved_at"),
    decisionNote: varchar("decision_note", { length: 500 }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    userIdx: index("leave_requests_user_idx").on(t.userId, t.startDate),
    statusIdx: index("leave_requests_status_idx").on(t.status),
    startIdx: index("leave_requests_start_idx").on(t.startDate),
  }),
);

/* ------------------------------------------------------------------ *
 *  18 · leave_days  (calculated expansion: ORIGINAL + SANDWICH)      *
 *  The employee's original request is never mutated — this is the    *
 *  audit-safe, idempotent derived view of what actually counts.      *
 * ------------------------------------------------------------------ */

export const leaveDays = mysqlTable(
  "leave_days",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    leaveRequestId: bigint("leave_request_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => leaveRequests.id, { onDelete: "cascade", onUpdate: "cascade" }),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    leaveDate: dcol("leave_date").notNull(),
    dayType: mysqlEnum("day_type", LEAVE_DAY_TYPES).notNull(),
    /** why a SANDWICH day counts — e.g. SATURDAY / SUNDAY / US_FEDERAL / COMPANY */
    nonWorkingReason: varchar("non_working_reason", { length: 60 }),
    calculatedAt: dt("calculated_at").notNull(),
    ruleVersion: varchar("rule_version", { length: 16 }).notNull().default("v1"),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    reqDayUq: unique("leave_days_req_day_uq").on(t.leaveRequestId, t.leaveDate),
    userDateIdx: index("leave_days_user_date_idx").on(t.userId, t.leaveDate),
    reqIdx: index("leave_days_req_idx").on(t.leaveRequestId),
  }),
);

/* ------------------------------------------------------------------ *
 *  19 · off_records  (Late→Off / Short→Off conversions — Phase 11)   *
 *  A SEPARATE HR concept from leave. Idempotent via the unique key   *
 *  (user, off_type, month, off_index).                               *
 * ------------------------------------------------------------------ */

export const offRecords = mysqlTable(
  "off_records",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    offType: mysqlEnum("off_type", OFF_TYPES).notNull(),
    /** month the conversion belongs to, "YYYY-MM" */
    periodMonth: varchar("period_month", { length: 7 }).notNull(),
    /** 1-based ordinal within (user, off_type, month) — the idempotency handle */
    offIndex: int("off_index", { unsigned: true }).notNull(),
    /** qualifying events consumed (2 for a Late Off, 3 for a Short Off) */
    sourceCount: int("source_count", { unsigned: true }).notNull(),
    sourceDescription: varchar("source_description", { length: 200 }).notNull(),
    status: mysqlEnum("status", OFF_STATUSES).notNull().default("ACTIVE"),
    calculatedAt: dt("calculated_at").notNull(),
    ruleVersion: varchar("rule_version", { length: 16 }).notNull().default("v1"),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    idemUq: unique("off_records_idem_uq").on(t.userId, t.offType, t.periodMonth, t.offIndex),
    userMonthIdx: index("off_records_user_month_idx").on(t.userId, t.periodMonth),
    typeIdx: index("off_records_type_idx").on(t.offType),
  }),
);

/* ------------------------------------------------------------------ *
 *  20 · holidays  (STRUCTURE ONLY — no dates populated in Phase 11)  *
 *  The sandwich engine reads non-working days through a provider so  *
 *  weekends work with zero data here; calendar population is a later *
 *  dedicated phase.                                                  *
 * ------------------------------------------------------------------ */

export const holidays = mysqlTable(
  "holidays",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    /** the ACTUAL calendar date of the holiday */
    holidayDate: dcol("holiday_date").notNull(),
    /** the OBSERVED date used for company scheduling (null = same as holidayDate).
     *  The sandwich engine uses observedDate ?? holidayDate as the effective
     *  non-working day, so a holiday is never counted twice. */
    observedDate: dcol("observed_date"),
    name: varchar("name", { length: 120 }).notNull(),
    holidayType: mysqlEnum("holiday_type", HOLIDAY_TYPES).notNull(),
    /** null = every process; otherwise scoped to one process */
    appliesToProcess: mysqlEnum("applies_to_process", PROCESS_CODES),
    /** true when observedDate differs from holidayDate (weekend shift) */
    observed: boolean("observed").notNull().default(false),
    /** inactive holidays are excluded from the calendar + the sandwich engine */
    active: boolean("active").notNull().default(true),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    updatedByUserId: int("updated_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    dayTypeUq: unique("holidays_day_type_uq").on(t.holidayDate, t.holidayType, t.appliesToProcess),
    dateIdx: index("holidays_date_idx").on(t.holidayDate),
    activeIdx: index("holidays_active_idx").on(t.active, t.holidayDate),
  }),
);

/* ------------------------------------------------------------------ *
 *  21 · regularity_bonus  (₹1,000 monthly bonus — Phase 12)          *
 *  Durable, idempotent per (user, month). Consumes the authoritative *
 *  Phase-11 outputs (approved leave_days + effective off_records) —  *
 *  never attendance.status directly. Recalculable at any time.       *
 * ------------------------------------------------------------------ */

export const regularityBonus = mysqlTable(
  "regularity_bonus",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    /** applicable calendar month, "YYYY-MM" */
    periodMonth: varchar("period_month", { length: 7 }).notNull(),
    eligible: boolean("eligible").notNull(),
    /** whole rupees — 1000 when eligible, 0 otherwise */
    bonusAmount: int("bonus_amount", { unsigned: true }).notNull().default(0),
    leaveCount: int("leave_count", { unsigned: true }).notNull().default(0),
    offCount: int("off_count", { unsigned: true }).notNull().default(0),
    /** machine codes, e.g. ["APPROVED_LEAVE","OFF_RECORDED"] */
    disqualifyingReasons: json("disqualifying_reasons"),
    calculatedAt: dt("calculated_at").notNull(),
    calculationVersion: varchar("calculation_version", { length: 16 }).notNull().default("v1"),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    userMonthUq: unique("regularity_bonus_user_month_uq").on(t.userId, t.periodMonth),
    monthIdx: index("regularity_bonus_month_idx").on(t.periodMonth),
    eligibleIdx: index("regularity_bonus_eligible_idx").on(t.eligible),
  }),
);

/* ------------------------------------------------------------------ *
 *  22 · salary_profiles  (effective-dated base salary — Phase 13)     *
 *  One authoritative base-salary source for EVERY user (not just      *
 *  agents). Effective-dated so a later raise never rewrites a past    *
 *  month's payroll. Whether leave / Off / attendance have any        *
 *  monetary effect is NOT decided here — that policy is deferred.     *
 * ------------------------------------------------------------------ */

export const salaryProfiles = mysqlTable(
  "salary_profiles",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    /** monthly base salary in rupees (paise allowed). Never negative — the
     *  service validates before write. */
    baseSalary: decimal("base_salary", { precision: 12, scale: 2 }).notNull().default("0.00"),
    /** first calendar day this base salary applies from ("YYYY-MM-DD") */
    effectiveFrom: dcol("effective_from").notNull(),
    /** last calendar day it applies (null = still in effect) */
    effectiveTo: dcol("effective_to"),
    active: boolean("active").notNull().default(true),
    note: varchar("note", { length: 255 }),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    updatedByUserId: int("updated_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    userFromUq: unique("salary_profiles_user_from_uq").on(t.userId, t.effectiveFrom),
    userIdx: index("salary_profiles_user_idx").on(t.userId, t.effectiveFrom),
    activeIdx: index("salary_profiles_active_idx").on(t.active),
  }),
);

/* ------------------------------------------------------------------ *
 *  23 · payroll_runs  (monthly salary snapshot — Phase 13)            *
 *  DRAFT → CALCULATED → APPROVED → LOCKED. One row per (user, month). *
 *  Every money value is SNAPSHOTTED so a future salary slip is        *
 *  reproducible even after salary config or bonus rows change.        *
 *  calculatedSalary = baseSalary + regularityBonus  — nothing else.   *
 *  NO incentive / commission / tax / statutory field exists here by   *
 *  design; those rules are not frozen.                                *
 * ------------------------------------------------------------------ */

export const PAYROLL_STATUSES = ["DRAFT", "CALCULATED", "APPROVED", "LOCKED"] as const;

export const payrollRuns = mysqlTable(
  "payroll_runs",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    /** calendar payroll month, "YYYY-MM" */
    periodMonth: varchar("period_month", { length: 7 }).notNull(),
    /** snapshot of the employee's process at calculation time */
    process: mysqlEnum("process", PROCESS_CODES).notNull(),
    status: mysqlEnum("status", PAYROLL_STATUSES).notNull().default("DRAFT"),
    /** ---- snapshotted values ---- */
    baseSalary: decimal("base_salary", { precision: 12, scale: 2 }).notNull().default("0.00"),
    regularityBonus: int("regularity_bonus", { unsigned: true }).notNull().default(0),
    calculatedSalary: decimal("calculated_salary", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    leaveCount: int("leave_count", { unsigned: true }).notNull().default(0),
    offCount: int("off_count", { unsigned: true }).notNull().default(0),
    /* ---- Phase 16 breakdown (additive; every rate defaults to 0 until the
     *      corresponding business rule is defined) ---- */
    /** full-month base (== base_salary unless proration applies) */
    monthlyBaseSalary: decimal("monthly_base_salary", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    /** base salary actually payable after proration */
    payableBaseSalary: decimal("payable_base_salary", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    /** null = no proration applied (full month); e.g. "CALENDAR_DAYS" */
    prorationBasis: varchar("proration_basis", { length: 24 }),
    prorationNumerator: int("proration_numerator", { unsigned: true }).notNull().default(0),
    prorationDenominator: int("proration_denominator", { unsigned: true }).notNull().default(0),
    unpaidLeaveDays: int("unpaid_leave_days", { unsigned: true }).notNull().default(0),
    unpaidLeaveDeduction: decimal("unpaid_leave_deduction", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    offDaysConsidered: int("off_days_considered", { unsigned: true }).notNull().default(0),
    offDeduction: decimal("off_deduction", { precision: 12, scale: 2 }).notNull().default("0.00"),
    approvedOvertimeMinutes: int("approved_overtime_minutes", { unsigned: true })
      .notNull()
      .default(0),
    overtimeAmount: decimal("overtime_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    adjustmentsTotal: decimal("adjustments_total", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    /* ---- Admin UAT Batch-2 §5 — Late-Units (see server/hr/late-units.ts).
     *      Additive; all default to 0 so pre-Batch-2 rows keep their meaning.
     *      lateDeduction is the ONE-day salary cut when lateUnits ≥ 3. ---- */
    lateShortCount: int("late_short_count", { unsigned: true }).notNull().default(0),
    lateFullCount: int("late_full_count", { unsigned: true }).notNull().default(0),
    lateUnits: decimal("late_units", { precision: 4, scale: 1 }).notNull().default("0.0"),
    lateDeduction: decimal("late_deduction", { precision: 12, scale: 2 }).notNull().default("0.00"),
    /** provenance — which config / bonus row produced this snapshot */
    salaryProfileId: bigint("salary_profile_id", { mode: "number", unsigned: true }).references(
      () => salaryProfiles.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    bonusRecordId: bigint("bonus_record_id", { mode: "number", unsigned: true }).references(
      () => regularityBonus.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    calculationVersion: varchar("calculation_version", { length: 16 }).notNull().default("v1"),
    calculatedByUserId: int("calculated_by_user_id", { unsigned: true }).references(
      () => users.id,
      {
        onDelete: "set null",
        onUpdate: "cascade",
      },
    ),
    calculatedAt: dt("calculated_at"),
    approvedByUserId: int("approved_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    approvedAt: dt("approved_at"),
    lockedByUserId: int("locked_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    lockedAt: dt("locked_at"),
    /** explicit authorized correction trail — a LOCKED/APPROVED run is never
     *  silently mutated; it must be reopened first, with a reason. */
    reopenedByUserId: int("reopened_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    reopenedAt: dt("reopened_at"),
    reopenReason: varchar("reopen_reason", { length: 255 }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    userMonthUq: unique("payroll_runs_user_month_uq").on(t.userId, t.periodMonth),
    monthIdx: index("payroll_runs_month_idx").on(t.periodMonth),
    statusIdx: index("payroll_runs_status_idx").on(t.status),
  }),
);

/* ================================================================== *
 *  Phase 16 payroll-input FOUNDATIONS (additive; no monetary rate is  *
 *  invented — the service supplies 0 until each rule is defined).      *
 * ================================================================== */

/* -- 24a · employment_periods -------------------------------------- *
 *  Historical join / exit dates. Proration reads these (never the     *
 *  current date). NO field for this existed before Phase 16.          */
export const employmentPeriods = mysqlTable(
  "employment_periods",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    /** inclusive first day worked */
    startDate: dcol("start_date").notNull(),
    /** inclusive last day worked, null = still employed */
    endDate: dcol("end_date"),
    active: boolean("active").notNull().default(true),
    note: varchar("note", { length: 255 }),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    updatedByUserId: int("updated_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    userStartUq: unique("employment_periods_user_start_uq").on(t.userId, t.startDate),
    userIdx: index("employment_periods_user_idx").on(t.userId, t.startDate),
  }),
);

/* -- 24b · overtime_records -------------------------------------- *
 *  FOUNDATION ONLY. Duration is recorded + approved; there is no      *
 *  overtime RATE, so payroll snapshots minutes and pays ₹0.          */
export const OVERTIME_STATUSES = ["PENDING", "APPROVED", "REJECTED", "VOID"] as const;

export const overtimeRecords = mysqlTable(
  "overtime_records",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    workDate: dcol("work_date").notNull(),
    /** calendar payroll month the OT belongs to, "YYYY-MM" */
    periodMonth: varchar("period_month", { length: 7 }).notNull(),
    scheduledShiftStart: varchar("scheduled_shift_start", { length: 5 }),
    scheduledShiftEnd: varchar("scheduled_shift_end", { length: 5 }),
    /** IST wall-clock "YYYY-MM-DD HH:MM:SS" */
    actualLogout: dt("actual_logout"),
    overtimeMinutes: int("overtime_minutes", { unsigned: true }).notNull().default(0),
    status: mysqlEnum("status", OVERTIME_STATUSES).notNull().default("PENDING"),
    reason: varchar("reason", { length: 255 }),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    approvedByUserId: int("approved_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    approvedAt: dt("approved_at"),
    /** set when a payroll run consumed this record */
    payrollRunId: bigint("payroll_run_id", { mode: "number", unsigned: true }).references(
      () => payrollRuns.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    userDateUq: unique("overtime_records_user_date_uq").on(t.userId, t.workDate),
    monthStatusIdx: index("overtime_records_month_status_idx").on(t.periodMonth, t.status),
    userMonthIdx: index("overtime_records_user_month_idx").on(t.userId, t.periodMonth),
  }),
);

/* -- 24c · payroll_adjustments --------------------------------- *
 *  Explicit, Admin/HR-entered, labelled monetary adjustment for a    *
 *  user + month. Each amount is TYPED BY HR (not invented). Signed:   *
 *  EARNING adds, DEDUCTION subtracts.                                */
export const PAYROLL_ADJUSTMENT_KINDS = ["EARNING", "DEDUCTION"] as const;
export const PAYROLL_ADJUSTMENT_STATUSES = ["ACTIVE", "VOID"] as const;

export const payrollAdjustments = mysqlTable(
  "payroll_adjustments",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    periodMonth: varchar("period_month", { length: 7 }).notNull(),
    kind: mysqlEnum("kind", PAYROLL_ADJUSTMENT_KINDS).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    /** always stored as a NON-NEGATIVE magnitude; `kind` carries the sign */
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    status: mysqlEnum("status", PAYROLL_ADJUSTMENT_STATUSES).notNull().default("ACTIVE"),
    reason: varchar("reason", { length: 255 }),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    voidedByUserId: int("voided_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    userMonthIdx: index("payroll_adjustments_user_month_idx").on(t.userId, t.periodMonth),
    statusIdx: index("payroll_adjustments_status_idx").on(t.status),
  }),
);

/* ------------------------------------------------------------------ *
 *  24 · salary_slips  (document layer over a payroll_run — Phase 14)  *
 *  A PRESENTATION record: it never recalculates salary. Every value   *
 *  is snapshotted from the APPROVED / LOCKED payroll_run at generation *
 *  time, so the historical slip stays identical even if the payroll   *
 *  is later reopened + recalculated (which creates a NEW version row, *
 *  never overwriting this one). No incentive / tax / statutory field. *
 * ------------------------------------------------------------------ */

export const SALARY_SLIP_STATUSES = ["GENERATED", "SENT", "FAILED"] as const;

export const salarySlips = mysqlTable(
  "salary_slips",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    payrollRunId: bigint("payroll_run_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "restrict", onUpdate: "cascade" }),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    periodMonth: varchar("period_month", { length: 7 }).notNull(),
    /** 1, then 2… when a reopened + recalculated payroll is regenerated */
    version: int("version", { unsigned: true }).notNull().default(1),
    status: mysqlEnum("status", SALARY_SLIP_STATUSES).notNull().default("GENERATED"),
    /** a non-final slip taken from a CALCULATED payroll — clearly marked, never
     *  the final historical document */
    isPreview: boolean("is_preview").notNull().default(false),
    /* ---- snapshot (authoritative payroll_run values at generation) ---- */
    employeeName: varchar("employee_name", { length: 200 }).notNull(),
    employeeEmail: varchar("employee_email", { length: 191 }).notNull(),
    process: mysqlEnum("process", PROCESS_CODES).notNull(),
    baseSalary: decimal("base_salary", { precision: 12, scale: 2 }).notNull().default("0.00"),
    regularityBonus: int("regularity_bonus", { unsigned: true }).notNull().default(0),
    calculatedSalary: decimal("calculated_salary", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    leaveCount: int("leave_count", { unsigned: true }).notNull().default(0),
    offCount: int("off_count", { unsigned: true }).notNull().default(0),
    payrollStatusAtGeneration: mysqlEnum(
      "payroll_status_at_generation",
      PAYROLL_STATUSES,
    ).notNull(),
    calculationVersion: varchar("calculation_version", { length: 16 }).notNull().default("v1"),
    /* ---- Admin UAT Batch-2 follow-up §3 — full breakdown snapshot ----
     *  Additive; every column defaults so pre-existing slip rows keep meaning.
     *  These freeze the exact figures the PDF renders so a re-render stays
     *  byte-identical even after payroll config / company branding changes. */
    monthlyBaseSalary: decimal("monthly_base_salary", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    payableBaseSalary: decimal("payable_base_salary", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    unpaidLeaveDays: int("unpaid_leave_days", { unsigned: true }).notNull().default(0),
    lateShortCount: int("late_short_count", { unsigned: true }).notNull().default(0),
    lateFullCount: int("late_full_count", { unsigned: true }).notNull().default(0),
    lateUnits: decimal("late_units", { precision: 4, scale: 1 }).notNull().default("0.0"),
    lateDeduction: decimal("late_deduction", { precision: 12, scale: 2 }).notNull().default("0.00"),
    employeeCode: varchar("employee_code", { length: 32 }).notNull().default(""),
    joiningDate: dcol("joining_date"),
    /* company branding, snapshotted at generation from the ONE central source */
    companyName: varchar("company_name", { length: 160 }).notNull().default("TMI Officeverse"),
    companyLegalName: varchar("company_legal_name", { length: 200 }),
    companyAddress: varchar("company_address", { length: 400 }),
    companyTaxId: varchar("company_tax_id", { length: 40 }),
    companyFooter: varchar("company_footer", { length: 400 }),
    companyLogoMime: varchar("company_logo_mime", { length: 64 }),
    /** base64 of the exact logo bytes used in this PDF (nullable) */
    companyLogoData: mediumtext("company_logo_data"),
    /* ---- document ---- */
    fileName: varchar("file_name", { length: 255 }).notNull(),
    /** opaque key into the storage abstraction (dev = in-memory) */
    storageKey: varchar("storage_key", { length: 500 }).notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    byteSize: int("byte_size", { unsigned: true }).notNull().default(0),
    /* ---- send bookkeeping (detail lives in salary_slip_sends) ---- */
    sendCount: int("send_count", { unsigned: true }).notNull().default(0),
    lastSentAt: dt("last_sent_at"),
    lastError: varchar("last_error", { length: 500 }),
    generatedByUserId: int("generated_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    generatedAt: dt("generated_at").notNull(),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    runVersionUq: unique("salary_slips_run_version_uq").on(t.payrollRunId, t.version),
    userMonthIdx: index("salary_slips_user_month_idx").on(t.userId, t.periodMonth),
    monthIdx: index("salary_slips_month_idx").on(t.periodMonth),
    statusIdx: index("salary_slips_status_idx").on(t.status),
  }),
);

/* ------------------------------------------------------------------ *
 *  25 · salary_slip_sends  (controlled resend history — Phase 14)     *
 *  DOCUMENT GENERATION and EMAIL SEND are separate: one slip row, N   *
 *  send-event rows. A send is only ever recorded after the provider   *
 *  confirms (SENT) or rejects (FAILED) — never optimistically.        *
 * ------------------------------------------------------------------ */

export const SALARY_SLIP_SEND_STATUSES = ["SENT", "FAILED"] as const;

export const salarySlipSends = mysqlTable(
  "salary_slip_sends",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    salarySlipId: bigint("salary_slip_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => salarySlips.id, { onDelete: "restrict", onUpdate: "cascade" }),
    attemptNo: int("attempt_no", { unsigned: true }).notNull(),
    status: mysqlEnum("status", SALARY_SLIP_SEND_STATUSES).notNull(),
    /** server-resolved recipient (from users.email) — never client-supplied */
    recipientEmail: varchar("recipient_email", { length: 191 }).notNull(),
    provider: varchar("provider", { length: 40 }),
    providerMessageId: varchar("provider_message_id", { length: 191 }),
    errorMessage: varchar("error_message", { length: 500 }),
    sentByUserId: int("sent_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    slipIdx: index("salary_slip_sends_slip_idx").on(t.salarySlipId),
  }),
);

/* ================================================================== *
 *  GAMIFICATION FOUNDATION (Phase 20)                                 *
 *  Points / leaderboard / achievements / streaks.                     *
 *                                                                    *
 *  NOT money. NOT payroll. NOT incentive/commission/Regularity Bonus. *
 *  Nothing here is ever consumed by any HR / payroll / salary-slip    *
 *  calculation. Point values are DATA-DRIVEN (gamification_point_rules *
 *  — default 0) and configured by an Admin, never hard-coded here.    *
 * ================================================================== */

export const GAMIFICATION_EVENTS = [
  "LEAD_SUBMITTED",
  "LEAD_ACCEPTED",
  "SALE",
  "TEAM_MILESTONE",
  "ACHIEVEMENT_UNLOCKED",
  "ADMIN_ADJUSTMENT",
] as const;

export const POINT_TXN_STATUSES = ["ACTIVE", "REVERSED"] as const;
export const POINT_TXN_SOURCES = ["system", "admin"] as const;
export const GAMIFICATION_STREAK_TYPES = ["ACCEPTED_LEAD_STREAK"] as const;

/* -- 26 · gamification_point_rules  (data-driven config; default 0) -- */
export const gamificationPointRules = mysqlTable(
  "gamification_point_rules",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    /**
     * Legacy flat-rule event key. Widened from an ENUM to VARCHAR(64) in
     * migration 0014 so the open-ended Scoring Engine can introduce new event
     * domains without a schema change. Existing values are unchanged and remain
     * valid; this table stays a read-only fallback (Scoring Engine phase 2+).
     */
    event: varchar("event", { length: 64 }).notNull(),
    /** points awarded for one occurrence — CONFIGURABLE, defaults to 0 */
    points: int("points").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    note: varchar("note", { length: 255 }),
    updatedByUserId: int("updated_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    eventUq: unique("gamification_point_rules_event_uq").on(t.event),
  }),
);

/* -- 27 · gamification_point_transactions  (immutable ledger) -------- *
 *  The user's total is DERIVED from these rows (ACTIVE minus REVERSED),*
 *  never a standalone mutable number. `dedupe_key` makes each business *
 *  event award-once.                                                  */
export const gamificationPointTransactions = mysqlTable(
  "gamification_point_transactions",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    role: mysqlEnum("role", ["agent", "closer"]).notNull(),
    process: mysqlEnum("process", PROCESS_CODES).notNull(),
    /**
     * Event key. Widened from an ENUM to VARCHAR(64) in migration 0014 so the
     * open-ended Scoring Engine can award against new event domains without a
     * schema change. Every pre-0014 value ("LEAD_SUBMITTED" … "ADMIN_ADJUSTMENT")
     * remains valid and unchanged.
     */
    event: varchar("event", { length: 64 }).notNull(),
    points: int("points").notNull(),
    /** operational SHIFT DATE the event belongs to, "YYYY-MM-DD" (server-derived) */
    operationalDate: dcol("operational_date").notNull(),
    /** what caused it — e.g. "lead" / "follow_up" / "milestone" / "achievement" */
    referenceType: varchar("reference_type", { length: 40 }),
    referenceId: varchar("reference_id", { length: 64 }),
    /** deterministic idempotency key: `<event>:<referenceType>:<referenceId>` */
    dedupeKey: varchar("dedupe_key", { length: 191 }).notNull(),
    status: mysqlEnum("status", POINT_TXN_STATUSES).notNull().default("ACTIVE"),
    source: mysqlEnum("source", POINT_TXN_SOURCES).notNull().default("system"),
    /** for a REVERSED row: which txn reversed it (audit trail, never deleted) */
    reversalOfId: bigint("reversal_of_id", { mode: "number", unsigned: true }),
    reason: varchar("reason", { length: 255 }),
    /* -- Scoring Engine attribution (migration 0014; all NULL for legacy rows). *
     *  A NULL rule_id means "pre-engine / legacy flat-rule award". The Scoring  *
     *  Engine writes every one of these so a point can be explained forever.    */
    ruleId: int("rule_id", { unsigned: true }).references((): AnyMySqlColumn => scoringRules.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    ruleVersion: int("rule_version"),
    ruleName: varchar("rule_name", { length: 120 }),
    /** evaluation context — payload fields that mattered, condition results, band chosen */
    context: json("context"),
    scoreRunId: bigint("score_run_id", { mode: "number", unsigned: true }).references(
      (): AnyMySqlColumn => scoringRuns.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    dedupeUq: unique("gamification_point_txn_dedupe_uq").on(t.dedupeKey),
    userDateIdx: index("gamification_point_txn_user_date_idx").on(t.userId, t.operationalDate),
    dateIdx: index("gamification_point_txn_date_idx").on(t.operationalDate),
    userStatusIdx: index("gamification_point_txn_user_status_idx").on(t.userId, t.status),
  }),
);

/* -- 28 · gamification_achievements  (data-driven registry) --------- */
export const gamificationAchievements = mysqlTable(
  "gamification_achievements",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    code: varchar("code", { length: 60 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: varchar("description", { length: 400 }),
    /** short glyph / badge token for PhotoDisplay */
    badge: varchar("badge", { length: 16 }),
    category: varchar("category", { length: 40 }).notNull().default("general"),
    /** machine criteria, e.g. { kind:"COUNT", event:"LEAD_ACCEPTED", threshold:0 } */
    criteria: json("criteria"),
    repeatable: boolean("repeatable").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    codeUq: unique("gamification_achievements_code_uq").on(t.code),
  }),
);

/* -- 29 · gamification_user_achievements  (award-once per user+code) - */
export const gamificationUserAchievements = mysqlTable(
  "gamification_user_achievements",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    achievementCode: varchar("achievement_code", { length: 60 }).notNull(),
    earnedAt: dt("earned_at").notNull(),
    /** the event/reference that satisfied the criteria */
    triggerType: varchar("trigger_type", { length: 40 }),
    triggerId: varchar("trigger_id", { length: 64 }),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (t) => ({
    userCodeUq: unique("gamification_user_achievement_uq").on(t.userId, t.achievementCode),
    userIdx: index("gamification_user_achievement_user_idx").on(t.userId),
  }),
);

/* -- 30 · gamification_streaks  (server-authoritative; not attendance) */
export const gamificationStreaks = mysqlTable(
  "gamification_streaks",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    streakType: mysqlEnum("streak_type", GAMIFICATION_STREAK_TYPES).notNull(),
    /** consecutive qualifying OPERATIONAL days */
    currentCount: int("current_count", { unsigned: true }).notNull().default(0),
    bestCount: int("best_count", { unsigned: true }).notNull().default(0),
    /** last operational date that satisfied the streak's event, "YYYY-MM-DD" */
    lastOperationalDate: dcol("last_operational_date"),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    userTypeUq: unique("gamification_streak_user_type_uq").on(t.userId, t.streakType),
  }),
);

/* ================================================================== *
 *  SCORING ENGINE FOUNDATION (Phase 2 — migration 0014)               *
 *                                                                    *
 *  Open-ended, Admin-configurable scoring. Completely separated from  *
 *  CRM operational workflows: nothing here is imported by leads /     *
 *  follow-ups / assignments / HR / payroll, and this layer never      *
 *  mutates a CRM row. It only APPENDS to the existing immutable        *
 *  gamification_point_transactions ledger (there is no second ledger). *
 *                                                                    *
 *  Additive-only. Ships with ZERO seeded scoring rules and behind the  *
 *  SCORING_ENGINE_ENABLED flag (default off). Point VALUES are 100%    *
 *  Admin-authored — never hard-coded, never money.                    *
 * ================================================================== */

export const SCORING_RULE_MATCHING_MODES = ["FIRST_MATCH", "HIGHEST_MATCH", "ALL_MATCHES"] as const;

/* -- scoring_rules  (MUTABLE header only — never condition/outcome) -- */
export const scoringRules = mysqlTable(
  "scoring_rules",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    /** BusinessEvent.type this rule scores — a domain string, validated by the event registry */
    event: varchar("event", { length: 64 }).notNull(),
    /** optional audience narrowing: { roles?, processes?, teams?, closerIds?, agentIds?, closerTenureDaysMin?, closerTenureDaysMax? } */
    appliesTo: json("applies_to"),
    ruleMatchingMode: mysqlEnum("rule_matching_mode", SCORING_RULE_MATCHING_MODES)
      .notNull()
      .default("FIRST_MATCH"),
    /** lower = evaluated first */
    priority: int("priority").notNull().default(100),
    enabled: boolean("enabled").notNull().default(false),
    /** points to the currently-active scoring_rule_versions.version */
    currentVersion: int("current_version").notNull().default(1),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    eventIdx: index("scoring_rules_event_idx").on(t.event),
    enabledEventIdx: index("scoring_rules_enabled_event_idx").on(t.enabled, t.event),
  }),
);

/* -- scoring_rule_versions  (IMMUTABLE snapshots — never updated) ---- *
 *  Editing a rule appends a new version; the historical ledger keeps    *
 *  scoring at the version that was effective on the event's operational *
 *  date. Version rows are the historical-integrity anchor.             */
export const scoringRuleVersions = mysqlTable(
  "scoring_rule_versions",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    ruleId: int("rule_id", { unsigned: true })
      .notNull()
      .references(() => scoringRules.id, { onDelete: "cascade", onUpdate: "cascade" }),
    version: int("version").notNull(),
    nameSnapshot: varchar("name_snapshot", { length: 120 }).notNull(),
    eventSnapshot: varchar("event_snapshot", { length: 64 }).notNull(),
    appliesToSnapshot: json("applies_to_snapshot"),
    /** arbitrarily nested { op:"AND"|"OR", nodes:[…] } with { field, operator, value, valueType } leaves; NULL = match-all */
    conditionTree: json("condition_tree"),
    /** { kind:"FLAT"|"BANDS"|"BASE_PLUS_BONUS", … } — points are Admin-authored, negatives allowed */
    outcome: json("outcome").notNull(),
    /** version selection window keyed on BusinessEvent.operationalDate: from <= date < until */
    effectiveFrom: dcol("effective_from").notNull(),
    effectiveUntil: dcol("effective_until"),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    ruleVersionUq: unique("scoring_rule_versions_rule_version_uq").on(t.ruleId, t.version),
    ruleIdx: index("scoring_rule_versions_rule_idx").on(t.ruleId),
  }),
);

/* -- scoring_runs  (audit of EVERY evaluated event; run-once) -------- *
 *  UNIQUE(event_type, source_type, source_id) makes ingest idempotent  *
 *  against retries / restarts / duplicate dispatch. A run row exists    *
 *  even when zero points were awarded.                                 */
export const scoringRuns = mysqlTable(
  "scoring_runs",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    subjectUserId: int("subject_user_id", { unsigned: true }).notNull(),
    operationalDate: dcol("operational_date").notNull(),
    occurredAt: dt("occurred_at").notNull(),
    payloadSnapshot: json("payload_snapshot"),
    matchedRuleIds: json("matched_rule_ids"),
    awardedPointsTotal: int("awarded_points_total").notNull().default(0),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    runUq: unique("scoring_runs_event_source_uq").on(t.eventType, t.sourceType, t.sourceId),
    subjectIdx: index("scoring_runs_subject_idx").on(t.subjectUserId),
  }),
);

/* ================================================================== *
 *  OFFICE TV / LIVE EXPERIENCE (Phase 21)                             *
 *                                                                    *
 *  A READ-ONLY live office scoreboard surface (/office-tv). It never  *
 *  mutates the CRM. It reads the Phase-20 authoritative leaderboard   *
 *  and a small recognition-event log. Admin broadcasts are            *
 *  ANNOUNCEMENTS ONLY — they never create payroll / salary /          *
 *  commission / incentive data. Points remain abstract, not money.    *
 * ================================================================== */

export const TV_ANNOUNCEMENT_AUDIENCES = ["all", "agents", "closers"] as const;
export const TV_ANNOUNCEMENT_PRIORITIES = ["NORMAL", "IMPORTANT", "URGENT"] as const;
export const TV_ANNOUNCEMENT_STATUSES = ["scheduled", "published", "stopped", "expired"] as const;
export const CELEBRATION_ASSET_KINDS = ["video", "effect"] as const;

/* -- 31 · office_tv_displays  (scoped, revocable display tokens) ----- *
 *  A TV authenticates with a hashed display token — NEVER an Admin     *
 *  account. Scope is read-only; no CRM / payroll / HR / user-mgmt.     */
export const officeTvDisplays = mysqlTable(
  "office_tv_displays",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    /** sha-256 hex of the bearer token; the raw token is shown once at creation */
    tokenHash: varchar("token_hash", { length: 191 }).notNull(),
    /** first 8 chars of the raw token — lets Admin identify a row without the secret */
    tokenPrefix: varchar("token_prefix", { length: 16 }).notNull(),
    /** read-only capability set; kept as a short string for forward-compat */
    scope: varchar("scope", { length: 40 }).notNull().default("tv_read"),
    enabled: boolean("enabled").notNull().default(true),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    lastSeenAt: dt("last_seen_at"),
    revokedAt: dt("revoked_at"),
    rotatedAt: dt("rotated_at"),
  },
  (t) => ({
    tokenHashUq: unique("office_tv_display_token_hash_uq").on(t.tokenHash),
  }),
);

/* -- 32 · office_tv_settings  (one-row TV configuration) ------------- *
 *  Minimum data-driven config for Phase 21. `third_accepted_threshold` *
 *  is a CELEBRATION threshold only — it is NOT a salary/incentive      *
 *  rule and never creates money.                                       */
export const officeTvSettings = mysqlTable("office_tv_settings", {
  id: int("id", { unsigned: true }).primaryKey().default(1),
  displayName: varchar("display_name", { length: 80 }).notNull().default("Officeverse Live"),
  /** seconds a celebration/announcement holds before returning to the board */
  rotationSec: int("rotation_sec", { unsigned: true }).notNull().default(12),
  /** which Phase-20 leaderboard window the TV shows by default */
  leaderboardWindow: varchar("leaderboard_window", { length: 12 }).notNull().default("daily"),
  /** "low" | "normal" | "high" — presentation only */
  celebrationIntensity: varchar("celebration_intensity", { length: 12 })
    .notNull()
    .default("normal"),
  soundEnabled: boolean("sound_enabled").notNull().default(false),
  /** accepted-leads count that escalates LEAD_ACCEPTED → a heavy celebration */
  thirdAcceptedThreshold: int("third_accepted_threshold", { unsigned: true }).notNull().default(3),
  /** emit a TEAM_MILESTONE every N team accepted-leads in a day; 0 = disabled */
  teamMilestoneEvery: int("team_milestone_every", { unsigned: true }).notNull().default(0),
  updatedByUserId: int("updated_by_user_id", { unsigned: true }).references(() => users.id, {
    onDelete: "set null",
    onUpdate: "cascade",
  }),
  updatedAt: dt("updated_at"),
});

/* -- 33 · celebration_assets  (approved celebration video library) --- *
 *  Original / licensed / owner-supplied assets only. NO AI generation, *
 *  NO copyrighted sports broadcast footage. `effect` rows map a        *
 *  category to a built-in Phase-19 CSS effect (no bytes).              */
export const celebrationAssets = mysqlTable(
  "celebration_assets",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    /** VICTORY | FIREWORKS | CONFETTI | GOLD | MONEY | ENERGY | CHAMPION | PARTY | FESTIVAL */
    category: varchar("category", { length: 24 }).notNull(),
    kind: mysqlEnum("kind", CELEBRATION_ASSET_KINDS).notNull().default("video"),
    label: varchar("label", { length: 80 }).notNull(),
    /** storage key for an uploaded video (validated bytes); null for built-in effects */
    storageKey: varchar("storage_key", { length: 255 }),
    mime: varchar("mime", { length: 60 }),
    sizeBytes: int("size_bytes", { unsigned: true }),
    durationMs: int("duration_ms", { unsigned: true }),
    /** built-in effect name (Phase-19) when kind = "effect" */
    effect: varchar("effect", { length: 24 }),
    enabled: boolean("enabled").notNull().default(true),
    builtin: boolean("builtin").notNull().default(false),
    uploadedByUserId: int("uploaded_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at"),
  },
  (t) => ({
    categoryIdx: index("celebration_assets_category_idx").on(t.category, t.enabled),
  }),
);

/* -- 34 · office_tv_announcements  (admin broadcast engine) --------- */
export const officeTvAnnouncements = mysqlTable(
  "office_tv_announcements",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    title: varchar("title", { length: 120 }).notNull(),
    subtitle: varchar("subtitle", { length: 160 }),
    message: varchar("message", { length: 600 }).notNull(),
    audience: mysqlEnum("audience", TV_ANNOUNCEMENT_AUDIENCES).notNull().default("all"),
    /** null = every process/team */
    process: mysqlEnum("process", PROCESS_CODES),
    effect: varchar("effect", { length: 24 }),
    assetId: int("asset_id", { unsigned: true }).references(() => celebrationAssets.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    durationMs: int("duration_ms", { unsigned: true }).notNull().default(12000),
    priority: mysqlEnum("priority", TV_ANNOUNCEMENT_PRIORITIES).notNull().default("NORMAL"),
    status: mysqlEnum("status", TV_ANNOUNCEMENT_STATUSES).notNull().default("scheduled"),
    /* -- Phase 10 Stage 2 — per-announcement audio / TTS / celebration.  *
     *  Additive + nullable: an announcement created before Stage 2 keeps  *
     *  working (no TTS, no cue sounds). PRESENTATION ONLY — never money.  */
    ttsEnabled: boolean("tts_enabled").notNull().default(false),
    /** { voiceName?: string, rate: number, pitch: number, volume: number, lang: string } */
    ttsConfig: json("tts_config"),
    /** a CueSound token — none | bell | chime | success | applause | victory | alert */
    openingSound: varchar("opening_sound", { length: 16 }),
    closingSound: varchar("closing_sound", { length: 16 }),
    /** optional celebration_profiles.id to play as the mid-sequence visual (soft ref) */
    celebrationProfileId: int("celebration_profile_id", { unsigned: true }),
    /** IST wall-clock; null = show immediately on publish */
    publishAt: dt("publish_at"),
    expiresAt: dt("expires_at"),
    enabled: boolean("enabled").notNull().default(true),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at"),
    publishedAt: dt("published_at"),
  },
  (t) => ({
    liveIdx: index("office_tv_announcements_live_idx").on(t.status, t.enabled),
  }),
);

/* -- 35 · office_tv_events  (recognition log + celebration idempotency) *
 *  One row per recognition moment. `dedupe_key` is derived from the    *
 *  confirmed BUSINESS event so a retried request / duplicate webhook   *
 *  never produces a second celebration. Not a points ledger — points  *
 *  live in gamification_point_transactions.                            */
export const officeTvEvents = mysqlTable(
  "office_tv_events",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    /** LEAD_SUBMITTED | LEAD_ACCEPTED | THIRD_ACCEPTED_LEAD | SALE | ACHIEVEMENT_UNLOCKED | TEAM_MILESTONE | ANNOUNCEMENT */
    kind: varchar("kind", { length: 32 }).notNull(),
    /** the recognised person; null for team-level / announcement events */
    subjectUserId: int("subject_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    tier: int("tier", { unsigned: true }).notNull().default(1),
    effect: varchar("effect", { length: 24 }),
    assetCategory: varchar("asset_category", { length: 24 }),
    message: varchar("message", { length: 200 }),
    referenceType: varchar("reference_type", { length: 40 }),
    referenceId: varchar("reference_id", { length: 64 }),
    dedupeKey: varchar("dedupe_key", { length: 191 }).notNull(),
    operationalDate: dcol("operational_date").notNull(),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    dedupeUq: unique("office_tv_event_dedupe_uq").on(t.dedupeKey),
    feedIdx: index("office_tv_events_feed_idx").on(t.operationalDate, t.createdAt),
  }),
);

/* ------------------------------------------------------------------ *
 *  15 · schema_meta  (one-row marker: has production been seeded?)    *
 *  Keeps demo/seed data strictly separate from production (Phase 19). *
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  COMPANY PROFILE / OFFICIAL BRANDING  (Admin UAT Batch-2 §7)       *
 *  ONE singleton row (id = 1). The ONE official logo + company       *
 *  details reused by every official output — salary slips, birthday  *
 *  emails, daily follow-up emails, HR/Admin announcements, future     *
 *  official employee emails, printable HR/payroll documents.          *
 *  Admin-only to change. No per-module logo upload anywhere else.     *
 * ------------------------------------------------------------------ */
export const companyProfile = mysqlTable("company_profile", {
  id: int("id", { unsigned: true }).primaryKey().default(1),
  /** display name used across the product + official outputs */
  companyName: varchar("company_name", { length: 160 }).notNull().default("TMI Officeverse"),
  /** legal / registered name for payroll + official documents (optional) */
  legalName: varchar("legal_name", { length: 200 }),
  /** the ONE official logo, stored inline (small): mime + base64 bytes. Served
   *  by GET /api/branding/logo and embedded in HTML emails. */
  logoMime: varchar("logo_mime", { length: 64 }),
  logoData: mediumtext("logo_data"),
  logoUpdatedAt: dt("logo_updated_at"),
  /** registered address block (multiline) for salary slips / official docs */
  addressLine: varchar("address_line", { length: 400 }),
  /** tax / registration id (e.g. GSTIN / PAN) for payroll docs */
  taxId: varchar("tax_id", { length: 40 }),
  /** official contact email / phone shown on documents */
  contactEmail: varchar("contact_email", { length: 191 }),
  contactPhone: varchar("contact_phone", { length: 40 }),
  /** footer / disclaimer line for official documents */
  documentFooter: varchar("document_footer", { length: 400 }),
  updatedByUserId: int("updated_by_user_id", { unsigned: true }).references(() => users.id, {
    onDelete: "set null",
    onUpdate: "cascade",
  }),
  updatedAt: dt("updated_at").notNull(),
});

export const schemaMeta = mysqlTable("schema_meta", {
  id: int("id", { unsigned: true }).primaryKey().default(1),
  /** "empty" until an admin explicitly imports or an admin user is created */
  dataMode: mysqlEnum("data_mode", ["empty", "production", "demo"]).notNull().default("empty"),
  seededAt: dt("seeded_at"),
  appVersion: varchar("app_version", { length: 40 }),
  note: varchar("note", { length: 255 }),
});

/* ------------------------------------------------------------------ *
 *  36 · INCENTIVE ENGINE (Phase 9)                                    *
 *                                                                    *
 *  CRM EVENT → SCORING ENGINE → POINT LEDGER → PERFORMANCE/LEADERBOARD *
 *            → [ INCENTIVE ENGINE (these tables) ] → INCENTIVE RESULT  *
 *                                                                    *
 *  The Incentive Engine decides WHO / WHICH PERIOD / WHICH SCHEME /   *
 *  ELIGIBILITY / REWARD from the AUTHORITATIVE Phase-8 performance     *
 *  snapshot. It NEVER scores or re-computes points. NO payroll link:  *
 *  a finalized incentive result is entitlement data only — it never   *
 *  writes a salary slip / payroll run / payment transaction.          *
 * ------------------------------------------------------------------ */

export const INCENTIVE_PERIOD_TYPES = ["daily", "weekly", "monthly", "custom"] as const;
/** how a scheme combines with OTHER matching schemes in one calculation run.
 *  priority (lower number first) is always the deterministic tie-break. */
export const INCENTIVE_COMBINE_MODES = ["independent", "exclusive", "highest"] as const;
export const INCENTIVE_REWARD_KINDS = ["FIXED", "TIERED", "PERCENT", "RECOGNITION"] as const;
/** result lifecycle. Non-pay outcomes are first-class, not errors. */
export const INCENTIVE_RESULT_STATUSES = [
  "CALCULATED",
  "REVIEWED",
  "APPROVED",
  "FINALIZED",
  "REVERSED",
  "NOT_ELIGIBLE",
  "NO_MATCH",
  "OUT_OF_SCOPE",
] as const;

/* -- incentive_schemes  (mutable header; points to the active version) -- */
export const incentiveSchemes = mysqlTable(
  "incentive_schemes",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    description: varchar("description", { length: 400 }),
    enabled: boolean("enabled").notNull().default(false),
    periodType: mysqlEnum("period_type", INCENTIVE_PERIOD_TYPES).notNull().default("monthly"),
    /** lower = evaluated / preferred first (deterministic tie-break) */
    priority: int("priority").notNull().default(100),
    combineMode: mysqlEnum("combine_mode", INCENTIVE_COMBINE_MODES)
      .notNull()
      .default("independent"),
    /** points to the currently-active incentive_scheme_versions.version */
    currentVersion: int("current_version").notNull().default(1),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    enabledIdx: index("incentive_schemes_enabled_idx").on(t.enabled),
  }),
);

/* -- incentive_scheme_versions  (IMMUTABLE snapshots — never updated) --- *
 *  Selected by effective-date the same half-open way scoring versions are: *
 *  effective_from <= periodStart AND (effective_until IS NULL OR periodStart < effective_until) */
export const incentiveSchemeVersions = mysqlTable(
  "incentive_scheme_versions",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    schemeId: int("scheme_id", { unsigned: true })
      .notNull()
      .references(() => incentiveSchemes.id, { onDelete: "cascade", onUpdate: "cascade" }),
    version: int("version").notNull(),
    nameSnapshot: varchar("name_snapshot", { length: 120 }).notNull(),
    periodTypeSnapshot: mysqlEnum("period_type_snapshot", INCENTIVE_PERIOD_TYPES).notNull(),
    /** { processes?: string[], roles?: string[], teams?: string[], userIds?: number[] } — null = everyone */
    scope: json("scope"),
    /** eligibility condition tree over Phase-8 metrics:
     *  { op:"AND"|"OR", nodes:[ … | { metric, operator, value } ] } — null = always eligible */
    eligibility: json("eligibility"),
    /** { kind:"FIXED"|"TIERED"|"PERCENT"|"RECOGNITION", … } — admin/closer authored */
    reward: json("reward").notNull(),
    currency: varchar("currency", { length: 8 }).notNull().default("INR"),
    effectiveFrom: dcol("effective_from").notNull(),
    effectiveUntil: dcol("effective_until"),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    schemeVersionUq: unique("incentive_scheme_versions_scheme_version_uq").on(
      t.schemeId,
      t.version,
    ),
    schemeIdx: index("incentive_scheme_versions_scheme_idx").on(t.schemeId),
  }),
);

/* -- incentive_results  (persisted calculation; historical + immutable once FINALIZED) -- */
export const incentiveResults = mysqlTable(
  "incentive_results",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    schemeId: int("scheme_id", { unsigned: true })
      .notNull()
      .references(() => incentiveSchemes.id, { onDelete: "restrict", onUpdate: "cascade" }),
    /** the scheme VERSION this result was calculated against — never re-selected later */
    schemeVersion: int("scheme_version").notNull(),
    userId: int("user_id", { unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    /** inclusive operational-date window (Phase-8 semantics) */
    periodFrom: dcol("period_from").notNull(),
    periodTo: dcol("period_to").notNull(),
    status: mysqlEnum("status", INCENTIVE_RESULT_STATUSES).notNull().default("CALCULATED"),
    /** authoritative points for the window (from the Phase-8 snapshot, not recomputed) */
    points: int("points").notNull().default(0),
    rewardKind: mysqlEnum("reward_kind", INCENTIVE_REWARD_KINDS).notNull(),
    /** integer reward amount in the scheme's currency unit; 0 for RECOGNITION / not eligible */
    rewardAmount: int("reward_amount").notNull().default(0),
    currency: varchar("currency", { length: 8 }).notNull().default("INR"),
    /** optional non-monetary label for a RECOGNITION reward */
    rewardLabel: varchar("reward_label", { length: 120 }),
    /** the Phase-8 qualifying metrics used */
    metrics: json("metrics"),
    /** full explanation: conditions evaluated, pass/fail, matched tier, reason */
    explanation: json("explanation"),
    /** deterministic idempotency key: `<schemeId>:<schemeVersion>:<userId>:<from>:<to>` */
    dedupeKey: varchar("dedupe_key", { length: 191 }).notNull(),
    calculatedByUserId: int("calculated_by_user_id", { unsigned: true }).references(
      () => users.id,
      {
        onDelete: "set null",
        onUpdate: "cascade",
      },
    ),
    calculatedAt: dt("calculated_at").notNull(),
    reviewedByUserId: int("reviewed_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    reviewedAt: dt("reviewed_at"),
    approvedByUserId: int("approved_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    approvedAt: dt("approved_at"),
    finalizedByUserId: int("finalized_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    finalizedAt: dt("finalized_at"),
    reversedByUserId: int("reversed_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    reversedAt: dt("reversed_at"),
    reason: varchar("reason", { length: 255 }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    dedupeUq: unique("incentive_results_dedupe_uq").on(t.dedupeKey),
    userIdx: index("incentive_results_user_idx").on(t.userId, t.periodFrom),
    schemeIdx: index("incentive_results_scheme_idx").on(t.schemeId, t.status),
  }),
);

/* ------------------------------------------------------------------ *
 *  37 · CELEBRATION PROFILES (Phase 10 — Recognition Command Center) *
 *                                                                    *
 *  Admin / Operations-Manager authored. Composes recognition VISUAL  *
 *  + AUDIO effects into a named, enable/disable-able profile.        *
 *  PRESENTATION ONLY: a profile never scores, never awards points,   *
 *  never reads or writes payroll / salary / incentive money.         *
 *  Historical `office_tv_events` rows are not replayed against a      *
 *  profile, so ONE mutable row + before/after audit is sufficient    *
 *  (no immutable per-version snapshots like incentive schemes).      *
 * ------------------------------------------------------------------ */

/** presentation INTENSITY band a profile renders at — never a business level */
export const CELEBRATION_PROFILE_LEVELS = ["LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"] as const;
/** the recognition trigger a profile is bound to; a null column = manual / unbound */
export const CELEBRATION_PROFILE_TRIGGERS = [
  "LEAD_SUBMITTED",
  "LEAD_ACCEPTED",
  "SALE",
  "THIRD_ACCEPTED_LEAD",
  "TEAM_MILESTONE",
  "ACHIEVEMENT_UNLOCKED",
  "MANUAL",
] as const;

export const celebrationProfiles = mysqlTable(
  "celebration_profiles",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    description: varchar("description", { length: 400 }),
    enabled: boolean("enabled").notNull().default(false),
    recognitionLevel: mysqlEnum("recognition_level", CELEBRATION_PROFILE_LEVELS)
      .notNull()
      .default("LEVEL_1"),
    /** null = manual / unbound (only played via Operations "Celebrate now") */
    triggerEvent: mysqlEnum("trigger_event", CELEBRATION_PROFILE_TRIGGERS),
    /** lower = chosen first when several enabled profiles match one trigger */
    priority: int("priority").notNull().default(100),
    /** composed effect / show / sound / TTS spec — validated + normalised by
     *  server/live/celebration-profile.ts; never rendered raw */
    config: json("config").notNull(),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    enabledIdx: index("celebration_profiles_enabled_idx").on(t.enabled, t.triggerEvent),
  }),
);

/* ------------------------------------------------------------------ *
 *  38 · MILESTONE ENGINE (Phase 10 Stage 4)                          *
 *                                                                    *
 *  BUSINESS EVENT → SCORING ENGINE → POINT LEDGER                     *
 *      → [ MILESTONE ENGINE (these tables) ] → RECOGNITION            *
 *      → CELEBRATION / ANNOUNCEMENT → OFFICE TV                       *
 *                                                                    *
 *  Admin-configured. It CONSUMES authoritative ledger / performance   *
 *  data — it NEVER scores, never awards points, never writes payroll  *
 *  / salary / incentive. `milestone_triggers` is the idempotency +    *
 *  history store (unique dedupe key per fire).                        *
 * ------------------------------------------------------------------ */

export const MILESTONE_TYPES = [
  "INDIVIDUAL_COUNT",
  "INDIVIDUAL_POINTS",
  "INDIVIDUAL_EVENT",
  "TEAM_COUNT",
  "TEAM_POINTS",
  "TEAM_EVENT",
] as const;
/** operational-date window the threshold is measured over (Phase-8 semantics) */
export const MILESTONE_PERIODS = ["DAILY", "WEEKLY", "MONTHLY", "ALL_TIME"] as const;
/** how often one milestone may fire. ONCE is the safe non-duplicating default. */
export const MILESTONE_TRIGGER_POLICIES = [
  "ONCE",
  "PER_PERIOD",
  "EVERY_THRESHOLD_CROSSING",
] as const;
export const MILESTONE_LEVELS = ["LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"] as const;

/* -- milestones  (mutable definition — Admin governance) -------------- */
export const milestones = mysqlTable(
  "milestones",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    description: varchar("description", { length: 400 }),
    enabled: boolean("enabled").notNull().default(false),
    type: mysqlEnum("type", MILESTONE_TYPES).notNull(),
    /** ledger event key for *_COUNT / *_EVENT types (e.g. "LEAD_ACCEPTED", "SALE");
     *  ignored for *_POINTS types (which sum the ACTIVE points ledger) */
    metric: varchar("metric", { length: 64 }),
    /** authoritative value that must be reached — always > 0, never hard-coded */
    threshold: int("threshold").notNull(),
    period: mysqlEnum("period", MILESTONE_PERIODS).notNull().default("ALL_TIME"),
    triggerPolicy: mysqlEnum("trigger_policy", MILESTONE_TRIGGER_POLICIES)
      .notNull()
      .default("ONCE"),
    /** { processes?: string[] } — null = every process */
    scope: json("scope"),
    priority: int("priority").notNull().default(100),
    recognitionLevel: mysqlEnum("recognition_level", MILESTONE_LEVELS).notNull().default("LEVEL_2"),
    /** optional Stage-1 celebration profile; null → the default recognition */
    celebrationProfileId: int("celebration_profile_id", { unsigned: true }),
    /** optional Stage-2 announcement to also play; null → none */
    announcementId: int("announcement_id", { unsigned: true }),
    effectiveFrom: dcol("effective_from").notNull(),
    effectiveUntil: dcol("effective_until"),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    enabledIdx: index("milestones_enabled_idx").on(t.enabled, t.type),
  }),
);

/* -- milestone_triggers  (idempotency + history — append-only) ------- */
export const milestoneTriggers = mysqlTable(
  "milestone_triggers",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    milestoneId: int("milestone_id", { unsigned: true })
      .notNull()
      .references(() => milestones.id, { onDelete: "restrict", onUpdate: "cascade" }),
    /** null = a TEAM milestone (no individual subject — never fabricated) */
    userId: int("user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    /** "all" | "YYYY-MM-DD" | ISO-week Monday | "YYYY-MM" */
    periodKey: varchar("period_key", { length: 24 }).notNull(),
    /** the source event that crossed the threshold */
    sourceType: varchar("source_type", { length: 40 }),
    sourceId: varchar("source_id", { length: 64 }),
    thresholdValue: int("threshold_value").notNull(),
    /** the authoritative value at the moment it fired */
    actualValue: int("actual_value").notNull(),
    /** deterministic: retry of the same source event → same key → no 2nd fire */
    dedupeKey: varchar("dedupe_key", { length: 191 }).notNull(),
    /** the recognition-bus seq this fire published, when available */
    recognitionSeq: int("recognition_seq"),
    triggeredAt: dt("triggered_at").notNull(),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    dedupeUq: unique("milestone_triggers_dedupe_uq").on(t.dedupeKey),
    milestoneIdx: index("milestone_triggers_milestone_idx").on(t.milestoneId, t.triggeredAt),
  }),
);

/* ------------------------------------------------------------------ *
 *  39 · LEAD SUPPORTING DOCUMENTS (Admin/Lead UAT)                    *
 *                                                                    *
 *  OPTIONAL files an Agent or Closer attaches to a lead. Bytes are    *
 *  stored PRIVATELY (outside any public/static dir) and served only   *
 *  through a session-authenticated, lead-access-checked download.     *
 *  FK is ON DELETE CASCADE so an Admin hard-delete of the lead        *
 *  removes the document rows too (the files are unlinked by the       *
 *  service before the row delete).                                    */
export const LEAD_DOCUMENT_MIMES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const leadDocuments = mysqlTable(
  "lead_documents",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    leadId: int("lead_id", { unsigned: true })
      .notNull()
      .references(() => leads.id, { onDelete: "cascade", onUpdate: "cascade" }),
    /** path-safe display name (no directories, single dot) */
    fileName: varchar("file_name", { length: 160 }).notNull(),
    mime: mysqlEnum("mime", LEAD_DOCUMENT_MIMES).notNull(),
    sizeBytes: int("size_bytes", { unsigned: true }).notNull(),
    /** server-generated private storage key (never a URL) */
    storageKey: varchar("storage_key", { length: 255 }).notNull(),
    uploadedByUserId: int("uploaded_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    uploadedByRole: varchar("uploaded_by_role", { length: 16 }),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    leadIdx: index("lead_documents_lead_idx").on(t.leadId),
  }),
);

/* ------------------------------------------------------------------ *
 *  40 · FOLLOW-UP REASSIGNMENT TRAIL (Admin assignment-rule fix)      *
 *                                                                    *
 *  One immutable row per Admin follow-up reassignment. Keeps the      *
 *  follow-up's own history trail complete: previous owner, who        *
 *  reassigned it, new owner, timestamp, reason. Lead ownership is a   *
 *  SEPARATE concept and is never recorded here.                       */
export const followUpReassignments = mysqlTable(
  "follow_up_reassignments",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    followUpId: int("follow_up_id", { unsigned: true })
      .notNull()
      .references(() => followUps.id, { onDelete: "cascade", onUpdate: "cascade" }),
    /** business code, retained even if the follow-up row is later removed */
    followUpCode: varchar("follow_up_code", { length: 32 }).notNull(),
    fromOwnerUserId: int("from_owner_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    fromOwnerRole: varchar("from_owner_role", { length: 16 }),
    toOwnerUserId: int("to_owner_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    toOwnerRole: varchar("to_owner_role", { length: 16 }),
    reassignedByUserId: int("reassigned_by_user_id", { unsigned: true }).references(
      () => users.id,
      {
        onDelete: "set null",
        onUpdate: "cascade",
      },
    ),
    reason: varchar("reason", { length: 500 }),
    createdAt: dt("created_at").notNull(),
  },
  (t) => ({
    followUpIdx: index("follow_up_reassignments_fu_idx").on(t.followUpId, t.createdAt),
  }),
);

/* ------------------------------------------------------------------ *
 *  HR Policy — simple company-policy publishing (Admin UAT).         *
 *  HR/Admin author + publish; Agents/Closers read PUBLISHED only.    *
 *  Deliberately minimal: title + content + effective date + status.  *
 * ------------------------------------------------------------------ */
export const HR_POLICY_STATUSES = ["DRAFT", "PUBLISHED"] as const;

export const hrPolicies = mysqlTable(
  "hr_policies",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    title: varchar("title", { length: 200 }).notNull(),
    content: mediumtext("content").notNull(),
    /** the date the policy takes effect (plain calendar date) */
    effectiveDate: dcol("effective_date"),
    status: mysqlEnum("status", HR_POLICY_STATUSES).notNull().default("DRAFT"),
    createdByUserId: int("created_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    updatedByUserId: int("updated_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    publishedByUserId: int("published_by_user_id", { unsigned: true }).references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    publishedAt: dt("published_at"),
    createdAt: dt("created_at").notNull(),
    updatedAt: dt("updated_at").notNull(),
  },
  (t) => ({
    statusIdx: index("hr_policies_status_idx").on(t.status, t.effectiveDate),
  }),
);

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
export type StorageBlob = typeof storageBlobs.$inferSelect;
export type NewStorageBlob = typeof storageBlobs.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type OfficeNetwork = typeof officeNetworks.$inferSelect;
export type NewOfficeNetwork = typeof officeNetworks.$inferInsert;
export type Attendance = typeof attendance.$inferSelect;
export type NewAttendance = typeof attendance.$inferInsert;
export type ShiftOverride = typeof shiftOverrides.$inferSelect;
export type NewShiftOverride = typeof shiftOverrides.$inferInsert;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type NewLeaveRequest = typeof leaveRequests.$inferInsert;
export type LeaveDay = typeof leaveDays.$inferSelect;
export type NewLeaveDay = typeof leaveDays.$inferInsert;
export type OffRecord = typeof offRecords.$inferSelect;
export type NewOffRecord = typeof offRecords.$inferInsert;
export type Holiday = typeof holidays.$inferSelect;
export type NewHoliday = typeof holidays.$inferInsert;
export type RegularityBonus = typeof regularityBonus.$inferSelect;
export type NewRegularityBonus = typeof regularityBonus.$inferInsert;
export type SalaryProfile = typeof salaryProfiles.$inferSelect;
export type NewSalaryProfile = typeof salaryProfiles.$inferInsert;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type NewPayrollRun = typeof payrollRuns.$inferInsert;
export type EmploymentPeriod = typeof employmentPeriods.$inferSelect;
export type NewEmploymentPeriod = typeof employmentPeriods.$inferInsert;
export type OvertimeRecord = typeof overtimeRecords.$inferSelect;
export type NewOvertimeRecord = typeof overtimeRecords.$inferInsert;
export type PayrollAdjustment = typeof payrollAdjustments.$inferSelect;
export type NewPayrollAdjustment = typeof payrollAdjustments.$inferInsert;
export type SalarySlip = typeof salarySlips.$inferSelect;
export type NewSalarySlip = typeof salarySlips.$inferInsert;
export type SalarySlipSend = typeof salarySlipSends.$inferSelect;
export type NewSalarySlipSend = typeof salarySlipSends.$inferInsert;
export type GamificationPointRule = typeof gamificationPointRules.$inferSelect;
export type NewGamificationPointRule = typeof gamificationPointRules.$inferInsert;
export type GamificationPointTransaction = typeof gamificationPointTransactions.$inferSelect;
export type NewGamificationPointTransaction = typeof gamificationPointTransactions.$inferInsert;
export type GamificationAchievement = typeof gamificationAchievements.$inferSelect;
export type NewGamificationAchievement = typeof gamificationAchievements.$inferInsert;
export type GamificationUserAchievement = typeof gamificationUserAchievements.$inferSelect;
export type NewGamificationUserAchievement = typeof gamificationUserAchievements.$inferInsert;
export type GamificationStreak = typeof gamificationStreaks.$inferSelect;
export type NewGamificationStreak = typeof gamificationStreaks.$inferInsert;
export type ScoringRule = typeof scoringRules.$inferSelect;
export type NewScoringRule = typeof scoringRules.$inferInsert;
export type ScoringRuleVersion = typeof scoringRuleVersions.$inferSelect;
export type NewScoringRuleVersion = typeof scoringRuleVersions.$inferInsert;
export type ScoringRun = typeof scoringRuns.$inferSelect;
export type NewScoringRun = typeof scoringRuns.$inferInsert;
export type OfficeTvDisplay = typeof officeTvDisplays.$inferSelect;
export type NewOfficeTvDisplay = typeof officeTvDisplays.$inferInsert;
export type OfficeTvSettings = typeof officeTvSettings.$inferSelect;
export type NewOfficeTvSettings = typeof officeTvSettings.$inferInsert;
export type CelebrationAsset = typeof celebrationAssets.$inferSelect;
export type NewCelebrationAsset = typeof celebrationAssets.$inferInsert;
export type OfficeTvAnnouncement = typeof officeTvAnnouncements.$inferSelect;
export type NewOfficeTvAnnouncement = typeof officeTvAnnouncements.$inferInsert;
export type OfficeTvEvent = typeof officeTvEvents.$inferSelect;
export type NewOfficeTvEvent = typeof officeTvEvents.$inferInsert;
export type CompanyProfile = typeof companyProfile.$inferSelect;
export type NewCompanyProfile = typeof companyProfile.$inferInsert;
export type IncentiveScheme = typeof incentiveSchemes.$inferSelect;
export type NewIncentiveScheme = typeof incentiveSchemes.$inferInsert;
export type IncentiveSchemeVersion = typeof incentiveSchemeVersions.$inferSelect;
export type NewIncentiveSchemeVersion = typeof incentiveSchemeVersions.$inferInsert;
export type IncentiveResult = typeof incentiveResults.$inferSelect;
export type NewIncentiveResult = typeof incentiveResults.$inferInsert;
export type CelebrationProfileRow = typeof celebrationProfiles.$inferSelect;
export type NewCelebrationProfileRow = typeof celebrationProfiles.$inferInsert;
export type Milestone = typeof milestones.$inferSelect;
export type NewMilestone = typeof milestones.$inferInsert;
export type MilestoneTrigger = typeof milestoneTriggers.$inferSelect;
export type NewMilestoneTrigger = typeof milestoneTriggers.$inferInsert;
export type LeadDocument = typeof leadDocuments.$inferSelect;
export type NewLeadDocument = typeof leadDocuments.$inferInsert;
export type FollowUpReassignment = typeof followUpReassignments.$inferSelect;
export type NewFollowUpReassignment = typeof followUpReassignments.$inferInsert;
export type HrPolicy = typeof hrPolicies.$inferSelect;
export type NewHrPolicy = typeof hrPolicies.$inferInsert;
