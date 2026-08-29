/**
 * Officeverse — bulk-import field catalog (Phase 7). PURE, client + server safe.
 *
 * These are the ONLY spreadsheet-mappable fields. Every key maps to a column
 * that already exists on the `leads` / `follow_ups` tables (or is an
 * import-only helper such as `import_ref`). Nothing here invents schema.
 */

export type ImportMode = "leads" | "leads_followups" | "followups";

export const IMPORT_MODES: ImportMode[] = ["leads", "leads_followups", "followups"];

export interface FieldDef {
  /** canonical Officeverse field key */
  key: string;
  label: string;
  /** required in these modes */
  requiredIn: ImportMode[];
  /** header names (lower-cased, non-alnum stripped) that auto-map to this field */
  aliases: string[];
  example: string;
  note?: string;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/* ------------------------------- LEAD ------------------------------- */

export const LEAD_FIELDS: FieldDef[] = [
  {
    key: "customer_name",
    label: "Customer name",
    requiredIn: ["leads", "leads_followups"],
    aliases: ["name", "customername", "customer", "fullname", "client", "clientname", "leadname"],
    example: "Jane Cooper",
  },
  {
    key: "phone",
    label: "Phone",
    requiredIn: ["leads", "leads_followups"],
    aliases: ["phone", "phonenumber", "mobile", "cell", "contact", "contactnumber", "tel"],
    example: "+1 512 555 0142",
    note: "Digits are normalised; used as the Lead identity for duplicate detection.",
  },
  {
    key: "email",
    label: "Email",
    requiredIn: [],
    aliases: ["email", "emailaddress", "mail"],
    example: "jane@acme.com",
  },
  {
    key: "address",
    label: "Address",
    requiredIn: [],
    aliases: ["address", "street", "addressline1"],
    example: "24 Bell St",
  },
  { key: "city", label: "City", requiredIn: [], aliases: ["city", "town"], example: "Austin" },
  {
    key: "state",
    label: "State",
    requiredIn: [],
    aliases: ["state", "province", "region"],
    example: "TX",
  },
  {
    key: "zip",
    label: "ZIP",
    requiredIn: [],
    aliases: ["zip", "zipcode", "postalcode", "postcode", "pincode"],
    example: "78701",
  },
  {
    key: "debt_amount",
    label: "Debt amount",
    requiredIn: [],
    aliases: ["debtamount", "debt", "amount", "balance", "owed"],
    example: "18500",
  },
  {
    key: "credit_status",
    label: "Credit status",
    requiredIn: [],
    aliases: ["creditstatus", "credit"],
    example: "Fair",
  },
  {
    key: "current_debts",
    label: "Current / Late",
    requiredIn: [],
    aliases: ["currentdebts", "currentlate", "paymentstatus", "standing"],
    example: "Current",
    note: "Allowed: Current, Late.",
  },
  {
    key: "comments",
    label: "Notes",
    requiredIn: [],
    aliases: ["comments", "notes", "note", "remarks", "comment"],
    example: "Called twice, wants a call back",
  },
  {
    key: "status",
    label: "Lead status",
    requiredIn: [],
    aliases: ["status", "leadstatus", "stage", "disposition"],
    example: "NEW",
    note: "Allowed: NEW, ASSIGNED, ACCEPTED, REJECTED, FOLLOW-UP, COMPLETED. Default NEW.",
  },
  {
    key: "agent_code",
    label: "Agent ID (Admin only)",
    requiredIn: [],
    aliases: ["agentcode", "agent", "agentid", "owner", "ownercode", "submittedby"],
    example: "AG-00001",
    note: "Admin only. Ignored/validated for Agent imports (ownership is forced to the importer).",
  },
  {
    key: "closer_code",
    label: "Closer ID",
    requiredIn: [],
    aliases: ["closercode", "closer", "closerid", "assignedcloser"],
    example: "CL-00001",
  },
  {
    key: "import_ref",
    label: "Import reference",
    requiredIn: [],
    aliases: [
      "importref",
      "ref",
      "reference",
      "externalref",
      "externalid",
      "externalleadreference",
      "groupkey",
    ],
    example: "row-001",
    note: "Optional stable token to group multiple spreadsheet rows onto ONE Lead. Never a permanent identity.",
  },
  {
    key: "lead_code",
    label: "Existing Lead ID",
    requiredIn: [],
    aliases: ["leadcode", "leadid", "officeverseleadid", "tmiid"],
    example: "TMI_00012007",
    note: "Follow-ups mode: the existing Officeverse Lead to attach the follow-up to.",
  },
];

/* ----------------------------- FOLLOW-UP ---------------------------- */

export const FOLLOWUP_FIELDS: FieldDef[] = [
  {
    key: "followup_date",
    label: "Follow-up date",
    requiredIn: ["leads_followups", "followups"],
    aliases: ["followupdate", "callbackdate", "nextcalldate", "fudate", "date", "scheduleddate"],
    example: "2026-09-14",
    note: "Format YYYY-MM-DD.",
  },
  {
    key: "followup_time",
    label: "Follow-up time",
    requiredIn: ["leads_followups", "followups"],
    aliases: ["followuptime", "callbacktime", "nextcalltime", "futime", "time", "scheduledtime"],
    example: "10:30",
    note: "24-hour HH:MM. Interpreted as the literal IST wall-clock time (no shift roll-back).",
  },
  {
    key: "followup_comment",
    label: "Follow-up note",
    requiredIn: [],
    aliases: ["followupcomment", "followupnote", "callbacknote", "funote", "followupnotes"],
    example: "Confirm paperwork",
  },
  {
    key: "followup_owner_role",
    label: "Follow-up owner role",
    requiredIn: [],
    aliases: ["followupownerrole", "ownerrole", "followuptype", "futype"],
    example: "agent",
    note: "agent (default) or closer. Agent imports may only create agent-owned follow-ups.",
  },
  {
    key: "followup_closer_code",
    label: "Follow-up closer ID",
    requiredIn: [],
    aliases: ["followupclosercode", "followupcloser", "fucloser"],
    example: "CL-00001",
    note: "Required when the follow-up owner role is closer.",
  },
  {
    key: "capture_date",
    label: "Capture date",
    requiredIn: [],
    aliases: ["capturedate", "createddate", "entrydate"],
    example: "2026-08-29",
    note: "Optional. Defaults to the current operational shift date.",
  },
];

/* ------------------------------- helpers --------------------------- */

export const ALL_FIELDS: FieldDef[] = [...LEAD_FIELDS, ...FOLLOWUP_FIELDS];

export function fieldsForMode(mode: ImportMode): FieldDef[] {
  if (mode === "leads") return LEAD_FIELDS.filter((f) => f.key !== "lead_code");
  if (mode === "followups") {
    return [
      ...FOLLOWUP_FIELDS,
      LEAD_FIELDS.find((f) => f.key === "lead_code")!,
      LEAD_FIELDS.find((f) => f.key === "phone")!,
      LEAD_FIELDS.find((f) => f.key === "import_ref")!,
    ];
  }
  return ALL_FIELDS;
}

export function requiredKeys(mode: ImportMode): string[] {
  const keys = fieldsForMode(mode)
    .filter((f) => f.requiredIn.includes(mode))
    .map((f) => f.key);
  if (mode === "followups") {
    // a follow-up import must reference an existing lead somehow
    return keys; // lead_code OR phone checked in the planner, not here
  }
  return keys;
}

export function findFieldByHeader(header: string, mode: ImportMode): FieldDef | null {
  const h = norm(header);
  if (!h) return null;
  for (const f of fieldsForMode(mode)) {
    if (norm(f.key) === h || f.aliases.includes(h)) return f;
  }
  return null;
}

export const LEAD_STATUS_VALUES = [
  "NEW",
  "ASSIGNED",
  "ACCEPTED",
  "REJECTED",
  "FOLLOW-UP",
  "COMPLETED",
] as const;
export const CURRENT_DEBTS_VALUES = ["Current", "Late"] as const;
export const FOLLOWUP_OWNER_ROLES = ["agent", "closer"] as const;

export { norm as normalizeHeader };
