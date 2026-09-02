/**
 * Officeverse — BUSINESS EVENT DISPATCHER (Phase 2 · recognition wired Phase 5).
 * Infrastructure only. Imports NOTHING from `live/*` — the recognition sink is
 * registered from outside, or lazy-loaded once via a dynamic import.
 *
 *   BusinessEvent
 *     → scoring.ingest(event)                          [always]
 *     → legacy points fallback                         [only when scoring did
 *                                                        NOT take the points]
 *     → recognitionSink(event, decision, status)       [always, best-effort]
 *
 * Every fan-out is BEST-EFFORT and independently wrapped: a failure in one never
 * affects the other and never propagates to the CRM caller.
 *
 *   Scoring       → "how many points?"          (awardScored → ledger)
 *   Recognition   → "should this be celebrated?" (recognition event only — no points)
 *
 * The three responsibilities stay separate: recognition never scores, scoring
 * never recognises, and the legacy-points bridge lives in this lane only.
 */
import { ingest, type ScoringDecision } from "../scoring/ingest";
import { runLegacyPointsFallback, scoringOwnsPoints } from "./legacy-points";
import { normalizeBusinessEvent, type BusinessEvent } from "./business-event";

export type RecognitionSink = (
  event: BusinessEvent,
  scoring: ScoringDecision | null,
  ingestStatus: string,
) => void | Promise<void>;

let recognitionSink: RecognitionSink | null = null;
/** an explicit register call (even with null) opts out of the lazy default */
let sinkExplicitlySet = false;

/** Register (or clear, with null) the recognition fan-out. Any explicit call
 *  disables the lazy default. Called by the recognition bridge on load and by
 *  tests with a mock. */
export function registerRecognitionSink(sink: RecognitionSink | null): void {
  recognitionSink = sink;
  sinkExplicitlySet = true;
}

/** test helper — restore the untouched state so the lazy default can re-arm */
export function __resetRecognitionSink(): void {
  recognitionSink = null;
  sinkExplicitlySet = false;
}

function nonFatal(where: string, err: unknown): void {
  console.error(`[business-event:${where}] non-fatal:`, err instanceof Error ? err.message : err);
}

/** Load the real recognition bridge once and adopt it as the default sink,
 *  unless a sink was already set explicitly. Reads the module's export directly
 *  (rather than relying on its self-registration side effect) so a cached
 *  re-import still re-arms it after a test reset. Never throws. */
async function ensureRecognitionSink(): Promise<void> {
  if (sinkExplicitlySet || recognitionSink) return;
  try {
    // dynamic — keeps this infra file free of any static live-tree import
    const mod = (await import("./recognition-bridge")) as { recognitionBridge?: RecognitionSink };
    if (!recognitionSink && !sinkExplicitlySet && typeof mod.recognitionBridge === "function") {
      recognitionSink = mod.recognitionBridge;
    }
  } catch (err) {
    nonFatal("recognition-bridge-load", err);
  }
}

/**
 * Fan one confirmed BusinessEvent to the intelligence layers. Never throws.
 * The event is re-normalised here so an unknown type / stray payload key is
 * handled safely even if a caller skipped the builder.
 */
export async function dispatchBusinessEvent(event: BusinessEvent): Promise<void> {
  const norm = normalizeBusinessEvent(event);
  if (!norm.ok) {
    nonFatal("normalize", new Error(norm.reason));
    return;
  }
  const clean = norm.event;

  // ---- scoring consumer ----
  let decision: ScoringDecision | null = null;
  let status = "error";
  try {
    const outcome = await ingest(clean);
    decision = outcome.decision ?? null;
    status = outcome.status;
  } catch (err) {
    nonFatal("scoring", err);
  }

  // ---- legacy points bridge (mutually exclusive with awardScored) ----
  // Runs only when the Scoring Engine did NOT take ownership of this event's
  // points (flag off / event not scoring-enabled / no open-ended rule). When
  // scoring DID award, this is skipped — so a single event never double-awards.
  if (!scoringOwnsPoints(status)) {
    try {
      await runLegacyPointsFallback(clean);
    } catch (err) {
      nonFatal("legacy-points", err);
    }
  }

  // ---- recognition consumer (celebration decision only — never points) ----
  await ensureRecognitionSink();
  if (recognitionSink) {
    try {
      await recognitionSink(clean, decision, status);
    } catch (err) {
      nonFatal("recognition", err);
    }
  }
}
