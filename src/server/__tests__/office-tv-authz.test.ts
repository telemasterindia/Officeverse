import { describe, expect, it } from "vitest";
import {
  assertCanManageOfficeTv,
  assertValidAnnouncement,
  canManageOfficeTv,
} from "../authz/office-tv";

describe("Office TV authorization", () => {
  it("only an Admin may manage the Office TV", () => {
    expect(canManageOfficeTv("admin")).toBe(true);
    expect(canManageOfficeTv("hr")).toBe(false);
    expect(canManageOfficeTv("closer")).toBe(false);
    expect(canManageOfficeTv("agent")).toBe(false);
    expect(() => assertCanManageOfficeTv("hr")).toThrow(/Admin/i);
    expect(() => assertCanManageOfficeTv("admin")).not.toThrow();
  });

  it("assertValidAnnouncement enforces title / message / duration / priority", () => {
    const ok = {
      title: "POWER HOUR",
      message: "Let's go team",
      durationMs: 12_000,
      priority: "NORMAL",
    };
    expect(() => assertValidAnnouncement(ok)).not.toThrow();
    expect(() => assertValidAnnouncement({ ...ok, title: " " })).toThrow(/title/i);
    expect(() => assertValidAnnouncement({ ...ok, message: "" })).toThrow(/message/i);
    expect(() => assertValidAnnouncement({ ...ok, durationMs: 100 })).toThrow(/duration/i);
    expect(() => assertValidAnnouncement({ ...ok, durationMs: 999_999 })).toThrow(/duration/i);
    expect(() => assertValidAnnouncement({ ...ok, priority: "SUPER" })).toThrow(/priority/i);
  });
});
