/**
 * Officeverse — canonical US state list + ZIP helpers.
 *
 * ONE definition, used by every US-process customer form (Lead / Follow-up).
 * India and other processes are unaffected — they keep a free-text State field.
 *
 * ZIP is always a STRING (schema: varchar). US ZIPs can have leading zeros
 * ("02108") — never coerce to a number. `sanitizeZip` keeps only ZIP digits and
 * the optional +4 dash; `isValidUsZip` accepts 5 digits or ZIP+4.
 */

export interface UsState {
  code: string;
  name: string;
}

export const US_STATES: readonly UsState[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
] as const;

const CODE_SET = new Set(US_STATES.map((s) => s.code));

/** Is `value` a valid USPS 2-letter state code? */
export function isUsStateCode(value: string | null | undefined): boolean {
  return !!value && CODE_SET.has(value.trim().toUpperCase());
}

/** Keep only characters valid in a US ZIP ("02108" or "02108-1234"). */
export function sanitizeZip(raw: string | null | undefined): string {
  const s = String(raw ?? "").replace(/[^0-9-]/g, "");
  // at most one dash, only after 5 digits
  const m = s.match(/^(\d{0,5})-?(\d{0,4}).*$/);
  if (!m) return s.slice(0, 10);
  const five = m[1] ?? "";
  const plus4 = m[2] ?? "";
  return plus4 ? `${five}-${plus4}` : five;
}

/** 5-digit ZIP or ZIP+4. Leading zeros are fine — it is compared as text. */
export function isValidUsZip(value: string | null | undefined): boolean {
  return /^\d{5}(-\d{4})?$/.test(String(value ?? "").trim());
}
