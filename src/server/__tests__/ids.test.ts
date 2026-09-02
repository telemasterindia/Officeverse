import { describe, expect, it } from "vitest";
import {
  agentCode,
  clientCode,
  closerCode,
  closerEmailDedupeKey,
  followUpCode,
  leadAssignedDedupeKey,
  leadCode,
  nextFollowUpSeq,
  nextLeadSeq,
  nextStaffSeq,
  numericPart,
  reminderDedupeKey,
  shiftEmailDedupeKey,
} from "../ids";

describe("business codes preserve existing conventions", () => {
  it("formats each code type", () => {
    expect(leadCode(12007)).toBe("TMI_00012007");
    expect(followUpCode(4415)).toBe("FU_00004415");
    // canonical Employee IDs — Agent "TMI_CC_###", Closer "TMI_CL_###"
    expect(agentCode(1)).toBe("TMI_CC_001");
    expect(agentCode(42)).toBe("TMI_CC_042");
    expect(agentCode(128)).toBe("TMI_CC_128");
    expect(closerCode(3)).toBe("TMI_CL_003");
    expect(closerCode(128)).toBe("TMI_CL_128");
    expect(clientCode(12)).toBe("CLT-00012");
  });
  it("numericPart is the inverse of the code formatters", () => {
    expect(numericPart("TMI_00012007")).toBe(12007);
    expect(numericPart("FU_00004415")).toBe(4415);
    expect(numericPart("AG-00042")).toBe(42); // legacy agent code still parses
    expect(numericPart("TMI_CC042")).toBe(42);
    expect(numericPart(leadCode(987654))).toBe(987654);
  });
});

describe("next-sequence helpers (mirror nextLeadId / nextId)", () => {
  it("Lead: starts at 12007, steps by 7", () => {
    expect(nextLeadSeq(0)).toBe(12007);
    expect(nextLeadSeq(12007)).toBe(12014);
  });
  it("Follow-up: starts at 4400, steps by 3", () => {
    expect(nextFollowUpSeq(0)).toBe(4400);
    expect(nextFollowUpSeq(4400)).toBe(4403);
  });
  it("Staff: starts at 1, steps by 1", () => {
    expect(nextStaffSeq(0)).toBe(1);
    expect(nextStaffSeq(41)).toBe(42);
  });
});

describe("dedupe keys (Phase 4 & 6 shapes)", () => {
  it("reminder key matches followup:<id>:<threshold>:<scheduled_at>", () => {
    expect(reminderDedupeKey(42, 15, "2026-09-14 10:00:00")).toBe(
      "followup:42:15:2026-09-14 10:00:00",
    );
    expect(reminderDedupeKey("FU_00004415", 1, "2026-09-14 10:00:00")).toBe(
      "followup:FU_00004415:1:2026-09-14 10:00:00",
    );
  });
  it("is stable for identical inputs (idempotency)", () => {
    const a = reminderDedupeKey(42, 3, "2026-09-14 10:00:00");
    const b = reminderDedupeKey(42, 3, "2026-09-14 10:00:00");
    expect(a).toBe(b);
  });
  it("changes when scheduled_at changes (a reschedule re-arms reminders)", () => {
    expect(reminderDedupeKey(42, 15, "2026-09-14 10:00:00")).not.toBe(
      reminderDedupeKey(42, 15, "2026-09-18 11:00:00"),
    );
  });
  it("closer email key", () => {
    expect(closerEmailDedupeKey(42, "2026-09-14 10:00:00")).toBe(
      "email:closer-followup:42:2026-09-14 10:00:00",
    );
  });
  it("pre-shift summary key matches shift:<user_id>:<shift_start>", () => {
    expect(shiftEmailDedupeKey(7, "2026-08-28 21:00:00")).toBe("shift:7:2026-08-28 21:00:00");
  });
  it("lead assigned key", () => {
    expect(leadAssignedDedupeKey("TMI_00012007", "CL-00002")).toBe(
      "lead:TMI_00012007:assigned:CL-00002",
    );
  });
});
