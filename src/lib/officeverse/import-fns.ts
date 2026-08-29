/**
 * Officeverse — client-callable bulk-import server functions (Phase 7).
 *
 * Outside `src/server/**` (import-protected from the client bundle). The
 * `.handler()` bodies + their `@/server/*` imports are stripped from the client
 * build by the TanStack Start compiler. `inputValidator` runs on both sides →
 * inline Zod, no server-only imports.
 *
 * Every handler calls `requireUser()`; the import service enforces
 * admin/agent-only authorization and resolves ALL ownership server-side.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/import/service";
import type { CommitResult, PreviewResult } from "@/lib/officeverse/import/types";

const MAX_ROWS = 20_000;

const payload = z.object({
  mode: z.enum(["leads", "leads_followups", "followups"]),
  fileName: z.string().trim().min(1).max(255),
  mapping: z.record(z.string().min(1).max(80), z.string().max(255)),
  rows: z
    .array(z.record(z.string().max(255), z.string().max(2000)))
    .min(1)
    .max(MAX_ROWS),
});

export const previewImportFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => payload.parse(d))
  .handler(async ({ data }): Promise<PreviewResult> => {
    const user = await requireUser();
    return svc.previewImport(user, data);
  });

export const commitImportFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => payload.parse(d))
  .handler(async ({ data }): Promise<CommitResult> => {
    const user = await requireUser();
    return svc.commitImport(user, data, requestInfo());
  });
