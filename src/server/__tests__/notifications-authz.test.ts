import { describe, expect, it } from "vitest";
import {
  assertCanReadNotification,
  canMarkNotificationRead,
  canReadNotification,
  notificationListScope,
  type NotificationActor,
} from "../authz/notifications";
import { HttpError } from "../http-error";

const admin: NotificationActor = { user: { id: 1, role: "admin" } };
const hr: NotificationActor = { user: { id: 2, role: "hr" } };
const agent: NotificationActor = { user: { id: 10, role: "agent" } };
const closer: NotificationActor = { user: { id: 20, role: "closer" } };

const mine = (id: number) => ({ recipientUserId: id });

describe("canReadNotification — recipient only, no role override", () => {
  it("the recipient can read their own notification", () => {
    expect(canReadNotification(agent, mine(10))).toBe(true);
    expect(canReadNotification(closer, mine(20))).toBe(true);
    expect(canReadNotification(admin, mine(1))).toBe(true);
  });

  it("an agent CANNOT read another user's notification", () => {
    expect(canReadNotification(agent, mine(11))).toBe(false);
    expect(canReadNotification(agent, mine(20))).toBe(false);
  });

  it("a closer CANNOT read another user's notification", () => {
    expect(canReadNotification(closer, mine(10))).toBe(false);
  });

  it("an admin does NOT get a cross-user override — only their own feed", () => {
    expect(canReadNotification(admin, mine(10))).toBe(false);
    expect(canReadNotification(hr, mine(10))).toBe(false);
  });

  it("mark-read follows the same rule", () => {
    expect(canMarkNotificationRead).toBe(canReadNotification);
    expect(canMarkNotificationRead(agent, mine(99))).toBe(false);
  });
});

describe("notificationListScope — always the caller's own id, never 'all'", () => {
  it("every role is scoped to its own user id", () => {
    expect(notificationListScope(admin)).toEqual({ recipientUserId: 1 });
    expect(notificationListScope(hr)).toEqual({ recipientUserId: 2 });
    expect(notificationListScope(agent)).toEqual({ recipientUserId: 10 });
    expect(notificationListScope(closer)).toEqual({ recipientUserId: 20 });
  });
});

describe("assertCanReadNotification", () => {
  it("no throw for the recipient", () => {
    expect(() => assertCanReadNotification(agent, mine(10))).not.toThrow();
  });
  it("throws HttpError(403) for anyone else, admin included", () => {
    for (const actor of [otherAgent(), admin]) {
      try {
        assertCanReadNotification(actor, mine(10));
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).status).toBe(403);
      }
    }
  });
});

function otherAgent(): NotificationActor {
  return { user: { id: 11, role: "agent" } };
}
