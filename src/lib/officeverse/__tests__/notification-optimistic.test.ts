import { describe, expect, it } from "vitest";
import {
  decrementUnread,
  markAllReadInResult,
  markOneReadInResult,
  type NotificationListResult,
} from "../notification-optimistic";

function make(): NotificationListResult {
  return {
    notifications: [
      {
        id: 1,
        type: "lead.assigned",
        title: "Lead assigned",
        message: "TMI_00012007 assigned to you",
        related_entity_type: "lead",
        related_entity_code: "TMI_00012007",
        unread: true,
        read_at: null,
        created_at: "2026-08-29T10:05:00+05:30",
      },
      {
        id: 2,
        type: "followup.rescheduled",
        title: "Follow-up rescheduled",
        message: "FU_00004415 moved",
        related_entity_type: "follow_up",
        related_entity_code: "FU_00004415",
        unread: false,
        read_at: "2026-08-29T09:00:00+05:30",
        created_at: "2026-08-29T08:00:00+05:30",
      },
      {
        id: 3,
        type: "followup.completed",
        title: "Follow-up completed",
        message: "FU_00004410 done",
        related_entity_type: "follow_up",
        related_entity_code: "FU_00004410",
        unread: true,
        read_at: null,
        created_at: "2026-08-29T07:00:00+05:30",
      },
    ],
    page: 1,
    pageSize: 20,
    total: 3,
    totalPages: 1,
    unread: 2,
  };
}

const ISO = "2026-08-29T10:10:00+05:30";

describe("markOneReadInResult", () => {
  it("marks the target read, decrements unread, and does NOT mutate the input", () => {
    const before = make();
    const after = markOneReadInResult(before, 1, ISO);

    expect(after).not.toBe(before);
    expect(before.notifications[0]!.unread).toBe(true); // input untouched → safe rollback
    expect(before.unread).toBe(2);

    expect(after.notifications[0]).toMatchObject({ id: 1, unread: false, read_at: ISO });
    expect(after.unread).toBe(1);
    // other rows unchanged
    expect(after.notifications[2]!.unread).toBe(true);
  });

  it("is a no-op (same reference) when the id is already read", () => {
    const before = make();
    expect(markOneReadInResult(before, 2, ISO)).toBe(before);
  });

  it("is a no-op when the id is not on this page", () => {
    const before = make();
    expect(markOneReadInResult(before, 999, ISO)).toBe(before);
  });

  it("never drives the unread count below zero", () => {
    let r = make();
    r = markOneReadInResult(r, 1, ISO);
    r = markOneReadInResult(r, 3, ISO);
    r = markOneReadInResult(r, 3, ISO); // repeat
    expect(r.unread).toBe(0);
  });
});

describe("markAllReadInResult", () => {
  it("marks every row read and zeroes the counter without mutating the input", () => {
    const before = make();
    const after = markAllReadInResult(before, ISO);

    expect(before.notifications.some((n) => n.unread)).toBe(true); // input untouched
    expect(after.notifications.every((n) => !n.unread)).toBe(true);
    expect(after.unread).toBe(0);
    // already-read row keeps its original read_at
    expect(after.notifications[1]!.read_at).toBe("2026-08-29T09:00:00+05:30");
  });
});

describe("decrementUnread", () => {
  it("floors at zero", () => {
    expect(decrementUnread(3)).toBe(2);
    expect(decrementUnread(3, 2)).toBe(1);
    expect(decrementUnread(0)).toBe(0);
    expect(decrementUnread(1, 5)).toBe(0);
  });
});

describe("failed mark-read → UI restores the true state", () => {
  it("the pre-mutation snapshot still shows the notification unread", () => {
    const snapshot = make();
    const optimistic = markOneReadInResult(snapshot, 1, ISO);
    expect(optimistic.notifications[0]!.unread).toBe(false);

    // server rejected → the hook re-applies `snapshot`
    const restored = snapshot;
    expect(restored.notifications[0]!.unread).toBe(true);
    expect(restored.unread).toBe(2);
  });
});
