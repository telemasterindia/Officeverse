/**
 * Officeverse — gamification LEADERBOARD foundation (Phase 20). PURE.
 *
 * Ranking is by gamification POINTS total (never raw lead count). The row shape
 * carries extra fields (acceptedLeads, sales, streak…) so a future
 * quality-aware or process-specific formula can be added without a schema
 * change — but no unapproved formula is implemented here.
 *
 * TIME WINDOWS use SERVER-authoritative OPERATIONAL dates (the shift date from
 * src/server/time.ts), passed in as "YYYY-MM-DD" — never the browser clock.
 *
 * TIE-BREAK (documented + tested): equal points → lower userId ranks first
 * (a stable, authoritative identifier; never random).
 */

export const LEADERBOARD_KINDS = ["daily", "weekly", "monthly", "alltime"] as const;
export type LeaderboardKind = (typeof LEADERBOARD_KINDS)[number];

export type LeaderboardScope = "global" | "process" | "team";

/* --------------------------- time windows ---------------------- */

function ymdToUTC(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}
function utcToYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDays(ymd: string, delta: number): string {
  return utcToYmd(ymdToUTC(ymd) + delta * 86_400_000);
}
/** 0=Sun … 6=Sat for a "YYYY-MM-DD" (UTC-safe). */
export function dayOfWeek(ymd: string): number {
  return new Date(ymdToUTC(ymd)).getUTCDay();
}

/** Monday of the ISO week that contains `ymd`. */
export function startOfIsoWeek(ymd: string): string {
  const back = (dayOfWeek(ymd) + 6) % 7; // Mon→0 … Sun→6
  return addDays(ymd, -back);
}

export interface WindowBounds {
  /** inclusive first operational date, or null for all-time */
  from: string | null;
  /** inclusive last operational date, or null for all-time */
  to: string | null;
}

/**
 * The operational-date window for a leaderboard kind, anchored on
 * `operationalDate` (server-derived "YYYY-MM-DD").
 *   daily   → [d, d]
 *   weekly  → [Monday, Sunday] of d's ISO week
 *   monthly → [YYYY-MM-01, last day of month]
 *   alltime → [null, null]
 */
export function windowBounds(kind: LeaderboardKind, operationalDate: string): WindowBounds {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(operationalDate)) {
    throw new Error("operationalDate must be YYYY-MM-DD");
  }
  if (kind === "alltime") return { from: null, to: null };
  if (kind === "daily") return { from: operationalDate, to: operationalDate };
  if (kind === "weekly") {
    const mon = startOfIsoWeek(operationalDate);
    return { from: mon, to: addDays(mon, 6) };
  }
  // monthly
  const [y, m] = operationalDate.split("-").map(Number);
  const first = `${operationalDate.slice(0, 7)}-01`;
  const last = utcToYmd(Date.UTC(y!, m!, 0)); // day 0 of next month
  return { from: first, to: last };
}

/* --------------------------- ranking -------------------------- */

export interface LeaderboardInputRow {
  userId: number;
  name: string;
  role: "agent" | "closer";
  process: string;
  points: number;
  /** optional supporting metrics — carried through, NOT used for ranking */
  acceptedLeads?: number;
  sales?: number;
  streak?: number;
  bestStreak?: number;
  topBadge?: string | null;
  photoAvailable?: boolean;
}

export interface LeaderboardRow extends LeaderboardInputRow {
  rank: number;
}

/**
 * Standard competition ranking (1,2,2,4) by points desc, deterministic
 * tie-break by userId asc. Input order is irrelevant → output is stable.
 */
export function rankLeaderboard(rows: LeaderboardInputRow[]): LeaderboardRow[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points || a.userId - b.userId);
  let lastPoints: number | null = null;
  let lastRank = 0;
  return sorted.map((r, i) => {
    const rank = lastPoints !== null && r.points === lastPoints ? lastRank : i + 1;
    lastPoints = r.points;
    lastRank = rank;
    return { ...r, rank };
  });
}

/** The rank of one user within an already-ranked list (or null). */
export function rankOf(rows: LeaderboardRow[], userId: number): number | null {
  return rows.find((r) => r.userId === userId)?.rank ?? null;
}
