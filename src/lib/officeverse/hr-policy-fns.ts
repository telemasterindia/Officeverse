/**
 * Officeverse — client-callable HR Policy server functions.
 *
 * Outside `src/server/**` so handler bodies + their `@/server/*` imports are
 * stripped from the client bundle. Roles come from the session, never the body:
 *   - list / get               → any authenticated user (service hides drafts
 *                                from Agents / Closers)
 *   - save / publish / delete  → requireRole("admin", "hr")
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRole, requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/hr-policy/service";

const idInput = z.object({ id: z.coerce.number().int().positive() });

const saveInput = z.object({
  id: z.coerce.number().int().positive().optional(),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(50_000),
  effective_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const statusInput = z.object({
  id: z.coerce.number().int().positive(),
  publish: z.boolean(),
});

export const listPoliciesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ dbUnavailable?: boolean; canManage: boolean; rows: svc.PolicyDTO[] }> => {
    const user = await requireUser();
    return svc.listPolicies(user);
  },
);

export const getPolicyFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }): Promise<svc.PolicyDTO> => {
    const user = await requireUser();
    return svc.getPolicy(user, data.id);
  });

export const savePolicyFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => saveInput.parse(d))
  .handler(async ({ data }): Promise<svc.PolicyDTO> => {
    const user = await requireRole("admin", "hr");
    return svc.savePolicy(
      user,
      {
        ...(data.id ? { id: data.id } : {}),
        title: data.title,
        content: data.content,
        ...(data.effective_date ? { effective_date: data.effective_date } : {}),
      },
      requestInfo(),
    );
  });

export const setPolicyStatusFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => statusInput.parse(d))
  .handler(async ({ data }): Promise<svc.PolicyDTO> => {
    const user = await requireRole("admin", "hr");
    return svc.setPolicyStatus(user, data.id, data.publish, requestInfo());
  });

export const deletePolicyFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const user = await requireRole("admin", "hr");
    return svc.deletePolicy(user, data.id, requestInfo());
  });
