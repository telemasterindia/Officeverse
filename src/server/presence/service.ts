/**
 * Officeverse — agent presence service (Phase 9A).
 *
 * Admin-only. Presence is derived from DB `sessions` (created_at / last_seen_at
 * / expires_at / revoked_at) + `users.status` — NO browser input, NO stored
 * "online" flag, NO session tokens / cookies / IPs in the result.
 *
 * `last_seen_at` is the EXISTING throttled session heartbeat (bumped ~once per
 * 5 min by `resolveSession` on any authenticated request); this phase reuses it
 * rather than adding a second activity tracker.
 */
import { eq, inArray } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { agents, sessions, users } from "@/lib/db/schema";
import { SHIFTS } from "@/lib/officeverse/shift";
import type { ProcessCode } from "@/lib/officeverse/types";
import { istWallClockToEpochMs, nowIST } from "../time";
import { derivePresence, type PresenceResult, type PresenceState } from "./status";

export interface AgentPresenceRow {
  agentCode: string;
  name: string;
  process: ProcessCode;
  shiftName: string;
  shiftWindow: string;
  status: PresenceState;
  loginAt: string | null;
  lastActiveAt: string | null;
  sessionCount: number;
  accountStatus: string;
}

interface SessionRow {
  userId: number;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

function shiftWindowLabel(p: ProcessCode): string {
  const s = SHIFTS[p];
  return `${s.start}–${s.end} IST`;
}

export interface AgentPresenceResult {
  now: string;
  onlineWithinMinutes: number;
  agents: AgentPresenceRow[];
  /** true when no database is configured (local dev without MySQL) */
  dbUnavailable?: boolean;
}

export async function listAgentPresence(): Promise<AgentPresenceResult> {
  const now = nowIST();
  if (!isDbConfigured()) {
    return { now, onlineWithinMinutes: 5, agents: [], dbUnavailable: true };
  }
  const db = getDb();
  const nowMs = istWallClockToEpochMs(now);

  const agentRows = await db
    .select({
      userId: users.id,
      agentCode: agents.agentCode,
      name: users.fullName,
      process: users.process,
      accountStatus: users.status,
    })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .where(eq(users.role, "agent"));

  if (agentRows.length === 0) {
    return { now, onlineWithinMinutes: 5, agents: [] };
  }

  const userIds = agentRows.map((a) => a.userId);
  const sessionRows: SessionRow[] = await db
    .select({
      userId: sessions.userId,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .where(inArray(sessions.userId, userIds));

  const byUser = new Map<number, SessionRow[]>();
  for (const s of sessionRows) {
    const list = byUser.get(s.userId);
    if (list) list.push(s);
    else byUser.set(s.userId, [s]);
  }

  const rows: AgentPresenceRow[] = agentRows.map((a) => {
    const all = byUser.get(a.userId) ?? [];
    const valid = all.filter(
      (s) => s.revokedAt == null && istWallClockToEpochMs(s.expiresAt) > nowMs,
    );
    const lastSeenEver =
      all.length > 0
        ? all.reduce(
            (mx, s) =>
              istWallClockToEpochMs(s.lastSeenAt) > istWallClockToEpochMs(mx) ? s.lastSeenAt : mx,
            all[0]!.lastSeenAt,
          )
        : null;

    const presence: PresenceResult = derivePresence(
      {
        userActive: a.accountStatus === "active",
        validSessions: valid.map((s) => ({ createdAt: s.createdAt, lastSeenAt: s.lastSeenAt })),
        lastSeenEver,
      },
      now,
    );

    return {
      agentCode: a.agentCode,
      name: a.name,
      process: a.process,
      shiftName: SHIFTS[a.process].name,
      shiftWindow: shiftWindowLabel(a.process),
      status: presence.status,
      loginAt: presence.loginAt,
      lastActiveAt: presence.lastActiveAt,
      sessionCount: presence.sessionCount,
      accountStatus: a.accountStatus,
    };
  });

  rows.sort((x, y) => {
    const order = { ONLINE: 0, IDLE: 1, OFFLINE: 2 } as const;
    return order[x.status] - order[y.status] || x.name.localeCompare(y.name);
  });

  return { now, onlineWithinMinutes: 5, agents: rows };
}
