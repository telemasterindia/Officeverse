/**
 * Officeverse — UAT / demo lead marker.  PURE constant.
 *
 * Agent-side UAT finding #9: fake / UAT / test leads must not appear in normal
 * Agent-facing (production-style) views. Seed-created demo leads carry this
 * exact string in `leads.lead_file`; agent & closer lead lists exclude them.
 * Admin / HR still see everything (so the demo rows can be reviewed / purged).
 */
export const DEMO_LEAD_MARKER = "UAT-SEED";
