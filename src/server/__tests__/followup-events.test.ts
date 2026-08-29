import { describe, expect, it } from "vitest";
import {
  canGenerateReminderWork,
  planFollowUpEvent,
  type FollowUpEventContext,
} from "../notifications/event-plan";

const base: FollowUpEventContext = {
  followUpCode: "FU_00004415",
  followUpId: 42,
  ownerUserId: 10,
  ownerName: "Owner One",
  scheduledAt: "2026-09-03 14:00:00",
  previousScheduledAt: "2026-09-01 10:00:00",
  customerName: "Acme Co",
};

function allTypes(plan: ReturnType<typeof planFollowUpEvent>): string[] {
  return plan.notifications.map((n) => n.type);
}

describe("planFollowUpEvent — 'created' produces NOTHING (no reminder at creation)", () => {
  it("no notifications, no emails", () => {
    const plan = planFollowUpEvent("created", base);
    expect(plan.notifications).toHaveLength(0);
    expect(plan.emails).toHaveLength(0);
  });
});

describe("planFollowUpEvent — 'rescheduled'", () => {
  const plan = planFollowUpEvent("rescheduled", base);

  it("one notification to the OWNER + one email to the owner", () => {
    expect(plan.notifications).toHaveLength(1);
    expect(plan.notifications[0]).toMatchObject({
      recipientUserId: 10,
      type: "followup.rescheduled",
      relatedEntityCode: "FU_00004415",
    });
    expect(plan.emails).toHaveLength(1);
    expect(plan.emails[0]).toMatchObject({ template: "FOLLOW_UP_RESCHEDULED", toUserId: 10 });
  });

  it("dedupe keys are derived from the follow-up CODE + the NEW scheduled instant", () => {
    const nKey = plan.notifications[0]!.dedupeKey;
    expect(nKey).toBe("followup:FU_00004415:rescheduled:2026-09-03 14:00:00");
    expect(plan.emails[0]!.dedupeKey).toBe(`${nKey}:email`);
  });

  it("the follow-up id survives a reschedule → same code in the key, only occurrence changes", () => {
    const later = planFollowUpEvent("rescheduled", {
      ...base,
      previousScheduledAt: "2026-09-03 14:00:00",
      scheduledAt: "2026-09-05 09:00:00",
    });
    expect(later.notifications[0]!.dedupeKey).toBe(
      "followup:FU_00004415:rescheduled:2026-09-05 09:00:00",
    );
  });
});

describe("planFollowUpEvent — 'converted'", () => {
  it("agent conversion to a DIFFERENT closer → owner notice + closer 'lead.assigned' + LEAD_ASSIGNED email", () => {
    const plan = planFollowUpEvent("converted", {
      ...base,
      leadCode: "TMI_00012007",
      leadId: 900,
      responsibleCloserUserId: 20,
      responsibleCloserName: "Closer Two",
      source: "conversion",
    });
    expect(allTypes(plan).sort()).toEqual(["followup.converted", "lead.assigned"]);
    const assigned = plan.notifications.find((n) => n.type === "lead.assigned")!;
    expect(assigned.recipientUserId).toBe(20);
    expect(plan.emails).toHaveLength(1);
    expect(plan.emails[0]).toMatchObject({ template: "LEAD_ASSIGNED", toUserId: 20 });
  });

  it("closer-owned conversion (closer IS the owner) → only the owner notice, NO lead.assigned, NO email", () => {
    const plan = planFollowUpEvent("converted", {
      ...base,
      ownerUserId: 20,
      leadCode: "TMI_00012007",
      leadId: 900,
      responsibleCloserUserId: 20, // same person
    });
    expect(allTypes(plan)).toEqual(["followup.converted"]);
    expect(plan.emails).toHaveLength(0);
  });
});

describe("planFollowUpEvent — terminal events", () => {
  it("'completed' → one owner notification, no email", () => {
    const plan = planFollowUpEvent("completed", base);
    expect(plan.notifications).toHaveLength(1);
    expect(plan.notifications[0]!.type).toBe("followup.completed");
    expect(plan.emails).toHaveLength(0);
  });

  it("'cancelled' → one owner notification, no email", () => {
    const plan = planFollowUpEvent("cancelled", base);
    expect(plan.notifications[0]!.type).toBe("followup.cancelled");
    expect(plan.emails).toHaveLength(0);
  });
});

describe("event plans NEVER contain time-based reminder work", () => {
  for (const kind of ["created", "rescheduled", "converted", "completed", "cancelled"] as const) {
    it(`'${kind}' plan has no reminder/overdue type`, () => {
      const plan = planFollowUpEvent(kind, {
        ...base,
        leadCode: "TMI_1",
        responsibleCloserUserId: 20,
      });
      for (const t of allTypes(plan)) {
        expect(t).not.toMatch(/reminder|overdue/);
      }
    });
  }
});

describe("canGenerateReminderWork", () => {
  it("true only for an active SCHEDULED follow-up", () => {
    expect(canGenerateReminderWork("SCHEDULED")).toBe(true);
  });
  it("false for every terminal status → a converted/completed/cancelled follow-up cannot be reminded", () => {
    expect(canGenerateReminderWork("CONVERTED")).toBe(false);
    expect(canGenerateReminderWork("COMPLETED")).toBe(false);
    expect(canGenerateReminderWork("CANCELLED")).toBe(false);
  });
});
