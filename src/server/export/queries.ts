/* eslint-disable @typescript-eslint/no-explicit-any -- drizzle's fluent
   query-builder types do not abstract over a shared join chain; the `any`
   is confined to the builder plumbing, every returned row is typed. */
/**
 * Officeverse — Admin export queries (Phase 8). DATA ACCESS ONLY.
 *
 * One function per dataset returning { rows, count, capped }. Every WHERE
 * clause is built from the NORMALISED filter object with drizzle helpers
 * (eq / gte / lte / like) — user input is bound as a parameter, never
 * concatenated. Rows are fetched in controlled pages (EXPORT_BATCH_SIZE) up to
 * MAX_EXPORT_ROWS + 1 so an oversized result is detected without loading it all.
 * `count` is a separate parameterised COUNT(*) over the same joins + WHERE.
 */
import { and, asc, eq, gte, like, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { getDb } from "@/lib/db";
import {
  agents,
  clients,
  closers,
  followUpAttempts,
  followUps,
  imports,
  leadAssignments,
  leads,
  users,
} from "@/lib/db/schema";
import {
  EXPORT_BATCH_SIZE,
  MAX_EXPORT_ROWS,
  type ExportDatasetKey,
} from "@/lib/officeverse/export/datasets";
import { pairLeadsAndFollowUps } from "@/lib/officeverse/export/combine";
import type { ExportFilters } from "./filters";

export interface QueryResult {
  rows: Array<Record<string, unknown>>;
  count: number;
  capped: boolean;
}

type PageFn = (limit: number, offset: number) => Promise<Array<Record<string, unknown>>>;

async function paginate(
  run: PageFn,
): Promise<{ rows: Array<Record<string, unknown>>; capped: boolean }> {
  const rows: Array<Record<string, unknown>> = [];
  let offset = 0;
  for (;;) {
    const take = Math.min(EXPORT_BATCH_SIZE, MAX_EXPORT_ROWS + 1 - rows.length);
    if (take <= 0) break;
    const page = await run(take, offset);
    rows.push(...page);
    if (page.length < take) break;
    offset += page.length;
  }
  const capped = rows.length > MAX_EXPORT_ROWS;
  return { rows: capped ? rows.slice(0, MAX_EXPORT_ROWS) : rows, capped };
}

function range(col: unknown, from?: string, to?: string, withTime = true): SQL[] {
  const c = col as never;
  const out: SQL[] = [];
  if (from) out.push(gte(c, withTime ? `${from} 00:00:00` : from));
  if (to) out.push(lte(c, withTime ? `${to} 23:59:59` : to));
  return out;
}

async function scalarCount(build: () => Promise<Array<{ n: number }>>): Promise<number> {
  const r = await build();
  return Number(r[0]?.n ?? 0);
}

/* -------------------------------- leads --------------------------- */

export async function queryLeads(f: ExportFilters): Promise<QueryResult> {
  const ag = alias(agents, "lex_ag");
  const au = alias(users, "lex_au");
  const cl = alias(closers, "lex_cl");
  const cu = alias(users, "lex_cu");
  const ff = alias(followUps, "lex_ff");

  const conds: SQL[] = [];
  const field = f.dateField ?? "created";
  if (field === "shift") conds.push(...range(leads.shiftDate, f.dateFrom, f.dateTo, false));
  else if (field === "updated") conds.push(...range(leads.updatedAt, f.dateFrom, f.dateTo));
  else conds.push(...range(leads.createdAt, f.dateFrom, f.dateTo));
  if (f.status) conds.push(eq(leads.status, f.status as never));
  if (f.source) conds.push(eq(leads.source, f.source as never));
  if (f.state) conds.push(like(leads.state, `%${f.state}%`));
  if (f.zip) conds.push(like(leads.zip, `${f.zip}%`));
  if (f.agentCode) conds.push(eq(ag.agentCode, f.agentCode));
  if (f.closerCode) conds.push(eq(cl.closerCode, f.closerCode));
  const where = conds.length ? and(...conds) : undefined;

  const withJoins = (q: any) =>
    q
      .leftJoin(ag, eq(ag.id, leads.agentId))
      .leftJoin(au, eq(au.id, ag.userId))
      .leftJoin(cl, eq(cl.id, leads.assignedCloserId))
      .leftJoin(cu, eq(cu.id, cl.userId))
      .leftJoin(ff, eq(ff.id, leads.convertedFromFollowUpId));

  const rowsQuery = () =>
    withJoins(
      getDb()
        .select({
          lead_id: leads.leadCode,
          customer_name: leads.customerName,
          phone: leads.phone,
          email: leads.email,
          address: leads.address,
          city: leads.city,
          state: leads.state,
          zip: leads.zip,
          debt_amount: leads.debtAmount,
          credit_status: leads.creditStatus,
          current_debts: leads.currentDebts,
          status: leads.status,
          source: leads.source,
          agent_code: ag.agentCode,
          agent_name: au.fullName,
          closer_code: cl.closerCode,
          closer_name: cu.fullName,
          shift_date: leads.shiftDate,
          converted_from_follow_up: ff.followUpCode,
          created_at: leads.createdAt,
          updated_at: leads.updatedAt,
        })
        .from(leads),
    );

  const { rows, capped } = await paginate((limit, offset) =>
    rowsQuery().where(where).orderBy(asc(leads.id)).limit(limit).offset(offset),
  );
  const count = capped
    ? await scalarCount(() =>
        withJoins(
          getDb()
            .select({ n: sql<number>`count(*)` })
            .from(leads),
        ).where(where),
      )
    : rows.length;

  return { rows, count, capped };
}

/* ------------------------------ followups ------------------------- */

export async function queryFollowUps(f: ExportFilters): Promise<QueryResult> {
  const ownerU = alias(users, "fex_owner");
  const ag = alias(agents, "fex_ag");
  const cl = alias(closers, "fex_cl");

  const conds: SQL[] = [];
  const field = f.dateField ?? "scheduled";
  if (field === "capture") conds.push(...range(followUps.captureDate, f.dateFrom, f.dateTo, false));
  else if (field === "created") conds.push(...range(followUps.createdAt, f.dateFrom, f.dateTo));
  else conds.push(...range(followUps.scheduledAt, f.dateFrom, f.dateTo));
  if (f.followUpStatus) conds.push(eq(followUps.status, f.followUpStatus as never));
  if (f.ownerRole) conds.push(eq(followUps.ownerRole, f.ownerRole));
  if (f.leadCode) conds.push(eq(leads.leadCode, f.leadCode));
  if (f.agentCode) conds.push(eq(ag.agentCode, f.agentCode));
  if (f.closerCode) conds.push(eq(cl.closerCode, f.closerCode));
  const where = conds.length ? and(...conds) : undefined;

  const withJoins = (q: any) =>
    q
      .leftJoin(ownerU, eq(ownerU.id, followUps.ownerUserId))
      .leftJoin(leads, eq(leads.id, followUps.leadId))
      .leftJoin(ag, eq(ag.userId, followUps.ownerUserId))
      .leftJoin(cl, eq(cl.userId, followUps.ownerUserId));

  const rowsQuery = () =>
    withJoins(
      getDb()
        .select({
          follow_up_id: followUps.followUpCode,
          lead_id: leads.leadCode,
          owner_role: followUps.ownerRole,
          owner_name: ownerU.fullName,
          customer_name: followUps.customerName,
          phone: followUps.phone,
          email: followUps.email,
          state: followUps.state,
          zip: followUps.zip,
          scheduled_at: followUps.scheduledAt,
          status: followUps.status,
          comment: followUps.comment,
          capture_date: followUps.captureDate,
          converted_lead_code: followUps.convertedLeadCode,
          converted_at: followUps.convertedAt,
          completed_at: followUps.completedAt,
          cancelled_at: followUps.cancelledAt,
          source: followUps.source,
          created_at: followUps.createdAt,
          updated_at: followUps.updatedAt,
        })
        .from(followUps),
    );

  const { rows, capped } = await paginate((limit, offset) =>
    rowsQuery().where(where).orderBy(asc(followUps.id)).limit(limit).offset(offset),
  );
  const count = capped
    ? await scalarCount(() =>
        withJoins(
          getDb()
            .select({ n: sql<number>`count(*)` })
            .from(followUps),
        ).where(where),
      )
    : rows.length;

  return {
    rows: rows.map((r) => {
      const s = String(r["scheduled_at"] ?? "");
      return { ...r, scheduled_date: s.slice(0, 10), scheduled_time: s.slice(11, 16) };
    }),
    count,
    capped,
  };
}

/* ------------------------------ combined ------------------------- */

export async function queryCombined(f: ExportFilters): Promise<QueryResult> {
  const leadRes = await queryLeads(f);
  const fuFilter: ExportFilters = { dateField: "scheduled" };
  if (f.followUpStatus) fuFilter.followUpStatus = f.followUpStatus;
  const fuRes = await queryFollowUps(fuFilter);

  const leadParts = leadRes.rows.map((r, i) => ({
    leadNumId: i + 1,
    cells: {
      lead_id: r["lead_id"],
      lead_customer_name: r["customer_name"],
      lead_phone: r["phone"],
      lead_email: r["email"],
      lead_state: r["state"],
      lead_zip: r["zip"],
      lead_status: r["status"],
      lead_source: r["source"],
      agent_code: r["agent_code"],
      agent_name: r["agent_name"],
      closer_code: r["closer_code"],
      closer_name: r["closer_name"],
      lead_shift_date: r["shift_date"],
      lead_created_at: r["created_at"],
    },
  }));
  const idByCode = new Map<string, number>();
  leadParts.forEach((p) => idByCode.set(String(p.cells.lead_id), p.leadNumId));

  const fuParts = fuRes.rows.map((r) => ({
    leadNumId: idByCode.get(String(r["lead_id"])) ?? null,
    cells: {
      follow_up_id: r["follow_up_id"],
      follow_up_owner_role: r["owner_role"],
      follow_up_owner_name: r["owner_name"],
      follow_up_scheduled_date: r["scheduled_date"],
      follow_up_scheduled_time: r["scheduled_time"],
      follow_up_status: r["status"],
      follow_up_comment: r["comment"],
      follow_up_created_at: r["created_at"],
    },
  }));

  const paired = pairLeadsAndFollowUps(leadParts, fuParts);
  const capped = paired.length > MAX_EXPORT_ROWS || leadRes.capped || fuRes.capped;
  return {
    rows: capped ? paired.slice(0, MAX_EXPORT_ROWS) : paired,
    count: paired.length,
    capped,
  };
}

/* -------------------------- lead assignments -------------------- */

export async function queryLeadAssignments(f: ExportFilters): Promise<QueryResult> {
  const fc = alias(closers, "aex_fc");
  const tc = alias(closers, "aex_tc");
  const bu = alias(users, "aex_bu");

  const conds: SQL[] = [...range(leadAssignments.createdAt, f.dateFrom, f.dateTo)];
  if (f.action) conds.push(eq(leadAssignments.action, f.action as never));
  if (f.leadCode) conds.push(eq(leads.leadCode, f.leadCode));
  if (f.closerCode) conds.push(eq(tc.closerCode, f.closerCode));
  const where = conds.length ? and(...conds) : undefined;

  const withJoins = (q: any) =>
    q
      .leftJoin(leads, eq(leads.id, leadAssignments.leadId))
      .leftJoin(fc, eq(fc.id, leadAssignments.fromCloserId))
      .leftJoin(tc, eq(tc.id, leadAssignments.toCloserId))
      .leftJoin(bu, eq(bu.id, leadAssignments.byUserId));

  const rowsQuery = () =>
    withJoins(
      getDb()
        .select({
          lead_id: leads.leadCode,
          action: leadAssignments.action,
          from_closer_code: fc.closerCode,
          to_closer_code: tc.closerCode,
          by_user_name: bu.fullName,
          note: leadAssignments.note,
          created_at: leadAssignments.createdAt,
        })
        .from(leadAssignments),
    );

  const { rows, capped } = await paginate((limit, offset) =>
    rowsQuery().where(where).orderBy(asc(leadAssignments.id)).limit(limit).offset(offset),
  );
  const count = capped
    ? await scalarCount(() =>
        withJoins(
          getDb()
            .select({ n: sql<number>`count(*)` })
            .from(leadAssignments),
        ).where(where),
      )
    : rows.length;
  return { rows, count, capped };
}

/* ------------------------- followup history -------------------- */

export async function queryFollowUpHistory(f: ExportFilters): Promise<QueryResult> {
  const conds: SQL[] = [...range(followUpAttempts.recordedAt, f.dateFrom, f.dateTo)];
  if (f.outcome) conds.push(eq(followUpAttempts.outcome, f.outcome as never));
  if (f.followUpCode) conds.push(eq(followUps.followUpCode, f.followUpCode));
  const where = conds.length ? and(...conds) : undefined;

  const withJoins = (q: any) =>
    q
      .leftJoin(followUps, eq(followUps.id, followUpAttempts.followUpId))
      .leftJoin(users, eq(users.id, followUpAttempts.recordedByUserId));

  const rowsQuery = () =>
    withJoins(
      getDb()
        .select({
          follow_up_id: followUps.followUpCode,
          attempt_no: followUpAttempts.attemptNo,
          scheduled_at: followUpAttempts.scheduledAt,
          outcome: followUpAttempts.outcome,
          note: followUpAttempts.note,
          related_lead_code: followUpAttempts.relatedLeadCode,
          recorded_by_name: users.fullName,
          recorded_at: followUpAttempts.recordedAt,
        })
        .from(followUpAttempts),
    );

  const { rows, capped } = await paginate((limit, offset) =>
    rowsQuery().where(where).orderBy(asc(followUpAttempts.id)).limit(limit).offset(offset),
  );
  const count = capped
    ? await scalarCount(() =>
        withJoins(
          getDb()
            .select({ n: sql<number>`count(*)` })
            .from(followUpAttempts),
        ).where(where),
      )
    : rows.length;
  return { rows, count, capped };
}

/* ------------------------------ imports ------------------------- */

export async function queryImports(f: ExportFilters): Promise<QueryResult> {
  const conds: SQL[] = [...range(imports.createdAt, f.dateFrom, f.dateTo)];
  if (f.type) conds.push(eq(imports.type, f.type as never));
  if (f.status) conds.push(eq(imports.status, f.status as never));
  const where = conds.length ? and(...conds) : undefined;

  const withJoins = (q: any) => q.leftJoin(users, eq(users.id, imports.uploadedByUserId));

  const rowsQuery = () =>
    withJoins(
      getDb()
        .select({
          import_id: imports.id,
          file_name: imports.filename,
          type: imports.type,
          uploaded_by_name: users.fullName,
          status: imports.status,
          total_rows: imports.totalRows,
          valid_rows: imports.validRows,
          invalid_rows: imports.invalidRows,
          new_rows: imports.newRows,
          duplicate_rows: imports.duplicateRows,
          skipped_rows: imports.skippedRows,
          error_rows: imports.errorRows,
          success_count: imports.successCount,
          error_count: imports.errorCount,
          created_at: imports.createdAt,
          committed_at: imports.committedAt,
        })
        .from(imports),
    );

  const { rows, capped } = await paginate((limit, offset) =>
    rowsQuery().where(where).orderBy(asc(imports.id)).limit(limit).offset(offset),
  );
  const count = capped
    ? await scalarCount(() =>
        withJoins(
          getDb()
            .select({ n: sql<number>`count(*)` })
            .from(imports),
        ).where(where),
      )
    : rows.length;
  return { rows, count, capped };
}

/* --------------------------- agents / closers ------------------ */

async function queryStaff(kind: "agents" | "closers", f: ExportFilters): Promise<QueryResult> {
  const isAgent = kind === "agents";
  const codeCol = isAgent ? agents.agentCode : closers.closerCode;
  const regCol = isAgent ? agents.registeredOn : closers.registeredOn;
  const crCol = isAgent ? agents.createdAt : closers.createdAt;
  const joinKey = isAgent ? agents.userId : closers.userId;

  // The staff-roster export resolves CURRENT identity, exactly like Agent List /
  // Staff Directory / Assignments (repos/staff.listStaffRows, repos/assignments
  // .listAgentRoster/.listCloserRoster) — all keyed on `users.role`. Without this
  // predicate a promoted Agent→Closer keeps a historical `agents` row and would
  // still surface in the Agents export carrying a STALE `agent_code`; the role
  // filter keeps each person in exactly one roster with their live code.
  const conds: SQL[] = [eq(users.role, isAgent ? "agent" : "closer")];
  const field = f.dateField ?? "registered";
  if (field === "created") conds.push(...range(crCol, f.dateFrom, f.dateTo));
  else conds.push(...range(regCol, f.dateFrom, f.dateTo, false));
  if (f.status) conds.push(eq(users.status, f.status as never));
  const where = conds.length ? and(...conds) : undefined;

  const from = () =>
    (isAgent
      ? getDb()
          .select({
            code: agents.agentCode,
            name: users.fullName,
            email: users.email,
            role: users.role,
            status: users.status,
            process: users.process,
            phone: users.phone,
            registered_on: agents.registeredOn,
            created_at: agents.createdAt,
          })
          .from(agents)
      : getDb()
          .select({
            code: closers.closerCode,
            name: users.fullName,
            email: users.email,
            role: users.role,
            status: users.status,
            process: users.process,
            phone: users.phone,
            registered_on: closers.registeredOn,
            created_at: closers.createdAt,
          })
          .from(closers)
    ).innerJoin(users, eq(users.id, joinKey));

  const { rows, capped } = await paginate((limit, offset) =>
    from().where(where).orderBy(asc(codeCol)).limit(limit).offset(offset),
  );
  const count = capped
    ? await scalarCount(() =>
        (isAgent
          ? getDb()
              .select({ n: sql<number>`count(*)` })
              .from(agents)
          : getDb()
              .select({ n: sql<number>`count(*)` })
              .from(closers)
        )
          .innerJoin(users, eq(users.id, joinKey))
          .where(where),
      )
    : rows.length;
  return { rows, count, capped };
}

export const queryAgents = (f: ExportFilters) => queryStaff("agents", f);
export const queryClosers = (f: ExportFilters) => queryStaff("closers", f);

/* ------------------------------ clients ----------------------- */

export async function queryClients(f: ExportFilters): Promise<QueryResult> {
  const conds: SQL[] = [];
  const field = f.dateField ?? "registered";
  if (field === "created") conds.push(...range(clients.createdAt, f.dateFrom, f.dateTo));
  else conds.push(...range(clients.registeredOn, f.dateFrom, f.dateTo, false));
  if (f.status) conds.push(eq(clients.status, f.status as never));
  const where = conds.length ? and(...conds) : undefined;

  const { rows, capped } = await paginate((limit, offset) =>
    getDb()
      .select({
        client_code: clients.clientCode,
        name: clients.name,
        contact_name: clients.contactName,
        email: clients.email,
        phone: clients.phone,
        address: clients.address,
        status: clients.status,
        registered_on: clients.registeredOn,
        created_at: clients.createdAt,
      })
      .from(clients)
      .where(where)
      .orderBy(asc(clients.id))
      .limit(limit)
      .offset(offset),
  );
  const count = capped
    ? await scalarCount(() =>
        getDb()
          .select({ n: sql<number>`count(*)` })
          .from(clients)
          .where(where),
      )
    : rows.length;
  return { rows, count, capped };
}

export const EXPORT_QUERY: Record<ExportDatasetKey, (f: ExportFilters) => Promise<QueryResult>> = {
  leads: queryLeads,
  followups: queryFollowUps,
  combined: queryCombined,
  lead_assignments: queryLeadAssignments,
  followup_history: queryFollowUpHistory,
  imports: queryImports,
  agents: queryAgents,
  closers: queryClosers,
  clients: queryClients,
};
