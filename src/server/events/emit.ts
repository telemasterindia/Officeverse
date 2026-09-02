/**
 * Officeverse — BUSINESS EVENT EMITTER (Phase 2).
 *
 * `emitBusinessEvent()` is the ONE line a CRM service will add in Phase 4,
 * AFTER it has persisted + audited the underlying fact. It is:
 *   • non-blocking  — returns immediately, work runs on a microtask
 *   • best-effort   — every error is swallowed + logged
 *   • CRM-safe      — can never throw into, slow, or alter a lead / follow-up /
 *                     assignment / sale operation
 *
 * PHASE 2 SCOPE: NOT wired to any CRM caller. Built + tested here so Phase 4 is
 * a one-line change with no surprises.
 */
import { dispatchBusinessEvent } from "./dispatcher";
import {
  buildBusinessEvent,
  type BuildBusinessEventInput,
  type BusinessEvent,
} from "./business-event";

/** Fire-and-forget dispatch of an already-built BusinessEvent. Never throws. */
export function emitBusinessEvent(event: BusinessEvent): void {
  void Promise.resolve()
    .then(() => dispatchBusinessEvent(event))
    .catch((err) => {
      console.error("[emitBusinessEvent] non-fatal:", err instanceof Error ? err.message : err);
    });
}

/** Convenience: build with server-controlled timestamps, then emit. Never throws. */
export function emitBusinessEventFrom(input: BuildBusinessEventInput): void {
  try {
    emitBusinessEvent(buildBusinessEvent(input));
  } catch (err) {
    console.error("[emitBusinessEventFrom] non-fatal:", err instanceof Error ? err.message : err);
  }
}
