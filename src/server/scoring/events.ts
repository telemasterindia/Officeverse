/**
 * Officeverse — Scoring Engine EVENT REGISTRY (Phase 2). PURE. No DB.
 *
 * The registry — not a database enum — is the validation authority for
 * `BusinessEvent.type`. A `BusinessEvent` whose `type` is not listed here is
 * logged and dropped: it is never scored and never awards a point.
 *
 * `enabledForScoring` gates whether the engine evaluates rules for a type at
 * all. The four future types ship DEFINED but DISABLED so their shape is locked
 * now while nothing scores until a later phase flips the flag AND an Admin
 * authors a rule.
 *
 * NO point values live here. Point values are 100% Admin-authored data.
 */

export interface EventDef {
  /** domain string, e.g. "LEAD_SUBMITTED" — never a DB enum */
  type: string;
  label: string;
  /** engine evaluates scoring rules for this type only when true */
  enabledForScoring: boolean;
  /** approved recognition KIND this event maps to (level selection is a later phase), or null */
  recognitionKind: string | null;
  /** phase the type was introduced in — documentation only */
  introducedIn: string;
}

export const EVENT_DEFS: readonly EventDef[] = [
  {
    type: "LEAD_SUBMITTED",
    label: "Lead Submitted",
    enabledForScoring: true,
    recognitionKind: "LEAD_SUBMITTED",
    introducedIn: "phase-2",
  },
  {
    type: "LEAD_ACCEPTED",
    label: "Lead Accepted",
    enabledForScoring: true,
    recognitionKind: "LEAD_ACCEPTED",
    introducedIn: "phase-2",
  },
  {
    type: "SALE",
    label: "Sale",
    enabledForScoring: true,
    recognitionKind: "SALE",
    introducedIn: "phase-2",
  },
  {
    type: "TEAM_MILESTONE",
    label: "Team Milestone",
    enabledForScoring: true,
    recognitionKind: "TEAM_MILESTONE",
    introducedIn: "phase-2",
  },
  {
    type: "ACHIEVEMENT_UNLOCKED",
    label: "Achievement Unlocked",
    enabledForScoring: true,
    recognitionKind: "ACHIEVEMENT_UNLOCKED",
    introducedIn: "phase-2",
  },

  /* ---- defined but DISABLED — future CRM phases own the emit site ---- */
  {
    type: "FOLLOW_UP_COMPLETED",
    label: "Follow-up Completed",
    enabledForScoring: false,
    recognitionKind: null,
    introducedIn: "future",
  },
  {
    type: "QUALIFIED",
    label: "Lead Qualified",
    enabledForScoring: false,
    recognitionKind: null,
    introducedIn: "future",
  },
  {
    type: "DISPOSITION_SET",
    label: "Disposition Set",
    enabledForScoring: false,
    recognitionKind: null,
    introducedIn: "future",
  },
  {
    type: "LEAD_GRADED",
    label: "Lead Graded",
    enabledForScoring: false,
    recognitionKind: null,
    introducedIn: "future",
  },
] as const;

const BY_TYPE: ReadonlyMap<string, EventDef> = new Map(EVENT_DEFS.map((d) => [d.type, d]));

export function getEventDef(type: string): EventDef | undefined {
  return BY_TYPE.get(type);
}

/** True when the registry knows this type (whether or not it is scoring-enabled). */
export function isKnownEvent(type: string): boolean {
  return BY_TYPE.has(type);
}

/** True only when the registry knows the type AND it is enabled for scoring. */
export function isScoringEnabledEvent(type: string): boolean {
  return BY_TYPE.get(type)?.enabledForScoring === true;
}

export function listScoringEnabledEventTypes(): string[] {
  return EVENT_DEFS.filter((d) => d.enabledForScoring).map((d) => d.type);
}
