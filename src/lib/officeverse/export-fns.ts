/**
 * Officeverse — client-callable Admin export server functions (Phase 8).
 *
 * Outside `src/server/**` (import-protected from the client bundle). The
 * `.handler()` bodies + their `@/server/*` imports are stripped from the client
 * build by the TanStack Start compiler. `inputValidator` runs on both sides →
 * inline Zod, no server-only imports.
 *
 * Both handlers call `requireRole("admin")` — the role comes from the session,
 * never the client. The client picks only { dataset, format, filters }.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRole, requestInfo } from "@/server/context";
import * as svc from "@/server/export/service";

const DATASETS = [
  "leads",
  "followups",
  "combined",
  "lead_assignments",
  "followup_history",
  "imports",
  "agents",
  "closers",
  "clients",
] as const;

const filters = z
  .object({
    dateFrom: z.string().trim().max(10).optional(),
    dateTo: z.string().trim().max(10).optional(),
    dateField: z.string().trim().max(20).optional(),
    status: z.string().trim().max(40).optional(),
    followUpStatus: z.string().trim().max(40).optional(),
    outcome: z.string().trim().max(40).optional(),
    action: z.string().trim().max(40).optional(),
    type: z.string().trim().max(40).optional(),
    ownerRole: z.string().trim().max(10).optional(),
    agentCode: z.string().trim().max(24).optional(),
    closerCode: z.string().trim().max(24).optional(),
    state: z.string().trim().max(120).optional(),
    zip: z.string().trim().max(20).optional(),
    source: z.string().trim().max(40).optional(),
    leadCode: z.string().trim().max(32).optional(),
    followUpCode: z.string().trim().max(32).optional(),
  })
  .partial()
  .default({});

const countInput = z.object({ dataset: z.enum(DATASETS), filters });
const exportInput = z.object({
  dataset: z.enum(DATASETS),
  format: z.enum(["xlsx", "csv"]),
  filters,
});

export const exportPreviewFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => countInput.parse(d))
  .handler(async ({ data }): Promise<svc.ExportPreview> => {
    const user = await requireRole("admin");
    return svc.runExportPreview(user, data);
  });

export const exportDownloadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => exportInput.parse(d))
  .handler(async ({ data }): Promise<svc.ExportFile> => {
    const user = await requireRole("admin");
    return svc.runExport(user, data, requestInfo());
  });
