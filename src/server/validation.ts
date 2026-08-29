/**
 * Officeverse — shared Zod schemas for server-function input validation.
 *
 * Every mutation validates through one of these. Domain-specific schemas
 * (leads, follow-ups, imports…) are added in their own phases; this file holds
 * auth + common primitives.
 */
import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(191);

export const passwordSchema = z.string().min(8).max(200);

/** Login accepts any non-empty password so old/short passwords still work. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Parse helper that returns a flat error map instead of throwing. */
export function safeParse<T>(
  schema: z.ZodType<T>,
  data: unknown,
): { ok: true; data: T } | { ok: false; errors: Record<string, string> } {
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, data: r.data };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "_";
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
