/**
 * Officeverse — client-callable Company Branding server functions (Admin UAT §7).
 *
 * Outside `src/server/**`. READ is available to any authenticated user (to brand
 * a screen); WRITE requires ADMIN — asserted in the service, and the role is
 * taken from the session, never the client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requireRole, requestInfo } from "@/server/context";
import * as svc from "@/server/branding/service";

export const companyBrandingFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async (): Promise<svc.CompanyBranding> => {
    await requireUser();
    return svc.getCompanyBranding();
  });

const updateInput = z.object({
  companyName: z.string().trim().min(2).max(160).optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  addressLine: z.string().trim().max(400).nullable().optional(),
  taxId: z.string().trim().max(40).nullable().optional(),
  contactEmail: z.string().trim().max(191).nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  documentFooter: z.string().trim().max(400).nullable().optional(),
  logo: z
    .object({ mime: z.string().max(64), base64: z.string().max(1_400_000) })
    .nullable()
    .optional(),
});

export type UpdateCompanyBrandingInput = z.input<typeof updateInput>;

export const updateCompanyBrandingFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true; branding: svc.CompanyBranding }> => {
    const user = await requireRole("admin");
    return svc.updateCompanyBranding(user, data as svc.UpdateBrandingInput, requestInfo());
  });
