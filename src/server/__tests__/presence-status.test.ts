import { describe, expect, it } from "vitest";
import { ONLINE_WITHIN_MS, derivePresence, type SessionSnapshot } from "../presence/status";
import { epochMsToIstWallClock, istWallClockToEpochMs } from "../time";

const NOW = "2026-08-29 14:30:00";
const NOW_MS = istWallClockToEpochMs(NOW);

/** an IST wall-clock string exactly `min` minutes before NOW */
const minutesAgo = (min: number): string => epochMsToIstWallClock(NOW_MS - min * 60_000);
const secondsAgo = (sec: number): string => epochMsToIstWallClock(NOW_MS - sec * 1_000);

const sess = (createdMinAgo: number, seenMinAgo: number): SessionSnapshot => ({
  createdAt: minutesAgo(createdMinAgo),
  lastSeenAt: minutesAgo(seenMinAgo),
});

describe("derivePresence", () => {
  it("no valid session → OFFLINE, loginAt null, lastActiveAt = lastSeenEver", () => {
    const r = derivePresence(
      { userActive: true, validSessions: [], lastSeenEver: minutesAgo(120) },
      NOW,
    );
    expect(r).toMatchObject({ status: "OFFLINE", loginAt: null, sessionCount: 0 });
    expect(r.lastActiveAt).toBe(minutesAgo(120));
  });

  it("inactive user → OFFLINE even with a live session", () => {
    const r = derivePresence({ userActive: false, validSessions: [sess(300, 1)] }, NOW);
    expect(r.status).toBe("OFFLINE");
    expect(r.sessionCount).toBe(0);
  });

  it("valid session, activity 2 min ago → ONLINE", () => {
    const r = derivePresence({ userActive: true, validSessions: [sess(330, 2)] }, NOW);
    expect(r).toMatchObject({ status: "ONLINE", sessionCount: 1 });
    expect(r.loginAt).toBe(minutesAgo(330));
    expect(r.lastActiveAt).toBe(minutesAgo(2));
  });

  it("valid session, activity 10 min ago → IDLE (logged in ≠ working)", () => {
    const r = derivePresence({ userActive: true, validSessions: [sess(330, 10)] }, NOW);
    expect(r.status).toBe("IDLE");
  });

  it("exactly at the ONLINE threshold → ONLINE; one minute past → IDLE", () => {
    const atEdge = secondsAgo(ONLINE_WITHIN_MS / 1000);
    expect(
      derivePresence(
        { userActive: true, validSessions: [{ createdAt: atEdge, lastSeenAt: atEdge }] },
        NOW,
      ).status,
    ).toBe("ONLINE");
    const past = minutesAgo(ONLINE_WITHIN_MS / 60_000 + 1);
    expect(
      derivePresence(
        { userActive: true, validSessions: [{ createdAt: past, lastSeenAt: past }] },
        NOW,
      ).status,
    ).toBe("IDLE");
  });

  it("multi-session: earliest login + latest activity, count = valid sessions", () => {
    const r = derivePresence(
      { userActive: true, validSessions: [sess(400, 40), sess(120, 1)] },
      NOW,
    );
    expect(r).toMatchObject({ status: "ONLINE", sessionCount: 2 });
    expect(r.loginAt).toBe(minutesAgo(400));
    expect(r.lastActiveAt).toBe(minutesAgo(1));
  });

  it("every session already filtered out (all expired/revoked) → OFFLINE", () => {
    const r = derivePresence(
      { userActive: true, validSessions: [], lastSeenEver: minutesAgo(90) },
      NOW,
    );
    expect(r.status).toBe("OFFLINE");
  });
});
