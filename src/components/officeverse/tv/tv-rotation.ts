/**
 * Officeverse — OFFICE TV rotation model (Phase 10 Stage 3). PURE.
 *
 * The Office TV runs a deterministic loop of information SCREENS. Announcements
 * and celebrations are NOT screens — they are INTERRUPTS handled by
 * `office-tv.tsx`; while one is on screen the rotation is paused and it resumes
 * afterwards from where it left off.
 *
 * No React, no DOM, no timers, no network. `useTvRotation` is the thin hook that
 * owns exactly ONE interval and drives this reducer.
 */

/** Screen kinds the rotation can show. HERO / LEADERBOARD / RECENT_ACHIEVEMENT
 *  were wired in Stage 3; DAILY_PRODUCTION is the ONE Stage-5 addition. The
 *  remainder are reserved slots (a screen only ever renders when its data
 *  exists, so a reserved-but-unconfigured slot is simply never shown). */
export const TV_SCREEN_KINDS = [
  "HERO",
  "DAILY_PRODUCTION",
  "LEADERBOARD",
  "TEAM_PHOTO",
  "POWER_HOUR",
  "RECENT_ACHIEVEMENT",
  "TEAM_MILESTONE",
  "TOP_PERFORMER",
  "CUSTOM_ANNOUNCEMENT",
] as const;
export type TvScreenKind = (typeof TV_SCREEN_KINDS)[number];

export interface TvScreen {
  kind: TvScreenKind;
}

const WINDOW_LABEL: Readonly<Record<string, string>> = {
  daily: "TODAY'S",
  weekly: "THIS WEEK'S",
  monthly: "THIS MONTH'S",
  alltime: "ALL-TIME",
};
/** the Phase-8 leaderboard window (daily|weekly|monthly|alltime) → screen heading */
export function windowLabel(w: string): string {
  return WINDOW_LABEL[w] ?? "TODAY'S";
}

export interface RotationAvailability {
  /** at least one agent has any production today (leads / accepted / sales) */
  hasDailyProduction: boolean;
  /** the authoritative Phase-8 leaderboard has at least one row */
  hasLeaderboard: boolean;
  /** a team photo is configured (reserved — no configuration surface exists) */
  hasTeamPhoto: boolean;
  /** a Power Hour is currently active */
  hasPowerHour: boolean;
  /** the enriched recent-recognition feed has at least one item */
  hasAchievement: boolean;
}

/**
 * Build the ordered rotation for the current data. HERO is always present (the
 * "Officeverse Live / Announcement" idle screen). A screen whose data is empty
 * is SKIPPED — never shown blank, never shown with stale sample data.
 *
 * Fixed, deterministic order (Stage 5 target):
 *   HERO → DAILY_PRODUCTION → LEADERBOARD → TEAM_PHOTO → POWER_HOUR → RECENT_ACHIEVEMENT → repeat
 */
export function buildRotationScreens(a: RotationAvailability): TvScreen[] {
  const screens: TvScreen[] = [{ kind: "HERO" }];
  if (a.hasDailyProduction) screens.push({ kind: "DAILY_PRODUCTION" });
  if (a.hasLeaderboard) screens.push({ kind: "LEADERBOARD" });
  if (a.hasTeamPhoto) screens.push({ kind: "TEAM_PHOTO" });
  if (a.hasPowerHour) screens.push({ kind: "POWER_HOUR" });
  if (a.hasAchievement) screens.push({ kind: "RECENT_ACHIEVEMENT" });
  return screens;
}

/** Stable identity of a screen SET — the rotation only resets when this changes
 *  (i.e. a screen appeared / disappeared), never on every 2.5 s poll. */
export function screenSignature(screens: TvScreen[]): string {
  return screens.map((s) => s.kind).join("|");
}

export function clampIndex(index: number, len: number): number {
  if (len <= 0) return 0;
  const i = Math.trunc(index);
  return ((i % len) + len) % len;
}

export function nextIndex(index: number, len: number): number {
  return clampIndex(index + 1, len);
}

/* ----------------------------- the reducer --------------------------- */

export interface RotationState {
  /** index into the current screen list */
  index: number;
  /** ms accumulated on the current screen */
  elapsedMs: number;
}

export interface RotationTickInput {
  /** ms since the previous tick */
  dtMs: number;
  /** configured dwell time per screen (ms) */
  rotationMs: number;
  /** an interrupt (celebration / urgent announcement) is on screen */
  paused: boolean;
  /** number of screens currently in the rotation */
  len: number;
}

export const INITIAL_ROTATION: RotationState = { index: 0, elapsedMs: 0 };

/**
 * Advance the rotation by one tick. Deterministic and total:
 *   - `paused` → time does not accumulate; the current screen is held
 *   - `elapsedMs` reaches `rotationMs` → advance to the next screen, reset timer
 *   - `len` shrank below `index` → clamp back into range without a hard reset
 *   - `len === 0` → hold at index 0
 */
export function rotationTick(state: RotationState, input: RotationTickInput): RotationState {
  const len = Math.max(0, Math.trunc(input.len));
  if (len === 0) return { index: 0, elapsedMs: 0 };

  const index = clampIndex(state.index, len);
  if (input.paused) {
    return index === state.index ? state : { ...state, index };
  }

  const dwell = Math.max(1000, Math.trunc(input.rotationMs) || 12_000);
  const elapsed = Math.max(0, state.elapsedMs) + Math.max(0, input.dtMs);
  if (elapsed < dwell) {
    return { index, elapsedMs: elapsed };
  }
  return { index: nextIndex(index, len), elapsedMs: 0 };
}

/** Reconcile the rotation when the screen SET changes between polls. A changed
 *  signature restarts the loop from the first screen; an unchanged signature is
 *  left exactly as-is so a poll never abruptly restarts the rotation. */
export function reconcileRotation(
  state: RotationState,
  prevSignature: string,
  nextSignature: string,
  len: number,
): RotationState {
  if (prevSignature !== nextSignature) return { index: 0, elapsedMs: 0 };
  return { ...state, index: clampIndex(state.index, len) };
}
