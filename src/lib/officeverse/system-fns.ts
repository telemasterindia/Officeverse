/**
 * Officeverse — Admin-only system / production-readiness status (Phase 17).
 *
 * Outside `src/server/**`. Returns STATUS ONLY — never a secret. Admin role is
 * enforced server-side via requireRole("admin").
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRole } from "@/server/context";
import { collectHealth, type HealthReport } from "@/server/health";

export const systemStatusFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ deep: z.coerce.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data }): Promise<HealthReport> => {
    await requireRole("admin");
    return collectHealth({ deep: data.deep === true });
  });
