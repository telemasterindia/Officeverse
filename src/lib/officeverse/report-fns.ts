/**
 * Officeverse — client-callable Reports server functions.
 *
 * Outside `src/server/**` so the `.handler()` bodies + their `@/server/*`
 * imports are stripped from the client bundle. `inputValidator` runs on both
 * sides → inline Zod only.
 *
 * Both handlers call `requireRole("admin", "hr")` — the role comes from the
 * session, never the client. The client sends only the three Reports filters
 * (date range, process, employee) + a file format.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRole, requestInfo } from "@/server/context";
import * as svc from "@/server/report/service";

const YMD = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/);

const reportExportInput = z.object({
  dateFrom: YMD.optional(),
  dateTo: YMD.optional(),
  process: z.enum(["ALL", "US", "UK", "IN", "AU"]).default("ALL"),
  employee: z.string().trim().max(32).default("ALL"),
  format: z.enum(["xlsx", "csv"]),
});

export const reportEmployeesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<svc.ReportEmployee[]> => {
    const user = await requireRole("admin", "hr");
    return svc.reportEmployees(user);
  },
);

export const reportExportFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => reportExportInput.parse(d))
  .handler(async ({ data }): Promise<svc.ReportFile> => {
    const user = await requireRole("admin", "hr");
    return svc.runReportExport(user, data, requestInfo());
  });
