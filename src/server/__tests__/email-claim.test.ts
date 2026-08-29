import { describe, expect, it } from "vitest";
import {
  backoffMinutes,
  claimState,
  computeStaleBefore,
  isStaleLock,
  nextRetryPlan,
} from "../email/claim-logic";
import { istWallClockToEpochMs } from "../time";

const NOW = "2026-08-29 12:00:00";

describe("computeStaleBefore", () => {
  it("subtracts the lease minutes from now", () => {
    expect(computeStaleBefore(NOW, 10)).toBe("2026-08-29 11:50:00");
    expect(computeStaleBefore(NOW, 30)).toBe("2026-08-29 11:30:00");
  });
});

describe("isStaleLock", () => {
  const staleBefore = "2026-08-29 11:50:00";
  it("a missing lock is stale (recoverable)", () => {
    expect(isStaleLock(null, staleBefore)).toBe(true);
  });
  it("a lock older than the lease boundary is stale", () => {
    expect(isStaleLock("2026-08-29 11:40:00", staleBefore)).toBe(true);
  });
  it("a fresh lock is NOT stale", () => {
    expect(isStaleLock("2026-08-29 11:55:00", staleBefore)).toBe(false);
  });
});

describe("claimState", () => {
  const staleBefore = computeStaleBefore(NOW, 10);

  it("queued + back-off elapsed → claimable", () => {
    expect(
      claimState(
        { status: "queued", nextAttemptAt: "2026-08-29 11:00:00", lockedAt: null },
        NOW,
        staleBefore,
      ),
    ).toBe("claimable");
  });

  it("queued + not yet due → not_due", () => {
    expect(
      claimState(
        { status: "queued", nextAttemptAt: "2026-08-29 12:30:00", lockedAt: null },
        NOW,
        staleBefore,
      ),
    ).toBe("not_due");
  });

  it("processing + FRESH lock → locked (a second worker cannot claim it)", () => {
    expect(
      claimState(
        {
          status: "processing",
          nextAttemptAt: "2026-08-29 11:00:00",
          lockedAt: "2026-08-29 11:58:00",
        },
        NOW,
        staleBefore,
      ),
    ).toBe("locked");
  });

  it("processing + STALE lock → claimable (crash recovery)", () => {
    expect(
      claimState(
        {
          status: "processing",
          nextAttemptAt: "2026-08-29 11:00:00",
          lockedAt: "2026-08-29 11:30:00",
        },
        NOW,
        staleBefore,
      ),
    ).toBe("claimable");
  });

  it("sent / failed → done (never re-claimed)", () => {
    expect(
      claimState({ status: "sent", nextAttemptAt: NOW, lockedAt: null }, NOW, staleBefore),
    ).toBe("done");
    expect(
      claimState({ status: "failed", nextAttemptAt: NOW, lockedAt: null }, NOW, staleBefore),
    ).toBe("done");
  });
});

describe("backoffMinutes — exponential, capped at 60", () => {
  it("grows with the attempt count", () => {
    expect(backoffMinutes(0)).toBe(1);
    expect(backoffMinutes(1)).toBe(2);
    expect(backoffMinutes(3)).toBe(8);
    expect(backoffMinutes(6)).toBe(60);
    expect(backoffMinutes(20)).toBe(60);
  });
});

describe("nextRetryPlan — retry vs give up (retryCount = attempts consumed)", () => {
  it("attempts remaining → back to 'queued' with a FUTURE next_attempt_at", () => {
    const p = nextRetryPlan(2, 5, NOW);
    expect(p.status).toBe("queued");
    expect(p.giveUp).toBe(false);
    expect(istWallClockToEpochMs(p.nextAttemptAt)).toBeGreaterThan(istWallClockToEpochMs(NOW));
  });

  it("last attempt still retries (4 of 5 consumed)", () => {
    expect(nextRetryPlan(4, 5, NOW).status).toBe("queued");
  });

  it("attempts exhausted → terminal 'failed', giveUp = true", () => {
    expect(nextRetryPlan(5, 5, NOW)).toMatchObject({ status: "failed", giveUp: true });
    expect(nextRetryPlan(6, 5, NOW).status).toBe("failed");
  });

  it("an explicit back-off override is honoured", () => {
    const p = nextRetryPlan(1, 5, NOW, 15);
    expect(p.nextAttemptAt).toBe("2026-08-29 12:15:00");
  });
});
