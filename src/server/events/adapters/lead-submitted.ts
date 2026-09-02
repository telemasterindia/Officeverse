/**
 * Officeverse — LEAD_SUBMITTED payload adapter (Phase 4). PURE.
 *
 * The single place a persisted Lead + trusted server-side context is turned
 * into a canonical `LEAD_SUBMITTED` BusinessEvent. Keeps scoring-payload
 * construction OUT of `leads/service.ts`.
 *
 * Rules:
 *   - only fields in the Phase-2 field registry are emitted
 *   - no business value is invented; a field the CRM does not carry → null
 *   - timestamps are server-controlled (`buildBusinessEvent`); `operationalDate`
 *     is pinned to the Lead's authoritative shift date
 *   - imports NOTHING from `../scoring/*`, `../gamification/*`, `../db/*` or
 *     `../live/*` — it is a data-shaping boundary only
 */
import type { Lead } from "@/lib/db/schema";
import type { ProcessCode } from "@/lib/officeverse/types";
import { buildBusinessEvent, type BusinessEvent } from "../business-event";

export interface LeadSubmittedContext {
  /** the row that was actually persisted */
  lead: Pick<
    Lead,
    | "leadCode"
    | "debtAmount"
    | "state"
    | "zip"
    | "creditStatus"
    | "currentDebts"
    | "source"
    | "status"
  >;
  /** the employee who earns the points — the submitting agent */
  subjectUserId: number;
  /** who performed the action (agent self-submit → same as subject; admin-on-behalf → the admin) */
  actorUserId: number;
  /** authoritative role of the subject (from the employee record, not the client) */
  subjectRole: string;
  /** authoritative process of the lead */
  process: ProcessCode;
  /** authoritative operational shift date of the lead, "YYYY-MM-DD" */
  shiftDate: string;
  /** submitting agent's USER id (registry `agent_id`), or null */
  agentUserId: number | null;
  /** assigned closer's USER id at submission time (registry `closer_id`), or null if none */
  closerUserId: number | null;
  /** server clock; defaults to now inside buildBusinessEvent */
  atMs?: number;
}

export function buildLeadSubmittedEvent(ctx: LeadSubmittedContext): BusinessEvent {
  const l = ctx.lead;
  // `leads.debt_amount` is a NOT-NULL decimal string ("0.00" default); guard
  // anyway so a blank / non-numeric value becomes null, never a fabricated 0.
  const rawDebt = l.debtAmount == null ? "" : String(l.debtAmount).trim();
  const debt = rawDebt === "" ? Number.NaN : Number(rawDebt);

  const built = buildBusinessEvent({
    type: "LEAD_SUBMITTED",
    subjectUserId: ctx.subjectUserId,
    actorUserId: ctx.actorUserId,
    source: { type: "lead", id: String(l.leadCode) },
    process: ctx.process,
    ...(ctx.atMs != null ? { atMs: ctx.atMs } : {}),
    payload: {
      debt_amount: Number.isFinite(debt) ? debt : null,
      state: l.state ?? null,
      zip: l.zip ?? null,
      credit_status: l.creditStatus ?? null,
      current_debts: l.currentDebts ?? null,
      lead_source: l.source ?? null,
      from_status: null, // a new lead has no prior status
      to_status: l.status ?? null,
      agent_id: ctx.agentUserId,
      closer_id: ctx.closerUserId, // null when no closer is assigned at submission
      role: ctx.subjectRole,
      process: ctx.process,
      team: null, // the current CRM has no team model — future registry field
      shift_date: ctx.shiftDate,
    },
  });

  // Pin the scoring/version-selection date to the Lead's authoritative shift date
  // (for an agent this equals currentShiftDate(process); an admin may back-date).
  return { ...built, operationalDate: ctx.shiftDate };
}
