/**
 * Officeverse — company profile / official branding repository (Admin UAT §7).
 * DATA ACCESS ONLY. One singleton row (id = 1).
 */
import { eq } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import { companyProfile, type CompanyProfile, type NewCompanyProfile } from "@/lib/db/schema";

export async function getCompanyProfileRow(ex: DBX = getDb()): Promise<CompanyProfile | undefined> {
  const rows = await ex.select().from(companyProfile).where(eq(companyProfile.id, 1)).limit(1);
  return rows[0];
}

/** Insert-or-update the singleton row. */
export async function upsertCompanyProfile(
  patch: Partial<Omit<NewCompanyProfile, "id">> & { updatedAt: string },
  ex: DBX = getDb(),
): Promise<void> {
  const existing = await getCompanyProfileRow(ex);
  if (existing) {
    await ex.update(companyProfile).set(patch).where(eq(companyProfile.id, 1));
  } else {
    await ex.insert(companyProfile).values({ id: 1, ...patch });
  }
}
