import { describe, expect, it } from "vitest";
import {
  expiredAnnouncementIds,
  isAnnouncementActive,
  pickActiveAnnouncement,
  type AnnouncementRowLike,
} from "../live/announcement-select";

const now = 1_700_000_000_000;
function row(over: Partial<AnnouncementRowLike>): AnnouncementRowLike {
  return {
    id: over.id ?? 1,
    status: over.status ?? "published",
    enabled: over.enabled ?? true,
    priority: over.priority ?? "NORMAL",
    publishAtMs: over.publishAtMs ?? null,
    expiresAtMs: over.expiresAtMs ?? null,
    publishedAtMs: over.publishedAtMs ?? now - 1000,
    createdAtMs: over.createdAtMs ?? now - 5000,
  };
}

describe("announcement scheduling — server-authoritative time", () => {
  it("a published announcement with no window is active now", () => {
    expect(isAnnouncementActive(row({}), now)).toBe(true);
  });

  it("a scheduled announcement is inactive before publishAt and active at/after it", () => {
    const r = row({ status: "scheduled", publishAtMs: now + 60_000, publishedAtMs: null });
    expect(isAnnouncementActive(r, now)).toBe(false);
    expect(isAnnouncementActive({ ...r, publishAtMs: now - 1 }, now)).toBe(true);
  });

  it("a scheduled announcement with no time is never active", () => {
    expect(
      isAnnouncementActive(
        row({ status: "scheduled", publishAtMs: null, publishedAtMs: null }),
        now,
      ),
    ).toBe(false);
  });

  it("expiry ends the announcement", () => {
    expect(isAnnouncementActive(row({ expiresAtMs: now - 1 }), now)).toBe(false);
    expect(isAnnouncementActive(row({ expiresAtMs: now + 1 }), now)).toBe(true);
  });

  it("disabled / stopped / expired rows are never active", () => {
    expect(isAnnouncementActive(row({ enabled: false }), now)).toBe(false);
    expect(isAnnouncementActive(row({ status: "stopped" }), now)).toBe(false);
    expect(isAnnouncementActive(row({ status: "expired" }), now)).toBe(false);
  });

  it("pickActiveAnnouncement chooses the highest priority, then most recent start", () => {
    const rows = [
      row({ id: 1, priority: "NORMAL", publishedAtMs: now - 10_000 }),
      row({ id: 2, priority: "URGENT", publishedAtMs: now - 9_000 }),
      row({ id: 3, priority: "IMPORTANT", publishedAtMs: now - 1_000 }),
    ];
    expect(pickActiveAnnouncement(rows, now)!.id).toBe(2);
  });

  it("expiredAnnouncementIds lists only past-expiry, still-live rows", () => {
    const rows = [
      row({ id: 1, expiresAtMs: now - 1 }),
      row({ id: 2, expiresAtMs: now + 1 }),
      row({ id: 3, status: "stopped", expiresAtMs: now - 1 }),
    ];
    expect(expiredAnnouncementIds(rows, now)).toEqual([1]);
  });
});
