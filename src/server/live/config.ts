/**
 * Officeverse — Live Experience: TV configuration defaults (Phase 21).
 *
 * The authoritative values live in one row of `office_tv_settings`. This module
 * holds the defaults + a safe merge so the TV always has a complete config even
 * before an Admin edits anything.
 */

export interface TvConfig {
  displayName: string;
  rotationSec: number;
  leaderboardWindow: "daily" | "weekly" | "monthly" | "alltime";
  celebrationIntensity: "low" | "normal" | "high";
  soundEnabled: boolean;
  thirdAcceptedThreshold: number;
  /** emit a TEAM_MILESTONE every N team accepted-leads/day; 0 = disabled */
  teamMilestoneEvery: number;
}

export const DEFAULT_TV_CONFIG: TvConfig = {
  displayName: "Officeverse Live",
  rotationSec: 12,
  leaderboardWindow: "daily",
  celebrationIntensity: "normal",
  soundEnabled: false, // MUTED / SAFE by default — sound is never required
  thirdAcceptedThreshold: 3, // CELEBRATION threshold only — not a money rule
  teamMilestoneEvery: 0, // parked until an Admin configures it
};

const WINDOWS = new Set(["daily", "weekly", "monthly", "alltime"]);
const INTENSITIES = new Set(["low", "normal", "high"]);

export function resolveTvConfig(
  row: Partial<Record<string, unknown>> | null | undefined,
): TvConfig {
  const r = row ?? {};
  const rotationSec = Number(r["rotationSec"]);
  const threshold = Number(r["thirdAcceptedThreshold"]);
  const teamEvery = Number(r["teamMilestoneEvery"]);
  const win = String(r["leaderboardWindow"] ?? "");
  const intensity = String(r["celebrationIntensity"] ?? "");
  return {
    displayName:
      typeof r["displayName"] === "string" && r["displayName"].trim()
        ? (r["displayName"] as string).slice(0, 80)
        : DEFAULT_TV_CONFIG.displayName,
    rotationSec:
      Number.isFinite(rotationSec) && rotationSec >= 4 && rotationSec <= 60
        ? Math.round(rotationSec)
        : DEFAULT_TV_CONFIG.rotationSec,
    leaderboardWindow: (WINDOWS.has(win)
      ? win
      : DEFAULT_TV_CONFIG.leaderboardWindow) as TvConfig["leaderboardWindow"],
    celebrationIntensity: (INTENSITIES.has(intensity)
      ? intensity
      : DEFAULT_TV_CONFIG.celebrationIntensity) as TvConfig["celebrationIntensity"],
    soundEnabled: r["soundEnabled"] === true || r["soundEnabled"] === 1,
    thirdAcceptedThreshold:
      Number.isInteger(threshold) && threshold >= 1 && threshold <= 100
        ? threshold
        : DEFAULT_TV_CONFIG.thirdAcceptedThreshold,
    teamMilestoneEvery:
      Number.isInteger(teamEvery) && teamEvery >= 0 && teamEvery <= 100_000
        ? teamEvery
        : DEFAULT_TV_CONFIG.teamMilestoneEvery,
  };
}
