import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  enqueueEmailSchema,
  listNotificationsSchema,
  markAllNotificationsReadSchema,
  markNotificationReadSchema,
} from "../validation/notifications";

describe("listNotificationsSchema", () => {
  it("applies defaults", () => {
    const v = listNotificationsSchema.parse({});
    expect(v).toEqual({ page: 1, pageSize: 20, unreadOnly: false });
  });

  it("caps pageSize at 100 and coerces strings", () => {
    expect(() => listNotificationsSchema.parse({ pageSize: 500 })).toThrow();
    expect(listNotificationsSchema.parse({ page: "3", pageSize: "50" })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
  });

  it("STRIPS any client-supplied recipient — a browser cannot choose whose feed", () => {
    const v = listNotificationsSchema.parse({
      recipientUserId: 999,
      recipient_id: 12,
      userId: 7,
    } as Record<string, unknown>);
    expect(v).not.toHaveProperty("recipientUserId");
    expect(v).not.toHaveProperty("recipient_id");
    expect(v).not.toHaveProperty("userId");
  });
});

describe("markNotificationReadSchema", () => {
  it("requires a positive integer id", () => {
    expect(markNotificationReadSchema.parse({ id: "42" })).toEqual({ id: 42 });
    expect(() => markNotificationReadSchema.parse({ id: 0 })).toThrow();
    expect(() => markNotificationReadSchema.parse({ id: -1 })).toThrow();
    expect(() => markNotificationReadSchema.parse({ id: "abc" })).toThrow();
    expect(() => markNotificationReadSchema.parse({})).toThrow();
  });

  it("has no recipient field", () => {
    const v = markNotificationReadSchema.parse({ id: 5, recipientUserId: 1 } as Record<
      string,
      unknown
    >);
    expect(v).toEqual({ id: 5 });
  });
});

describe("markAllNotificationsReadSchema is strict + empty", () => {
  it("accepts {} and rejects extras", () => {
    expect(markAllNotificationsReadSchema.parse({})).toEqual({});
    expect(() => markAllNotificationsReadSchema.parse({ recipientUserId: 1 })).toThrow();
  });
});

describe("enqueueEmailSchema (internal enqueue shape)", () => {
  const base = {
    template: "FOLLOW_UP_RESCHEDULED",
    toEmail: "Owner@Example.com",
    dedupeKey: "followup:FU_1:rescheduled:2026-09-01 10:00:00:email",
  };

  it("accepts a valid payload and normalises the email", () => {
    const v = enqueueEmailSchema.parse(base);
    expect(v.toEmail).toBe("owner@example.com");
    expect(v.template).toBe("FOLLOW_UP_RESCHEDULED");
  });

  it("requires a known template", () => {
    expect(() => enqueueEmailSchema.parse({ ...base, template: "NOT_A_TEMPLATE" })).toThrow();
  });

  it("requires a dedupe key", () => {
    const { dedupeKey: _omit, ...noKey } = base;
    void _omit;
    expect(() => enqueueEmailSchema.parse(noKey)).toThrow();
  });

  it("rejects a malformed recipient address", () => {
    expect(() => enqueueEmailSchema.parse({ ...base, toEmail: "not-an-email" })).toThrow();
  });
});

describe("email jobs have NO client-facing server function (internal creation only)", () => {
  const apiDir = join(__dirname, "..", "api");

  it("src/server/api contains no email* module", () => {
    const files = readdirSync(apiDir);
    expect(files.some((f) => /^email/i.test(f))).toBe(false);
  });

  it("the notifications API exposes only self-scoped read/mark functions — no enqueue", () => {
    const src = readFileSync(join(apiDir, "notifications.ts"), "utf8");
    const exportedFns = [...src.matchAll(/export const (\w+Fn)\b/g)].map((m) => m[1]).sort();
    expect(exportedFns).toEqual([
      "listNotificationsFn",
      "markAllNotificationsReadFn",
      "markNotificationReadFn",
      "unreadNotificationCountFn",
    ]);
    expect(src).not.toMatch(/enqueue|emailJob|email-jobs/i);
  });
});
