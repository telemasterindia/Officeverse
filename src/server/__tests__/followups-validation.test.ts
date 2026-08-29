import { describe, expect, it } from "vitest";
import {
  cancelSchema,
  completeSchema,
  convertSchema,
  createFollowUpSchema,
  customerPatchSchema,
  getFollowUpSchema,
  listFollowUpsSchema,
  rescheduleSchema,
} from "../validation/followups";

const okCreate = {
  full_name: "John Smith",
  phone: "+1 512 555 0101",
  scheduled_date: "2026-09-14",
  scheduled_time: "10:00",
};

describe("createFollowUpSchema", () => {
  it("accepts a minimal valid follow-up", () => {
    expect(createFollowUpSchema.safeParse(okCreate).success).toBe(true);
  });
  it("requires a scheduled date and time", () => {
    expect(createFollowUpSchema.safeParse({ ...okCreate, scheduled_date: undefined }).success).toBe(
      false,
    );
    expect(createFollowUpSchema.safeParse({ ...okCreate, scheduled_time: "9am" }).success).toBe(
      false,
    );
    expect(createFollowUpSchema.safeParse({ ...okCreate, scheduled_time: "9:00" }).success).toBe(
      true,
    );
  });
  it("requires customer name + a real phone", () => {
    expect(createFollowUpSchema.safeParse({ ...okCreate, full_name: "" }).success).toBe(false);
    expect(createFollowUpSchema.safeParse({ ...okCreate, phone: "1" }).success).toBe(false);
  });
  it("email: '' ok, malformed not", () => {
    expect(createFollowUpSchema.safeParse({ ...okCreate, email: "" }).success).toBe(true);
    expect(createFollowUpSchema.safeParse({ ...okCreate, email: "bad" }).success).toBe(false);
  });
  it("coerces a money-formatted debt_amount", () => {
    expect(createFollowUpSchema.parse({ ...okCreate, debt_amount: "$1,000.25" }).debt_amount).toBe(
      1000.25,
    );
  });
  it("drops trusted fields (owner / role / status)", () => {
    const r = createFollowUpSchema.parse({
      ...okCreate,
      owner: 999,
      role: "admin",
      status: "CONVERTED",
    } as Record<string, unknown>);
    expect(r).not.toHaveProperty("owner");
    expect(r).not.toHaveProperty("role");
    expect(r).not.toHaveProperty("status");
  });
});

describe("customerPatchSchema", () => {
  it("rejects an empty patch, accepts one field", () => {
    expect(customerPatchSchema.safeParse({}).success).toBe(false);
    expect(customerPatchSchema.safeParse({ comment: "called back" }).success).toBe(true);
  });
});

describe("rescheduleSchema", () => {
  it("requires date + time", () => {
    expect(
      rescheduleSchema.safeParse({ code: "FU_00004415", scheduled_date: "2026-09-18" }).success,
    ).toBe(false);
    expect(
      rescheduleSchema.safeParse({
        code: "FU_00004415",
        scheduled_date: "2026-09-18",
        scheduled_time: "11:00",
      }).success,
    ).toBe(true);
  });
  it("expected_scheduled_at accepts wall-clock or ISO+offset, rejects junk", () => {
    const base = { code: "FU_00004415", scheduled_date: "2026-09-18", scheduled_time: "11:00" };
    expect(
      rescheduleSchema.safeParse({ ...base, expected_scheduled_at: "2026-08-28 22:00:00" }).success,
    ).toBe(true);
    expect(
      rescheduleSchema.safeParse({ ...base, expected_scheduled_at: "2026-08-28T22:00+05:30" })
        .success,
    ).toBe(true);
    expect(rescheduleSchema.safeParse({ ...base, expected_scheduled_at: "soon" }).success).toBe(
      false,
    );
  });
});

describe("convertSchema (Phase-4 correction: to_closer_code is optional)", () => {
  it("accepts a valid closer code (agent conversion)", () => {
    expect(
      convertSchema.safeParse({ code: "FU_00004415", to_closer_code: "CL-00002" }).success,
    ).toBe(true);
  });
  it("accepts NO closer code (closer conversion — same closer stays)", () => {
    expect(convertSchema.safeParse({ code: "FU_00004415" }).success).toBe(true);
    expect(convertSchema.parse({ code: "FU_00004415" })).not.toHaveProperty("to_closer_code");
  });
  it("still rejects a malformed closer code when one is supplied", () => {
    expect(convertSchema.safeParse({ code: "FU_00004415", to_closer_code: "CL-2" }).success).toBe(
      false,
    );
  });
});

describe("get / complete / cancel", () => {
  it("follow-up code must be FU_########", () => {
    expect(getFollowUpSchema.safeParse({ code: "FU_00004415" }).success).toBe(true);
    expect(getFollowUpSchema.safeParse({ code: "4415" }).success).toBe(false);
  });
  it("note length is bounded", () => {
    expect(completeSchema.safeParse({ code: "FU_00004415", note: "x".repeat(2001) }).success).toBe(
      false,
    );
    expect(cancelSchema.safeParse({ code: "FU_00004415", reason: "busy" }).success).toBe(true);
  });
});

describe("listFollowUpsSchema", () => {
  it("defaults + bucket validation", () => {
    expect(listFollowUpsSchema.parse({})).toMatchObject({ page: 1, pageSize: 25, sort: "soonest" });
    expect(listFollowUpsSchema.safeParse({ bucket: "today" }).success).toBe(true);
    expect(listFollowUpsSchema.safeParse({ bucket: "bogus" }).success).toBe(false);
    expect(listFollowUpsSchema.safeParse({ pageSize: 500 }).success).toBe(false);
  });
});
