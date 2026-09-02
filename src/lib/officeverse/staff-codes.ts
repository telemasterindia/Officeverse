/**
 * Officeverse — canonical business Employee ID formats. PURE (no imports), so
 * the server generator, the zod validators and the client can all share one
 * definition and never drift.
 *
 * CANONICAL (all NEW codes are minted in this form):
 *   Agent   → TMI_CC_###   (e.g. TMI_CC_001)
 *   Closer  → TMI_CL_###   (e.g. TMI_CL_001)
 *
 * LEGACY forms are still ACCEPTED on input (a code pasted from an old export,
 * document or bookmark must still resolve) but are never generated:
 *   Agent   → TMI_CC###  |  AG-#####
 *   Closer  → CL-#####
 */

/** The one true format for a freshly generated code. */
export const AGENT_CODE_CANONICAL_RE = /^TMI_CC_\d{3,}$/;
export const CLOSER_CODE_CANONICAL_RE = /^TMI_CL_\d{3,}$/;

/** Tolerant matchers — canonical OR any legacy form (for lookups / validation). */
export const AGENT_CODE_RE = /^(TMI_CC_\d{3,}|TMI_CC\d{3,}|AG-\d{5})$/;
export const CLOSER_CODE_RE = /^(TMI_CL_\d{3,}|CL-\d{5})$/;

export const isAgentCode = (s: string): boolean => AGENT_CODE_RE.test(s.trim());
export const isCloserCode = (s: string): boolean => CLOSER_CODE_RE.test(s.trim());

/** True once a code is already in the canonical (post-migration) shape. */
export const isCanonicalAgentCode = (s: string): boolean => AGENT_CODE_CANONICAL_RE.test(s.trim());
export const isCanonicalCloserCode = (s: string): boolean =>
  CLOSER_CODE_CANONICAL_RE.test(s.trim());
