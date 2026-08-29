import { describe, expect, it } from "vitest";
import { initialsOf, toSessionUser, type PublicUserLike } from "../session-user";

const pu = (over: Partial<PublicUserLike> = {}): PublicUserLike => ({
  id: 42,
  email: "jane.cooper@officeverse.dev",
  fullName: "Jane Cooper",
  role: "agent",
  process: "US",
  status: "active",
  ...over,
});

describe("toSessionUser", () => {
  it("maps the sanitized PublicUser onto the client SessionUser shape", () => {
    const s = toSessionUser(pu());
    expect(s).toMatchObject({
      id: "42",
      name: "Jane Cooper",
      role: "agent",
      process: "US",
      email: "jane.cooper@officeverse.dev",
      initials: "JC",
    });
  });

  it("carries NO password / secret field (PublicUser has none to begin with)", () => {
    const s = toSessionUser(pu()) as unknown as Record<string, unknown>;
    for (const k of Object.keys(s)) {
      expect(/password|hash|secret|token/i.test(k)).toBe(false);
    }
    expect(s).not.toHaveProperty("passwordHash");
  });

  it("a client process override changes display only, never role/identity", () => {
    const s = toSessionUser(pu({ role: "admin" }), "UK");
    expect(s.process).toBe("UK");
    expect(s.role).toBe("admin"); // role still from the server payload
    expect(s.id).toBe("42");
  });
});

describe("initialsOf", () => {
  it("first + last initial, upper-cased", () => {
    expect(initialsOf("Jane Cooper")).toBe("JC");
    expect(initialsOf("amit chadha kumar")).toBe("AK");
  });
  it("single name → first two letters", () => {
    expect(initialsOf("Madonna")).toBe("MA");
  });
  it("empty → '?'", () => {
    expect(initialsOf("   ")).toBe("?");
  });
});
