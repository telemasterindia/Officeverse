/**
 * Officeverse — canonical BUSINESS EVENT contract (Phase 2). PURE (except the
 * optional server-clock helper). No DB.
 *
 * A BusinessEvent is the ONLY thing the CRM ever hands to the intelligence
 * layers. The CRM emits it best-effort, AFTER it has persisted + audited the
 * underlying fact. It carries no client-decided points / rank / score / sale
 * flag, and its timestamps are server-controlled.
 *
 *   type            domain string, validated by the event registry (not a DB enum)
 *   occurredAtMs    server epoch ms of the confirmed fact (audit only)
 *   operationalDate "YYYY-MM-DD" server shift date — the authoritative key for
 *                   scoring AND rule-version selection
 *   subjectUserId   who earns / is celebrated
 *   actorUserId     who performed the action (may differ), or null
 *   source          { type, id }  e.g. { type:"lead", id:"TMI_00012345" }
 *   payload         FLAT, whitelisted by the field registry, versioned
 *
 * Unknown `type`  → logged + dropped (never scored, never awarded).
 * Unknown payload key → stripped. Wrong-typed payload value → coerced or null.
 */
import { z } from "zod";
import { currentShiftDate } from "../time";
import type { ProcessCode } from "@/lib/officeverse/types";
import { isKnownEvent } from "../scoring/events";
import { getFieldDef, isFieldValidForEvent, type FieldType } from "../scoring/fields";
import type { ScoringPayload, ScoringPayloadValue } from "../scoring/conditions";

export interface BusinessEventSource {
  type: string;
  id: string;
}

export interface BusinessEvent {
  type: string;
  occurredAtMs: number;
  operationalDate: string;
  subjectUserId: number;
  actorUserId: number | null;
  source: BusinessEventSource;
  payload: ScoringPayload;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const businessEventSchema = z.object({
  type: z.string().min(1).max(64),
  occurredAtMs: z.number().int().positive(),
  operationalDate: z.string().regex(YMD),
  subjectUserId: z.number().int().positive(),
  actorUserId: z.number().int().positive().nullable(),
  source: z.object({
    type: z.string().min(1).max(40),
    id: z.string().min(1).max(64),
  }),
  payload: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

/* ------------------------------ coercion ---------------------------------- */

function coerce(value: ScoringPayloadValue, type: FieldType): ScoringPayloadValue {
  switch (type) {
    case "number":
    case "money": {
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      if (typeof value === "string" && /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(value.trim())) {
        const n = Number(value.trim());
        return Number.isFinite(n) ? n : null;
      }
      return null;
    }
    case "string": {
      if (typeof value === "string") return value;
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      return null;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (value === "true" || value === 1) return true;
      if (value === "false" || value === 0) return false;
      return null;
    }
    case "date": {
      if (typeof value === "string") {
        const s = value.trim().slice(0, 10);
        return YMD.test(s) ? s : null;
      }
      return null;
    }
    default:
      return null;
  }
}

export type NormalizeResult =
  | {
      ok: true;
      event: BusinessEvent;
      /** payload keys removed because the field registry does not allow them for this type */
      droppedKeys: string[];
      /** payload keys kept but whose value could not be coerced to the field type */
      nulledKeys: string[];
    }
  | { ok: false; reason: string };

/**
 * Validate the envelope, drop unknown event types, strip non-whitelisted
 * payload keys, and coerce surviving values to their registered field type.
 * Total — never throws.
 */
export function normalizeBusinessEvent(raw: unknown): NormalizeResult {
  const parsed = businessEventSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `schema:${parsed.error.issues[0]?.path.join(".") || "invalid"}` };
  }
  const e = parsed.data;
  if (!isKnownEvent(e.type)) return { ok: false, reason: "unknown_event_type" };

  const payload: ScoringPayload = {};
  const droppedKeys: string[] = [];
  const nulledKeys: string[] = [];

  for (const [key, value] of Object.entries(e.payload)) {
    if (!isFieldValidForEvent(key, e.type)) {
      droppedKeys.push(key);
      continue;
    }
    const def = getFieldDef(key)!;
    const c = coerce(value, def.type);
    if (c === null && value !== null) nulledKeys.push(key);
    payload[key] = c;
  }

  return {
    ok: true,
    event: {
      type: e.type,
      occurredAtMs: e.occurredAtMs,
      operationalDate: e.operationalDate,
      subjectUserId: e.subjectUserId,
      actorUserId: e.actorUserId,
      source: { type: e.source.type, id: e.source.id },
      payload,
    },
    droppedKeys,
    nulledKeys,
  };
}

/* ---------------------- server-side builder (Phase 4 uses this) ---------- */

export interface BuildBusinessEventInput {
  type: string;
  subjectUserId: number;
  actorUserId?: number | null;
  source: BusinessEventSource;
  payload?: Record<string, ScoringPayloadValue>;
  /** process used to derive the operational shift date */
  process?: ProcessCode;
  /** server epoch ms; defaults to Date.now() — a client value is never accepted here */
  atMs?: number;
}

/**
 * Build a BusinessEvent with SERVER-controlled timestamps. `occurredAtMs` and
 * `operationalDate` are derived here, never taken from a request body. The
 * result is passed through `normalizeBusinessEvent` by the dispatcher, so an
 * unknown type / stray payload key is still handled safely.
 */
export function buildBusinessEvent(input: BuildBusinessEventInput): BusinessEvent {
  const atMs =
    typeof input.atMs === "number" && Number.isFinite(input.atMs) ? input.atMs : Date.now();
  return {
    type: input.type,
    occurredAtMs: atMs,
    operationalDate: currentShiftDate(input.process ?? "US", atMs),
    subjectUserId: input.subjectUserId,
    actorUserId: input.actorUserId ?? null,
    source: input.source,
    payload: { ...(input.payload ?? {}) },
  };
}
