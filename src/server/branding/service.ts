/**
 * Officeverse — Company Profile / Official Branding service (Admin UAT §7).
 *
 * ONE central configuration. The same official logo + company details are
 * reused by EVERY official output — salary slips, birthday emails, daily
 * follow-up emails, HR/Admin announcement emails, future official employee
 * emails, printable HR/payroll documents. No module uploads its own logo.
 *
 * Read (`getCompanyBranding`) is cheap + cached; anyone server-side may read it
 * to brand an output. WRITE is ADMIN ONLY (`updateCompanyBranding`) — the role
 * comes from the session, never the client, and is asserted here.
 */
import { getDb, isDbConfigured } from "@/lib/db";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { nowIST } from "../time";
import { config } from "../env";
import * as repo from "../db/repos/company-profile";
import type { User } from "@/lib/db/schema";

const DEFAULT_NAME = "TMI Officeverse";
export const MAX_LOGO_BYTES = 512 * 1024; // 512 KB — plenty for a company mark
export const LOGO_MIMES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"] as const;

export interface CompanyBranding {
  companyName: string;
  legalName: string | null;
  addressLine: string | null;
  taxId: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  documentFooter: string | null;
  hasLogo: boolean;
  logoMime: string | null;
  /** absolute URL for the logo (GET /api/branding/logo), null when unset */
  logoUrl: string | null;
}

let _cache: { at: number; value: CompanyBranding } | null = null;
const TTL_MS = 60_000;

function appOrigin(): string {
  return config.appUrl().replace(/\/+$/, "");
}

const DEFAULT_BRANDING: CompanyBranding = {
  companyName: DEFAULT_NAME,
  legalName: null,
  addressLine: null,
  taxId: null,
  contactEmail: null,
  contactPhone: null,
  documentFooter: null,
  hasLogo: false,
  logoMime: null,
  logoUrl: null,
};

/** The current official branding. Never throws — falls back to the defaults. */
export async function getCompanyBranding(): Promise<CompanyBranding> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.value;
  if (!isDbConfigured()) return DEFAULT_BRANDING;
  try {
    const row = await repo.getCompanyProfileRow();
    const hasLogo = !!(row && row.logoData && row.logoMime);
    const value: CompanyBranding = row
      ? {
          companyName: row.companyName || DEFAULT_NAME,
          legalName: row.legalName ?? null,
          addressLine: row.addressLine ?? null,
          taxId: row.taxId ?? null,
          contactEmail: row.contactEmail ?? null,
          contactPhone: row.contactPhone ?? null,
          documentFooter: row.documentFooter ?? null,
          hasLogo,
          logoMime: hasLogo ? (row.logoMime ?? null) : null,
          logoUrl: hasLogo
            ? `${appOrigin()}/api/branding/logo?v=${encodeURIComponent(row.logoUpdatedAt ?? "1")}`
            : null,
        }
      : DEFAULT_BRANDING;
    _cache = { at: Date.now(), value };
    return value;
  } catch {
    return DEFAULT_BRANDING;
  }
}

/** Drop the in-process cache (used after a write + in tests). */
export function invalidateBrandingCache(): void {
  _cache = null;
}

/** Raw logo bytes for GET /api/branding/logo. null when no logo is configured. */
export async function getCompanyLogo(): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!isDbConfigured()) return null;
  const row = await repo.getCompanyProfileRow().catch(() => undefined);
  if (!row || !row.logoData || !row.logoMime) return null;
  return { mime: row.logoMime, bytes: Buffer.from(row.logoData, "base64") };
}

export interface UpdateBrandingInput {
  companyName?: string;
  legalName?: string | null;
  addressLine?: string | null;
  taxId?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  documentFooter?: string | null;
  /** replace the official logo (base64 bytes + mime), or null to clear it */
  logo?: { mime: string; base64: string } | null;
}

type Meta = { ip?: string | null; userAgent?: string | null };

export async function updateCompanyBranding(
  actor: Pick<User, "id" | "role">,
  input: UpdateBrandingInput,
  meta: Meta = {},
): Promise<{ ok: true; branding: CompanyBranding }> {
  if (actor.role !== "admin") {
    throw new HttpError(403, "Only an Admin may change company branding", "forbidden");
  }
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");

  const clean = <T extends string>(v: T | null | undefined, max: number): string | null => {
    if (v == null) return null;
    const t = String(v).trim().slice(0, max);
    return t === "" ? null : t;
  };

  const patch: Parameters<typeof repo.upsertCompanyProfile>[0] = { updatedAt: nowIST() };
  if (input.companyName !== undefined) {
    const name = String(input.companyName).trim().slice(0, 160);
    if (name.length < 2) throw new HttpError(400, "Company name is required", "bad_name");
    patch.companyName = name;
  }
  if (input.legalName !== undefined) patch.legalName = clean(input.legalName, 200);
  if (input.addressLine !== undefined) patch.addressLine = clean(input.addressLine, 400);
  if (input.taxId !== undefined) patch.taxId = clean(input.taxId, 40);
  if (input.contactEmail !== undefined) patch.contactEmail = clean(input.contactEmail, 191);
  if (input.contactPhone !== undefined) patch.contactPhone = clean(input.contactPhone, 40);
  if (input.documentFooter !== undefined) patch.documentFooter = clean(input.documentFooter, 400);
  if (input.logo !== undefined) {
    if (input.logo === null) {
      patch.logoMime = null;
      patch.logoData = null;
      patch.logoUpdatedAt = null;
    } else {
      if (!(LOGO_MIMES as readonly string[]).includes(input.logo.mime)) {
        throw new HttpError(400, "Logo must be PNG, JPEG, SVG or WebP", "bad_logo_type");
      }
      const bytes = Buffer.from(input.logo.base64, "base64");
      if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) {
        throw new HttpError(400, `Logo must be 1 byte – ${MAX_LOGO_BYTES} bytes`, "bad_logo_size");
      }
      patch.logoMime = input.logo.mime;
      patch.logoData = bytes.toString("base64");
      patch.logoUpdatedAt = nowIST();
    }
  }
  patch.updatedByUserId = actor.id;

  await repo.upsertCompanyProfile(patch);
  invalidateBrandingCache();

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "company.branding_updated",
    entityType: "company_profile",
    entityId: 1,
    metadata: { fields: Object.keys(input) },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { ok: true, branding: await getCompanyBranding() };
}
