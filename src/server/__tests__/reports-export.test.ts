/**
 * REPORTS + DATA EXPORT — TWO UAT BUGS (PURE / structural).
 *
 * BUG 1  "Download report" must run a DIRECT report export from the Reports
 *        page filters (Date range / Process / Employee) — no dataset question,
 *        no free-text prompt, no detour through the Data Export centre.
 * BUG 2  The Data Export "Agent ID" column must carry the canonical business
 *        code (agents.agent_code) and a promoted Agent→Closer must not surface
 *        in the Agents export off a stale historical row.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertCanExport } from "../authz/export";
import { HttpError } from "../http-error";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const reportsRoute = read("routes/_shell.reports.tsx");
const reportFns = read("lib/officeverse/report-fns.ts");
const reportSvc = stripComments(read("server/report/service.ts"));
const queries = stripComments(read("server/export/queries.ts"));
const exportSvc = stripComments(read("server/export/service.ts"));

/* ------------------------------- BUG 1 -------------------------------- */

describe("BUG 1 — Reports 'Download report' is a direct, filtered export", () => {
  it("the button runs the report download hook — not a toast stub, not a link to /exports", () => {
    expect(reportsRoute).toMatch(/useReportDownload\(\)/);
    expect(reportsRoute).toMatch(/onClick=\{runDownload\}/);
    // the old stub + any Data Export detour are gone
    expect(reportsRoute).not.toMatch(/Report queued/);
    expect(reportsRoute).not.toMatch(/to="\/exports"|navigate\(\s*["'`]\/exports/);
  });

  it("it passes exactly the three Reports filters (date range, process, employee) + format", () => {
    const call = reportsRoute.slice(
      reportsRoute.indexOf("download.mutate("),
      reportsRoute.indexOf("download.mutate(") + 320,
    );
    expect(call).toMatch(/dateFrom/);
    expect(call).toMatch(/dateTo/);
    expect(call).toMatch(/process,/);
    expect(call).toMatch(/employee,/);
  });

  it("the server fn asks NO extra question — its whole input is the 3 filters + format", () => {
    const schema = reportFns.slice(
      reportFns.indexOf("reportExportInput = z.object({"),
      reportFns.indexOf("});", reportFns.indexOf("reportExportInput = z.object({")),
    );
    for (const k of ["dateFrom", "dateTo", "process", "employee", "format"])
      expect(schema, k).toContain(k);
    // no dataset / free-text passthrough that would need a follow-up prompt
    expect(schema).not.toMatch(/dataset|agentCode|closerCode|leadCode|state|zip/);
  });

  it("both report handlers are Admin + HR only (role from the session)", () => {
    expect(reportFns).toMatch(/requireRole\("admin", "hr"\)[\s\S]*reportEmployees/);
    expect(reportFns).toMatch(/requireRole\("admin", "hr"\)[\s\S]*runReportExport/);
    expect(reportSvc).toMatch(/role !== "admin" && role !== "hr"/);
  });

  it("the report query filters on date range, process and employee — and nothing is hardcoded", () => {
    const fn = reportSvc.slice(reportSvc.indexOf("export async function runReportExport"));
    expect(fn).toMatch(/gte\(leads\.shiftDate, dateFrom\)/);
    expect(fn).toMatch(/lte\(leads\.shiftDate, dateTo\)/);
    expect(fn).toMatch(/eq\(au\.process, process\)/);
    expect(fn).toMatch(/eq\(cu\.process, process\)/);
    expect(fn).toMatch(/eq\(ag\.agentCode, employee\)/);
    expect(fn).toMatch(/eq\(cl\.closerCode, employee\)/);
    // canonical code columns, never a raw id
    expect(fn).toMatch(/agent_code: ag\.agentCode/);
    expect(fn).toMatch(/closer_code: cl\.closerCode/);
    expect(fn).not.toMatch(/agent_code:\s*(leads\.id|ag\.id|ag\.userId|au\.id)/);
    expect(fn).not.toMatch(/["']AG-\d/); // no literal agent id anywhere
  });

  it("the report is bounded by the same MAX_EXPORT_ROWS ceiling and audited", () => {
    expect(reportSvc).toMatch(/MAX_EXPORT_ROWS \+ 1/);
    expect(reportSvc).toMatch(/"too_many_rows"/);
    expect(reportSvc).toMatch(/action: "report\.export"/);
  });
});

/* ------------------------------- BUG 2 -------------------------------- */

describe("BUG 2 — Data Export Agent ID is the canonical business code", () => {
  it("the staff-roster query filters by users.role — a promoted Agent's stale row cannot leak", () => {
    const fn = queries.slice(
      queries.indexOf("async function queryStaff"),
      queries.indexOf("export const queryAgents"),
    );
    expect(fn).toMatch(/eq\(users\.role, isAgent \? "agent" : "closer"\)/);
    // identity comes from the canonical staff code, never users.id / a row id
    expect(fn).toMatch(/code: agents\.agentCode/);
    expect(fn).toMatch(/code: closers\.closerCode/);
    expect(fn).not.toMatch(/code:\s*(users\.id|agents\.id|closers\.id)/);
  });

  it("the leads export still maps Agent ID from agents.agent_code (historical attribution kept)", () => {
    const fn = queries.slice(
      queries.indexOf("export async function queryLeads"),
      queries.indexOf("export async function queryFollowUps"),
    );
    expect(fn).toMatch(/agent_code: ag\.agentCode/);
    expect(fn).toMatch(/leftJoin\(ag, eq\(ag\.id, leads\.agentId\)\)/);
  });

  it("no dataset query resolves an Agent ID by name-match or array index", () => {
    expect(queries).not.toMatch(/agent_code[^\n]*fullName/i);
    expect(queries).not.toMatch(/agent_code:\s*\w+\[\s*\w+\s*\]/);
  });

  it("the XLSX/CSV writer maps every cell by column key (no positional coupling)", () => {
    expect(exportSvc).toMatch(/ds\.columns\.map\(\(c\) => cellText\(r\[c\.key\]\)\)/);
    const xlsx = read("server/export/xlsx.ts");
    expect(xlsx).toMatch(/values\[c\.key\] = cellText\(row\[c\.key\]\)/);
  });

  it("Data Export stays Admin/HR-gated — not widened", () => {
    expect(canThrow(() => assertCanExport("agent"))).toBe(true);
    expect(canThrow(() => assertCanExport("closer"))).toBe(true);
    expect(() => assertCanExport("admin")).not.toThrow();
  });
});

function canThrow(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof HttpError && e.status === 403;
  }
}
