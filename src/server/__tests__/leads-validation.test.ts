import { describe, expect, it } from "vitest";
import {
  createLeadSchema,
  getLeadSchema,
  listLeadsSchema,
  transferLeadSchema,
  updateLeadSchema,
} from "../validation/leads";

describe("createLeadSchema", () => {
  it("accepts a minimal valid lead", () => {
    const r = createLeadSchema.safeParse({ customer_name: "John Smith", phone: "+1 512 555 0101" });
    expect(r.success).toBe(true);
  });
  it("rejects a missing customer name and a too-short phone", () => {
    expect(createLeadSchema.safeParse({ phone: "+1 512 555 0101" }).success).toBe(false);
    expect(createLeadSchema.safeParse({ customer_name: "X", phone: "12" }).success).toBe(false);
  });
  it("email: '' is allowed, a malformed address is not", () => {
    expect(
      createLeadSchema.safeParse({ customer_name: "X", phone: "5125550101", email: "" }).success,
    ).toBe(true);
    expect(
      createLeadSchema.safeParse({ customer_name: "X", phone: "5125550101", email: "nope" })
        .success,
    ).toBe(false);
  });
  it("coerces a money-formatted debt_amount string to a number", () => {
    const r = createLeadSchema.parse({
      customer_name: "X",
      phone: "5125550101",
      debt_amount: "$12,500.50",
    });
    expect(r.debt_amount).toBe(12500.5);
  });
  it("validates optional closer / agent code shapes", () => {
    expect(
      createLeadSchema.safeParse({
        customer_name: "X",
        phone: "5125550101",
        assigned_closer_code: "CL-00002",
      }).success,
    ).toBe(true);
    expect(
      createLeadSchema.safeParse({
        customer_name: "X",
        phone: "5125550101",
        assigned_closer_code: "CL-2",
      }).success,
    ).toBe(false);
    expect(
      createLeadSchema.safeParse({
        customer_name: "X",
        phone: "5125550101",
        agent_code: "AG-1",
      }).success,
    ).toBe(false);
  });
  it("does not accept trusted identity fields (role / submitted_by / status)", () => {
    const r = createLeadSchema.parse({
      customer_name: "X",
      phone: "5125550101",
      role: "admin",
      submitted_by: "someone",
      status: "COMPLETED",
    } as Record<string, unknown>);
    expect(r).not.toHaveProperty("role");
    expect(r).not.toHaveProperty("submitted_by");
    expect(r).not.toHaveProperty("status");
  });
});

describe("updateLeadSchema", () => {
  it("rejects an empty patch", () => {
    expect(updateLeadSchema.safeParse({}).success).toBe(false);
  });
  it("accepts a single-field patch", () => {
    expect(updateLeadSchema.safeParse({ comment: "called back" }).success).toBe(true);
  });
  it("rejects an unknown status and accepts a valid one", () => {
    expect(updateLeadSchema.safeParse({ status: "BOGUS" }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ status: "ACCEPTED" }).success).toBe(true);
  });
});

describe("getLeadSchema / transferLeadSchema", () => {
  it("lead code must be TMI_########", () => {
    expect(getLeadSchema.safeParse({ code: "TMI_00012007" }).success).toBe(true);
    expect(getLeadSchema.safeParse({ code: "12007" }).success).toBe(false);
  });
  it("transfer requires a valid closer code", () => {
    expect(
      transferLeadSchema.safeParse({ code: "TMI_00012007", to_closer_code: "CL-00002" }).success,
    ).toBe(true);
    expect(transferLeadSchema.safeParse({ code: "TMI_00012007" }).success).toBe(false);
  });
});

describe("listLeadsSchema", () => {
  it("applies defaults and coerces query strings", () => {
    const r = listLeadsSchema.parse({});
    expect(r).toMatchObject({ page: 1, pageSize: 25, sort: "newest" });
    expect(listLeadsSchema.parse({ page: "3", pageSize: "50" })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
  });
  it("clamps / rejects an out-of-range pageSize", () => {
    expect(listLeadsSchema.safeParse({ pageSize: 999 }).success).toBe(false);
    expect(listLeadsSchema.safeParse({ pageSize: 0 }).success).toBe(false);
  });
});
