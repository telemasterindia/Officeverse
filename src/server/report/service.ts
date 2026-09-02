/**
 * Officeverse — Reports export service.
 *
 * The "Download report" button on /reports produces an operational report
 * DIRECTLY from the three filters shown on that page — Date range, Process,
 * Employee — with NO further dataset / free-text prompt. It never routes through
 * the Data Export centre.
 *
 * Admin + HR only (the same audience the Reports screen is shown to). The role
 * comes from the session; the client sends only the three filter values plus a
 * file format. Reuses the Phase-8 XLSX / CSV writers and the same
 * MAX_EXPORT_ROWS ceiling.
 */
import { and, asc, eq, gte, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { getDb, isDbConfigured } from "@/lib/db";
import { agents, closers, leads, users, type User } from "@/lib/db/schema";
import { MAX_EXPORT_ROWS, type ColumnDef } from "@/lib/officeverse/export/datasets";
import { toCsv } from "@/lib/officeverse/export/csv";
import { cellText } from "@/lib/officeverse/export/format";
import { type ReportEmployee, type ReportProcess } from "@/lib/officeverse/report";
import { buildXlsx } from "../export/xlsx";
import { listStaffRows } from "../db/repos/staff";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { nowIST } from "../time";

type Meta = { ip?: string | null; userAgent?: string | null };

export type { ReportEmployee, ReportProcess };

export interface ReportExportInput {
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  process?: ReportProcess | undefined;
  employee?: string | undefined; // "ALL" | an Agent ID / Closer ID
  format: "xlsx" | "csv";
}

export interface ReportFile {
  fileName: string;
  mime: string;
  base64: string;
  rowCount: number;
  format: "xlsx" | "csv";
}

/** Reports is an Admin + HR surface (see NAV_BY_ROLE). Enforced server-side. */
function assertCanReport(role: User["role"]): void {
  if (role !== "admin" && role !== "hr") {
    throw new HttpError(403, "Only an Admin or HR may download reports", "forbidden");
  }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function cleanDate(v: string | undefined): string | undefined {
  const s = (v ?? "").trim();
  return YMD.test(s) ? s : undefined;
}

/* The report's fixed operational column set — leads with their CURRENT agent /
 * closer identity. `agent_code` / `closer_code` are the canonical business
 * codes (agents.agent_code / closers.closer_code), never a row id. */
const REPORT_COLUMNS: ColumnDef[] = [
  { key: "lead_id", header: "Lead ID", text: true },
  { key: "customer_name", header: "Customer name" },
  { key: "process", header: "Process" },
  { key: "status", header: "Status" },
  { key: "source", header: "Source" },
  { key: "agent_code", header: "Agent ID", text: true },
  { key: "agent_name", header: "Agent" },
  { key: "closer_code", header: "Closer ID", text: true },
  { key: "closer_name", header: "Closer" },
  { key: "shift_date", header: "Shift date (operational)" },
  { key: "created_at", header: "Created at" },
];

/** Employee picker options for the Reports "Employee" filter — active agents +
 *  closers, by their canonical code (identical source to Agent List / Staff
 *  Directory: repos/staff.listStaffRows keyed on users.role). */
export async function reportEmployees(actor: Pick<User, "role">): Promise<ReportEmployee[]> {
  assertCanReport(actor.role);
  if (!isDbConfigured()) return [];
  const [agentRows, closerRows] = await Promise.all([
    listStaffRows("agent", { activeOnly: true }),
    listStaffRows("closer", { activeOnly: true }),
  ]);
  const out: ReportEmployee[] = [
    ...agentRows.map((r) => ({ code: r.code, name: r.fullName, role: "agent" as const })),
    ...closerRows.map((r) => ({ code: r.code, name: r.fullName, role: "closer" as const })),
  ];
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function runReportExport(
  actor: Pick<User, "id" | "role">,
  input: ReportExportInput,
  meta: Meta = {},
): Promise<ReportFile> {
  assertCanReport(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");

  const dateFrom = cleanDate(input.dateFrom);
  const dateTo = cleanDate(input.dateTo);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new HttpError(422, "The report start date is after the end date", "bad_date_range");
  }
  const process: ReportProcess = input.process ?? "ALL";
  const employee = (input.employee ?? "ALL").trim() || "ALL";

  const ag = alias(agents, "rep_ag");
  const au = alias(users, "rep_au");
  const cl = alias(closers, "rep_cl");
  const cu = alias(users, "rep_cu");

  const conds: SQL[] = [];
  if (dateFrom) conds.push(gte(leads.shiftDate, dateFrom));
  if (dateTo) conds.push(lte(leads.shiftDate, dateTo));
  if (process !== "ALL") {
    conds.push(or(eq(au.process, process), eq(cu.process, process)) as SQL);
  }
  if (employee !== "ALL") {
    conds.push(or(eq(ag.agentCode, employee), eq(cl.closerCode, employee)) as SQL);
  }
  const where = conds.length ? and(...conds) : undefined;

  const rows = await getDb()
    .select({
      lead_id: leads.leadCode,
      customer_name: leads.customerName,
      process: sql<string | null>`coalesce(${au.process}, ${cu.process})`,
      status: leads.status,
      source: leads.source,
      agent_code: ag.agentCode,
      agent_name: au.fullName,
      closer_code: cl.closerCode,
      closer_name: cu.fullName,
      shift_date: leads.shiftDate,
      created_at: leads.createdAt,
    })
    .from(leads)
    .leftJoin(ag, eq(ag.id, leads.agentId))
    .leftJoin(au, eq(au.id, ag.userId))
    .leftJoin(cl, eq(cl.id, leads.assignedCloserId))
    .leftJoin(cu, eq(cu.id, cl.userId))
    .where(where)
    .orderBy(asc(leads.id))
    .limit(MAX_EXPORT_ROWS + 1);

  if (rows.length > MAX_EXPORT_ROWS) {
    throw new HttpError(
      413,
      `This report exceeds ${MAX_EXPORT_ROWS.toLocaleString()} rows. Narrow the date range, process or employee.`,
      "too_many_rows",
    );
  }

  const stamp = nowIST().slice(0, 10);
  const fileBase = `officeverse-report-${stamp}`;

  let base64: string;
  let mime: string;
  let fileName: string;
  if (input.format === "csv") {
    const headers = REPORT_COLUMNS.map((c) => c.header);
    const body = rows.map((r) =>
      REPORT_COLUMNS.map((c) => cellText((r as Record<string, unknown>)[c.key])),
    );
    base64 = Buffer.from(toCsv(headers, body), "utf8").toString("base64");
    mime = "text/csv;charset=utf-8";
    fileName = `${fileBase}.csv`;
  } else {
    const buf = await buildXlsx("Report", REPORT_COLUMNS, rows as Array<Record<string, unknown>>);
    base64 = buf.toString("base64");
    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    fileName = `${fileBase}.xlsx`;
  }

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "report.export",
    entityType: "report",
    metadata: {
      format: input.format,
      row_count: rows.length,
      date_from: dateFrom ?? null,
      date_to: dateTo ?? null,
      process,
      employee,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { fileName, mime, base64, rowCount: rows.length, format: input.format };
}
