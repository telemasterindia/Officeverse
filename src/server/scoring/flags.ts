/**
 * Officeverse — Scoring Engine feature flag (Phase 2).
 *
 * The engine ships OFF. When OFF, `ingest()` short-circuits before it evaluates
 * a single rule or writes a single row, so existing gamification / leaderboard
 * behaviour is byte-for-byte unchanged. Nothing in the CRM emits a BusinessEvent
 * in Phase 2 anyway — this flag is the second, independent safety.
 *
 * Documented in `.env.example` as `SCORING_ENGINE_ENABLED=false`. It is NOT a
 * mandatory variable: an unset value reads as OFF.
 */
export const SCORING_ENGINE_FLAG = "SCORING_ENGINE_ENABLED";

const TRUTHY = /^(1|true|yes|on|enabled)$/i;

/** True only when `SCORING_ENGINE_ENABLED` is explicitly set to a truthy token. */
export function isScoringEngineEnabled(): boolean {
  return TRUTHY.test((process.env[SCORING_ENGINE_FLAG] ?? "").trim());
}
