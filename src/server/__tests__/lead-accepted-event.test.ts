/**
 * Phase 7 — LEAD_ACCEPTED canonical BusinessEvent + pipeline wiring.
 *
 *   Lead service (ASSIGNED → ACCEPTED)  →  buildLeadAcceptedEvent()
 *     → normalizeBusinessEvent()  (registry-validated payload)
 *     → dispatcher  → { Scoring Engine | gated legacy-points fallback } → Recognition bridge
 *     → decideCelebration()  → LEVEL_2
 *
 * No points in the event. No visual logic in the Lead service. One recognition
 * occurrence per accepted lead (idempotent on the source id).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLeadAcceptedEvent } from "../events/adapters/lead-accepted";
import { normalizeBusinessEvent } from "../events/business-event";
import { decideCelebration } from "../live/celebration-level";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const ctx = {
  lead: {
    leadCode: "TMI_00099042",
    debtAmount: "24000.00",
    state: "CA",
    zip: "90001",
    creditStatus: "fair",
    currentDebts: "Late" as const,
    source: "app" as const,
  },
  subjectUserId: 3,
  actorUserId: 5,
  subjectRole: "agent",
  process: "US" as const,
  shiftDate: "2026-08-31",
  agentUserId: 3,
  closerUserId: 5,
};

describe("buildLeadAcceptedEvent — canonical envelope", () => {
  it("produces a LEAD_ACCEPTED event with server-pinned date + source, no points", () => {
    const e = buildLeadAcceptedEvent(ctx);
    expect(e.type).toBe("LEAD_ACCEPTED");
    expect(e.source).toEqual({ type: "lead", id: "TMI_00099042" });
    expect(e.subjectUserId).toBe(3);
    expect(e.actorUserId).toBe(5);
    expect(e.operationalDate).toBe("2026-08-31");
    expect(Object.keys(e.payload)).not.toContain("points");
    expect(e.payload["from_status"]).toBe("ASSIGNED");
    expect(e.payload["to_status"]).toBe("ACCEPTED");
    expect(e.payload["debt_amount"]).toBe(24000);
    expect(e.payload["agent_id"]).toBe(3);
    expect(e.payload["closer_id"]).toBe(5);
    expect(e.payload["process"]).toBe("US");
  });

  it("a blank / non-numeric debt becomes null — never a fabricated 0", () => {
    const e = buildLeadAcceptedEvent({ ...ctx, lead: { ...ctx.lead, debtAmount: "" } });
    expect(e.payload["debt_amount"]).toBeNull();
  });

  it("normalizes cleanly through the registry (known type, whitelisted payload)", () => {
    const norm = normalizeBusinessEvent(buildLeadAcceptedEvent(ctx));
    expect(norm.ok).toBe(true);
    if (norm.ok) {
      expect(norm.event.type).toBe("LEAD_ACCEPTED");
      expect(norm.droppedKeys).toEqual([]); // every emitted key is registry-valid for LEAD_ACCEPTED
      expect(norm.event.payload["debt_amount"]).toBe(24000);
    }
  });
});

describe("Phase 7 — LEAD_ACCEPTED resolves to LEVEL_2 with dollar-rain + audio", () => {
  it("decideCelebration('LEAD_ACCEPTED') → LEVEL_2 / major / dollar-rain", () => {
    const d = decideCelebration({ recognitionKind: "LEAD_ACCEPTED", headline: "LEAD ACCEPTED" });
    expect(d.level).toBe("LEVEL_2");
    expect(d.profile).toBe("major");
    expect(d.particleProfile).toBe("dollar-rain");
    expect(d.durationMs).toBeGreaterThanOrEqual(3000);
    expect(d.durationMs).toBeLessThanOrEqual(6000);
  });
  it("LEVEL_2 is visibly stronger than LEVEL_1 (duration + particle profile)", () => {
    const l1 = decideCelebration({ recognitionKind: "LEAD_SUBMITTED" });
    const l2 = decideCelebration({ recognitionKind: "LEAD_ACCEPTED" });
    expect(l2.durationMs).toBeGreaterThan(l1.durationMs);
    expect(l1.particleProfile).not.toBe("dollar-rain");
    expect(l2.particleProfile).toBe("dollar-rain");
  });
});

describe("Phase 7 — pipeline wiring + idempotency (static)", () => {
  it("legacy-points maps LEAD_ACCEPTED so the no-rule case still awards (gated, no double)", () => {
    const src = read("events/legacy-points.ts");
    expect(src).toMatch(/LEAD_ACCEPTED:\s*"LEAD_ACCEPTED"/);
    // the dispatcher gate keeps scoring + legacy mutually exclusive per event
    expect(read("events/dispatcher.ts")).toMatch(/if \(!scoringOwnsPoints\(status\)\)/);
    expect(src).toMatch(/scoringOwnsPoints\(ingestStatus: string\): boolean/);
    expect(src).toMatch(/ingestStatus === "scored" \|\| ingestStatus === "duplicate"/);
  });

  it("recognition bridge maps LEAD_ACCEPTED → LEAD ACCEPTED headline + level-2 audio profile", () => {
    const src = read("events/recognition-bridge.ts");
    expect(src).toMatch(/LEAD_ACCEPTED:\s*"LEAD_ACCEPTED"/);
    expect(src).toMatch(/LEAD_ACCEPTED:\s*"LEAD ACCEPTED"/);
    expect(src).toMatch(/LEVEL_2:\s*"level2-broadcast"/);
    // the bridge stays read-only over the scoring RESULT (covered in detail by
    // recognition-bridge.test.ts) — it registers itself as the recognition sink
    expect(src).toMatch(/registerRecognitionSink\(recognitionBridge\)/);
  });

  it("recognition emit is idempotent on office_tv_events.dedupe_key (unique) — one celebration", () => {
    const schema = readFileSync(join(root, "..", "lib", "db", "schema.ts"), "utf8");
    expect(schema).toMatch(/dedupeUq:\s*unique\("office_tv_event_dedupe_uq"\)\.on\(t\.dedupeKey\)/);
    const rec = readFileSync(join(root, "live", "recognition.ts"), "utf8");
    // recognizeFromBusinessEvent dedupes on `<eventType>:<source.type>:<source.id>`
    expect(rec).toMatch(
      /dedupeKey:\s*`\$\{input\.eventType\}:\$\{input\.source\.type\}:\$\{input\.source\.id\}`/,
    );
  });

  it("the Lead service emits ONE LEAD_ACCEPTED event at the server-validated transition only", () => {
    const svc = readFileSync(join(root, "leads", "service.ts"), "utf8");
    const emits = svc.match(/buildLeadAcceptedEvent\(/g) ?? [];
    expect(emits).toHaveLength(1);
    // still guarded by the ASSIGNED → ACCEPTED transition; never fired from the UI
    expect(svc).toMatch(/row\.status === "ASSIGNED" && to === "ACCEPTED"/);
  });

  it("onLeadAccepted no longer awards points or emits the base celebration (moved to the event path)", () => {
    const rec = readFileSync(join(root, "live", "recognition.ts"), "utf8");
    const fn = rec.slice(rec.indexOf("export async function onLeadAccepted"));
    const body = fn.slice(0, fn.indexOf("\nexport ") === -1 ? fn.length : fn.indexOf("\nexport "));
    expect(body).not.toMatch(/awardEvent\(/); // points now come from the dispatcher
    expect(body).not.toMatch(/kind:\s*"LEAD_ACCEPTED"/); // base celebration now from the bridge
    expect(body).toMatch(/createNotification\(/); // notification semantics preserved
    expect(body).toMatch(/THIRD_ACCEPTED_LEAD/); // escalation preserved (out of Phase 7 scope)
  });
});
