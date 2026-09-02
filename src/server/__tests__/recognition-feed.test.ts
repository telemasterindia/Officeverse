/**
 * Phase 10 Stage 3 — RECENT RECOGNITION feed helpers. PURE.
 *
 * Turns the EXISTING office_tv_events recognition log into the Office TV
 * "Recent Achievement" screen model. No fabricated achievements, no scoring —
 * points are looked up from the authoritative ledger by the caller.
 */
import { describe, expect, it } from "vitest";
import {
  buildRecentRecognitionFeed,
  levelForTier,
  recognitionEventLabel,
  recognitionHeadline,
  referenceKey,
  type RawRecognitionRow,
} from "../live/recognition-feed";

describe("labels + level mapping", () => {
  it("maps known kinds to a label + headline", () => {
    expect(recognitionEventLabel("LEAD_ACCEPTED")).toBe("Lead accepted");
    expect(recognitionHeadline("LEAD_ACCEPTED")).toBe("LEAD ACCEPTED");
    expect(recognitionEventLabel("SALE")).toBe("Sale");
  });
  it("falls back gracefully for an unknown kind", () => {
    expect(recognitionEventLabel("SOME_NEW_KIND")).toBe("Some new kind");
    expect(recognitionHeadline("SOME_NEW_KIND", "custom line")).toBe("custom line");
    expect(recognitionHeadline("SOME_NEW_KIND")).toBe("SOME NEW KIND");
  });
  it("tier → semantic level (1..4), anything else → null", () => {
    expect(levelForTier(1)).toBe("LEVEL_1");
    expect(levelForTier(4)).toBe("LEVEL_4");
    expect(levelForTier(0)).toBeNull();
    expect(levelForTier(9)).toBeNull();
    expect(levelForTier(null)).toBeNull();
  });
});

const row = (o: Partial<RawRecognitionRow> = {}): RawRecognitionRow => ({
  id: o.id ?? 1,
  kind: o.kind ?? "LEAD_ACCEPTED",
  subjectUserId: "subjectUserId" in o ? (o.subjectUserId ?? null) : 7,
  message: o.message ?? null,
  tier: o.tier ?? 2,
  referenceType: "referenceType" in o ? (o.referenceType ?? null) : "lead",
  referenceId: "referenceId" in o ? (o.referenceId ?? null) : "TMI_00099001",
  createdAt: o.createdAt ?? "2026-08-31T10:00:00",
});

describe("buildRecentRecognitionFeed — authoritative enrichment", () => {
  it("attaches name / photo / authoritative points / level / labels", () => {
    const feed = buildRecentRecognitionFeed([row()], {
      names: { 7: "Amit" },
      photos: { 7: "data:image/jpeg;base64,AAA" },
      points: { [referenceKey(7, "lead", "TMI_00099001")]: 500 },
    });
    expect(feed[0]).toMatchObject({
      name: "Amit",
      photo: "data:image/jpeg;base64,AAA",
      points: 500,
      level: "LEVEL_2",
      eventLabel: "Lead accepted",
      headline: "LEAD ACCEPTED",
      subjectUserId: 7,
    });
  });

  it("points is null when the ledger has no matching row (never fabricated)", () => {
    const feed = buildRecentRecognitionFeed([row()], { names: {}, photos: {}, points: {} });
    expect(feed[0]!.points).toBeNull();
    expect(feed[0]!.name).toBeNull();
    expect(feed[0]!.photo).toBeNull();
  });

  it("a team-level event (no subject) still renders without a name / points", () => {
    const feed = buildRecentRecognitionFeed(
      [row({ kind: "TEAM_MILESTONE", subjectUserId: null, tier: 3, referenceId: null })],
      { names: { 7: "Amit" }, photos: {}, points: {} },
    );
    expect(feed[0]).toMatchObject({
      subjectUserId: null,
      name: null,
      points: null,
      level: "LEVEL_3",
      headline: "TEAM MILESTONE",
    });
  });

  it("caps the feed length", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ id: i + 1 }));
    expect(buildRecentRecognitionFeed(rows, { names: {}, photos: {}, points: {} }, 8)).toHaveLength(
      8,
    );
  });

  it("is deterministic", () => {
    const args: [RawRecognitionRow[], Parameters<typeof buildRecentRecognitionFeed>[1]] = [
      [row()],
      {
        names: { 7: "Amit" },
        photos: {},
        points: { [referenceKey(7, "lead", "TMI_00099001")]: 500 },
      },
    ];
    const a = buildRecentRecognitionFeed(...args);
    for (let i = 0; i < 5; i++) expect(buildRecentRecognitionFeed(...args)).toEqual(a);
  });
});
