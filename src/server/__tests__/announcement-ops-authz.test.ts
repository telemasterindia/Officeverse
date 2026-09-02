/**
 * Phase 10 Stage 2 — ANNOUNCEMENT COMMAND CENTER authorization + audit surface.
 *
 *   create / edit / enable / disable / preview / play on TV → Admin + Closer
 *   Agent + HR                                              → 403
 *
 * No DB in this test env → each service gates the role FIRST, then reports
 * dbUnavailable / throws 503, so a denied role always throws 403 first.
 */
import { describe, expect, it } from "vitest";
import { HttpError } from "../http-error";
import {
  createAnnouncement,
  listAnnouncements,
  setAnnouncementEnabled,
  stopAnnouncement,
  updateAnnouncementFields,
} from "../live/service";
import { playAnnouncementNow, previewAnnouncement } from "../live/announcement-ops";
import { OPERATIONS_AUDIT_ACTIONS } from "../authz/operations";

const U = (id: number, role: "admin" | "agent" | "closer" | "hr") => ({ id, role });
const admin = U(1, "admin");
const closer = U(2, "closer");
const agent = U(3, "agent");
const hr = U(4, "hr");

async function code(p: Promise<unknown>): Promise<number | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
}

const input = {
  title: "POWER HOUR",
  message: "Attention team! Power Hour starts now.",
  priority: "IMPORTANT" as const,
  ttsEnabled: true,
  ttsConfig: { rate: 1, pitch: 1, volume: 1, lang: "en-US" },
  openingSound: "bell",
  closingSound: "bell",
};

describe("announcement command center — Admin + Closer only", () => {
  const calls = (u: ReturnType<typeof U>) => [
    listAnnouncements(u),
    createAnnouncement(u, input),
    updateAnnouncementFields(u, 1, input),
    setAnnouncementEnabled(u, 1, true),
    stopAnnouncement(u, 1),
    previewAnnouncement(u, 1),
    playAnnouncementNow(u, 1),
  ];
  it("Admin + Closer pass the role gate (then hit dbUnavailable, never 403)", async () => {
    for (const u of [admin, closer]) for (const c of calls(u)) expect(await code(c)).not.toBe(403);
  });
  it("Agent + HR are denied every call (403)", async () => {
    for (const u of [agent, hr]) for (const c of calls(u)) expect(await code(c)).toBe(403);
  });
});

describe("audit action whitelist", () => {
  it("every announcement command-center action is registered for the Operations audit view", () => {
    for (const a of [
      "ANNOUNCEMENT_CREATED",
      "ANNOUNCEMENT_UPDATED",
      "ANNOUNCEMENT_ENABLED",
      "ANNOUNCEMENT_DISABLED",
      "ANNOUNCEMENT_PLAYED",
      "POWER_HOUR_ANNOUNCEMENT_TRIGGERED",
    ]) {
      expect(OPERATIONS_AUDIT_ACTIONS).toContain(a);
    }
  });
  it("the legacy publish/schedule/stop audit actions are retained", () => {
    for (const a of [
      "office_tv.announcement_schedule",
      "office_tv.announcement_publish",
      "office_tv.announcement_stop",
    ]) {
      expect(OPERATIONS_AUDIT_ACTIONS).toContain(a);
    }
  });
});
