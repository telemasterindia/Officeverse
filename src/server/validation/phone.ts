/**
 * Officeverse — strict US (NANP) phone validation (server / Zod).
 *
 * The pure digit/format helpers live in `@/lib/officeverse/phone` (client-safe,
 * reused by the New-Customer form for inline UX). This module adds the
 * AUTHORITATIVE Zod schemas used at the server-function boundary.
 *
 * Agent-side UAT #6: 11-digit values are accepted ONLY when the extra digit is
 * the country code `1`; 12+ digit, short, and non-NANP area/exchange codes are
 * rejected.
 */
import { z } from "zod";
import { isValidUsPhone } from "@/lib/officeverse/phone";

export {
  usPhoneDigits,
  isValidUsPhone,
  formatUsPhone,
  isValidEmail,
} from "@/lib/officeverse/phone";

const MESSAGE =
  "Enter a valid US phone number (10 digits, or 11 with a leading 1). 11+ digit / invalid numbers are rejected.";

/** Required US phone field. Trims, then hard-validates NANP. */
export const usPhoneSchema = z
  .string()
  .trim()
  .min(1, "Phone number is required")
  .max(40)
  .superRefine((val, ctx) => {
    if (!isValidUsPhone(val)) ctx.addIssue({ code: "custom", message: MESSAGE });
  });

/** Optional US phone field (patch/update). */
export const usPhoneSchemaOptional = z
  .string()
  .trim()
  .max(40)
  .superRefine((val, ctx) => {
    if (val && !isValidUsPhone(val)) ctx.addIssue({ code: "custom", message: MESSAGE });
  })
  .optional();
