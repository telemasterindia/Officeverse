/**
 * Officeverse — LEAD_ACCEPTED payload adapter (Phase 7). PURE.
 *
 * The single place a SERVER-VALIDATED "ASSIGNED → ACCEPTED" lead transition is
 * turned into a canonical `LEAD_ACCEPTED` BusinessEvent. Mirrors
 * `lead-submitted.ts`: keeps scoring-payload construction OUT of
 * `leads/service.ts`, emits only field-registry fields, invents no business
 * value, uses server-controlled timestamps, and imports NOTHING from
 * `../scoring/*` / `../gamification/*` / `../db/*` / `../live/*`.
 *
 * Points are NOT in the event. The Scoring Engine (or the dispatcher's gated
 * legacy-points fallback) decides the points from Admin/Operations rules.
 */
import type { Lead } from "@/lib/db/schema";
import type { ProcessCode } from "@/lib/officeverse/types";
import { buildBusinessEvent, type BusinessEvent } from "../business-event";

export interface LeadAcceptedContext {
  /** the row as persisted at the moment of acceptance */
  lead: Pick<
    Lead,
    "leadCode" | "debtAmount" | "state" | "zip" | "creditStatus" | "currentDebts" | "source"
  >;
  /** the employee celebrated — the submitting agent whose lead was accepted */
  subjectUserId: number;
  /** who performed the acceptance (a closer / admin) — may differ from subject */
  actorUserId: number;
  /** authoritative role of the subject (from the employee record) */
  subjectRole: string;
  /** authoritative process of the lead / subject */
  process: ProcessCode;
  /** authoritative operational shift date "YYYY-MM-DD" */
  shiftDate: string;
  /** the submitting agent's USER id (registry `agent_id`), or null */
  agentUserId: number | null;
  /** the assigned closer's USER id at acceptance time (registry `closer_id`), or null */
  closerUserId: number | null;
  /** server clock; defaults to now inside buildBusinessEvent */
  atMs?: number;
}

export function buildLeadAcceptedEvent(ctx: LeadAcceptedContext): BusinessEvent {
  const l = ctx.lead;
  const rawDebt = l.debtAmount == null ? "" : String(l.debtAmount).trim();
  const debt = rawDebt === "" ? Number.NaN : Number(rawDebt);

  const built = buildBusinessEvent({
    type: "LEAD_ACCEPTED",
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
      from_status: "ASSIGNED",
      to_status: "ACCEPTED",
      agent_id: ctx.agentUserId,
      closer_id: ctx.closerUserId,
      role: ctx.subjectRole,
      process: ctx.process,
      team: null, // no team model in the current CRM — future registry field
      shift_date: ctx.shiftDate,
    },
  });

  // Pin scoring / rule-version selection to the lead's authoritative shift date.
  return { ...built, operationalDate: ctx.shiftDate };
}
