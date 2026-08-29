/**
 * Officeverse — server-derived agent presence (Phase 9A). PURE. No DB.
 *
 * Presence is computed ENTIRELY from the authenticated session record set — the
 * browser never sends an "online" flag. Three deterministic states:
 *
 *   ONLINE   a valid (non-revoked, non-expired) session AND the most recent
 *            activity (session.last_seen_at) is within ONLINE_WITHIN_MS.
 *   IDLE     a valid session exists, but the most recent activity is older than
 *            ONLINE_WITHIN_MS (up to session expiry).
 *   OFFLINE  no valid session — all revoked/expired, or the user is inactive.
 *
 * "logged in" (a valid session) is NOT the same as "actively working" (ONLINE):
 * the caller is given both the state AND the last-active timestamp.
 */
import { istWallClockToEpochMs } from "../time";

/** recent authenticated activity within this window → ONLINE */
export const ONLINE_WITHIN_MS = 5 * 60_000;

export type PresenceState = "ONLINE" | "IDLE" | "OFFLINE";

export interface SessionSnapshot {
  /** IST wall-clock "YYYY-MM-DD HH:MM:SS" */
  createdAt: string;
  lastSeenAt: string;
}

export interface PresenceInput {
  /** users.status === "active" */
  userActive: boolean;
  /** ONLY non-revoked, non-expired sessions for this user */
  validSessions: SessionSnapshot[];
  /** most recent last_seen_at across ALL sessions incl. expired/revoked (for the "last seen" display) */
  lastSeenEver?: string | null;
}

export interface PresenceResult {
  status: PresenceState;
  /** earliest still-valid login, or null when OFFLINE */
  loginAt: string | null;
  /** most recent activity we can show — valid sessions when online/idle, else lastSeenEver */
  lastActiveAt: string | null;
  /** number of currently valid sessions (devices/tabs) */
  sessionCount: number;
}

const ms = (wall: string): number => istWallClockToEpochMs(wall);

export function derivePresence(input: PresenceInput, nowWall: string): PresenceResult {
  const now = ms(nowWall);
  const valid = input.userActive ? input.validSessions : [];

  if (valid.length === 0) {
    return {
      status: "OFFLINE",
      loginAt: null,
      lastActiveAt: input.lastSeenEver ?? null,
      sessionCount: 0,
    };
  }

  const loginAt = valid.reduce(
    (min, s) => (ms(s.createdAt) < ms(min) ? s.createdAt : min),
    valid[0]!.createdAt,
  );
  const lastActiveAt = valid.reduce(
    (max, s) => (ms(s.lastSeenAt) > ms(max) ? s.lastSeenAt : max),
    valid[0]!.lastSeenAt,
  );

  const status: PresenceState = now - ms(lastActiveAt) <= ONLINE_WITHIN_MS ? "ONLINE" : "IDLE";
  return { status, loginAt, lastActiveAt, sessionCount: valid.length };
}
