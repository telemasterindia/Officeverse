/**
 * Officeverse — Scoring Engine FIELD REGISTRY (Phase 2). PURE. No DB.
 *
 * The registry is the whitelist for `BusinessEvent.payload`. A payload key not
 * listed for the event's type is STRIPPED before evaluation (no security or
 * scoring impact). A condition that references a field which is in the registry
 * but absent from the payload evaluates to FALSE with reason "missing_field" —
 * never an accidental award.
 *
 * "Current" fields already exist in the CRM and would be available at the emit
 * site in Phase 4. "Future" fields are shape stubs: an Admin may select one in
 * a rule, but until the owning CRM phase emits it every condition on it is
 * false. Adding a field here is a one-line change — never an evaluator rewrite.
 *
 * NO business values (amounts, thresholds, closer ids, team names) live here.
 */

export type FieldType = "number" | "money" | "string" | "stringList" | "boolean" | "date";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** BusinessEvent types whose payload may legitimately carry this field */
  events: string[];
  /** "phase-2" (data exists) | "future" (registry stub, not yet emitted) */
  introducedIn: string;
}

const LEAD_EVENTS = ["LEAD_SUBMITTED", "LEAD_ACCEPTED", "SALE"];
const ALL_EVENTS = [
  "LEAD_SUBMITTED",
  "LEAD_ACCEPTED",
  "SALE",
  "TEAM_MILESTONE",
  "ACHIEVEMENT_UNLOCKED",
];

export const FIELD_DEFS: readonly FieldDef[] = [
  /* ---------------- current — CRM data exists today ---------------- */
  {
    key: "debt_amount",
    label: "Debt Amount",
    type: "money",
    events: [...LEAD_EVENTS],
    introducedIn: "phase-2",
  },
  {
    key: "state",
    label: "State",
    type: "string",
    events: [...LEAD_EVENTS],
    introducedIn: "phase-2",
  },
  { key: "zip", label: "ZIP", type: "string", events: [...LEAD_EVENTS], introducedIn: "phase-2" },
  {
    key: "credit_status",
    label: "Credit Status",
    type: "string",
    events: [...LEAD_EVENTS],
    introducedIn: "phase-2",
  },
  {
    key: "current_debts",
    label: "Current Debts",
    type: "string",
    events: [...LEAD_EVENTS],
    introducedIn: "phase-2",
  },
  {
    key: "lead_source",
    label: "Lead Source",
    type: "string",
    events: [...LEAD_EVENTS],
    introducedIn: "phase-2",
  },
  {
    key: "from_status",
    label: "From Status",
    // LEAD_SUBMITTED carries from_status = null (a new lead has no prior status);
    // it is listed so an Admin can write `from_status isNull` rules.
    type: "string",
    events: ["LEAD_SUBMITTED", "LEAD_ACCEPTED", "SALE", "DISPOSITION_SET"],
    introducedIn: "phase-2",
  },
  {
    key: "to_status",
    label: "To Status",
    // On LEAD_SUBMITTED this is the initial status ("NEW", or "ASSIGNED" when the
    // lead is transferred to a closer on creation).
    type: "string",
    events: ["LEAD_SUBMITTED", "LEAD_ACCEPTED", "SALE", "DISPOSITION_SET"],
    introducedIn: "phase-2",
  },
  {
    key: "agent_id",
    label: "Agent (user id)",
    type: "number",
    events: [...LEAD_EVENTS],
    introducedIn: "phase-2",
  },
  {
    key: "closer_id",
    label: "Closer (user id)",
    type: "number",
    events: [...LEAD_EVENTS],
    introducedIn: "phase-2",
  },
  {
    key: "role",
    label: "Subject Role",
    type: "string",
    events: [...ALL_EVENTS],
    introducedIn: "phase-2",
  },
  {
    key: "process",
    label: "Process",
    type: "string",
    events: [...ALL_EVENTS],
    introducedIn: "phase-2",
  },
  { key: "team", label: "Team", type: "string", events: [...ALL_EVENTS], introducedIn: "phase-2" },
  {
    key: "shift_date",
    label: "Shift Date",
    type: "date",
    events: [...ALL_EVENTS],
    introducedIn: "phase-2",
  },

  /* ---------------- future — registry stubs only ------------------ */
  {
    key: "lead_type",
    label: "Lead Type",
    type: "string",
    events: ["LEAD_SUBMITTED", "LEAD_GRADED"],
    introducedIn: "future",
  },
  {
    key: "lead_grade",
    label: "Lead Grade",
    type: "string",
    events: ["LEAD_GRADED"],
    introducedIn: "future",
  },
  {
    key: "qualified",
    label: "Qualified",
    type: "boolean",
    events: ["QUALIFIED", "LEAD_ACCEPTED"],
    introducedIn: "future",
  },
  {
    key: "disposition",
    label: "Disposition",
    type: "string",
    events: ["DISPOSITION_SET"],
    introducedIn: "future",
  },
  {
    key: "follow_up_type",
    label: "Follow-up Type",
    type: "string",
    events: ["FOLLOW_UP_COMPLETED"],
    introducedIn: "future",
  },
  {
    key: "follow_up_outcome",
    label: "Follow-up Outcome",
    type: "string",
    events: ["FOLLOW_UP_COMPLETED"],
    introducedIn: "future",
  },
  {
    key: "sale_amount",
    label: "Sale Amount",
    type: "money",
    events: ["SALE"],
    introducedIn: "future",
  },
  {
    key: "closer_tenure_days",
    label: "Closer Tenure (days)",
    type: "number",
    events: ["LEAD_ACCEPTED", "SALE"],
    introducedIn: "future",
  },
] as const;

const BY_KEY: ReadonlyMap<string, FieldDef> = new Map(FIELD_DEFS.map((d) => [d.key, d]));

export function getFieldDef(key: string): FieldDef | undefined {
  return BY_KEY.get(key);
}

/** Fields the registry permits in a payload for `eventType`. */
export function fieldsForEvent(eventType: string): FieldDef[] {
  return FIELD_DEFS.filter((d) => d.events.includes(eventType));
}

/** True when `key` is a registered field that is valid for `eventType`. */
export function isFieldValidForEvent(key: string, eventType: string): boolean {
  return BY_KEY.get(key)?.events.includes(eventType) === true;
}
