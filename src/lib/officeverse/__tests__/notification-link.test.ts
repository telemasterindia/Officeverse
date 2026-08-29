import { describe, expect, it } from "vitest";
import {
  isNotificationLinkable,
  notificationHref,
  type LinkableNotification,
} from "../notification-link";

const n = (
  related_entity_type: string | null,
  related_entity_code: string | null,
): LinkableNotification => ({ related_entity_type, related_entity_code });

describe("notificationHref — safe entity navigation", () => {
  it("a valid lead notification links to /leads/$leadId", () => {
    expect(notificationHref(n("lead", "TMI_00012007"))).toEqual({
      to: "/leads/$leadId",
      params: { leadId: "TMI_00012007" },
    });
  });

  it("a valid follow-up notification links to /followups/$followUpId", () => {
    expect(notificationHref(n("follow_up", "FU_00004415"))).toEqual({
      to: "/followups/$followUpId",
      params: { followUpId: "FU_00004415" },
    });
  });

  it("trims surrounding whitespace on an otherwise valid code", () => {
    expect(notificationHref(n("lead", "  TMI_00012007 "))).toEqual({
      to: "/leads/$leadId",
      params: { leadId: "TMI_00012007" },
    });
  });

  it("a malformed code never produces a route (no arbitrary URLs)", () => {
    expect(notificationHref(n("lead", "TMI_123"))).toBeNull();
    expect(notificationHref(n("lead", "../../etc/passwd"))).toBeNull();
    expect(notificationHref(n("follow_up", "FU_x"))).toBeNull();
    expect(notificationHref(n("lead", "TMI_00012007; DROP TABLE"))).toBeNull();
  });

  it("system / unknown / missing type → no link", () => {
    expect(notificationHref(n("system", null))).toBeNull();
    expect(notificationHref(n("system", "anything"))).toBeNull();
    expect(notificationHref(n("widget", "TMI_00012007"))).toBeNull();
    expect(notificationHref(n(null, "TMI_00012007"))).toBeNull();
  });

  it("missing / empty code → no link (does not throw)", () => {
    expect(notificationHref(n("lead", null))).toBeNull();
    expect(notificationHref(n("lead", ""))).toBeNull();
    expect(notificationHref(n("follow_up", "   "))).toBeNull();
  });

  it("isNotificationLinkable mirrors notificationHref", () => {
    expect(isNotificationLinkable(n("lead", "TMI_00012007"))).toBe(true);
    expect(isNotificationLinkable(n("lead", "bad"))).toBe(false);
    expect(isNotificationLinkable(n("system", "x"))).toBe(false);
  });
});
