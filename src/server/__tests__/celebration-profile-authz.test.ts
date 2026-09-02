/**
 * Phase 10 — CELEBRATION PROFILE service authorization.
 *
 *   list / create / update / enable-disable / preview / play → Admin + Closer
 *   Agent + HR                                               → 403
 *
 * No DB in this test env → each service gates the role FIRST, then reports
 * dbUnavailable / throws 503, so a denied role always throws 403 first.
 */
import { describe, expect, it } from "vitest";
import { HttpError } from "../http-error";
import {
  createCelebrationProfile,
  listCelebrationProfiles,
  playCelebrationProfile,
  previewCelebrationProfile,
  setCelebrationProfileEnabled,
  updateCelebrationProfile,
  validateProfileDraft,
  type ProfileDraft,
} from "../live/celebration-profile-service";
import { OPERATIONS_AUDIT_ACTIONS } from "../authz/operations";

const U = (id: number, role: "admin" | "agent" | "closer" | "hr") => ({
  id,
  role,
  fullName: `User ${id}`,
});
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

const draft: ProfileDraft = {
  name: "Level 2 dollar rain",
  recognitionLevel: "LEVEL_2",
  triggerEvent: "LEAD_ACCEPTED",
  config: {
    durationMs: 5000,
    intensity: "high",
    effects: { confetti: true, dollarRain: true },
    sound: { opening: "bell", closing: "chime" },
    tts: { enabled: true, template: "Attention team! {employeeName} accepted a lead." },
  },
};

describe("celebration profile service — Admin + Closer only", () => {
  const calls = (u: ReturnType<typeof U>) => [
    listCelebrationProfiles(u),
    createCelebrationProfile(u, draft),
    updateCelebrationProfile(u, 1, draft),
    setCelebrationProfileEnabled(u, 1, true),
    previewCelebrationProfile(u, 1),
    playCelebrationProfile(u, { id: 1 }),
  ];
  it("Admin + Closer pass the role gate (then hit dbUnavailable, never 403)", async () => {
    for (const u of [admin, closer]) for (const c of calls(u)) expect(await code(c)).not.toBe(403);
  });
  it("Agent + HR are denied every call (403)", async () => {
    for (const u of [agent, hr]) for (const c of calls(u)) expect(await code(c)).toBe(403);
  });
});

describe("validateProfileDraft", () => {
  it("accepts a well-formed draft", () => {
    expect(validateProfileDraft(draft)).toEqual([]);
  });
  it("flags a blank name / bad level / bad trigger / bad priority", () => {
    expect(validateProfileDraft({ ...draft, name: "  " })).toContain("name_invalid");
    expect(validateProfileDraft({ ...draft, recognitionLevel: "LEVEL_9" as never })).toContain(
      "recognition_level_invalid",
    );
    expect(validateProfileDraft({ ...draft, triggerEvent: "NOPE" as never })).toContain(
      "trigger_invalid",
    );
    expect(validateProfileDraft({ ...draft, priority: -1 })).toContain("priority_out_of_range");
  });
  it("bubbles config errors with a prefix", () => {
    const errs = validateProfileDraft({
      ...draft,
      config: {
        effects: {
          confetti: false,
          colourParticles: false,
          lightBurst: false,
          energyBurst: false,
          fireworks: false,
          dollarRain: false,
          goldEffect: false,
          victoryEffect: false,
        },
        tts: { enabled: true, template: "" },
      },
    });
    expect(errs).toContain("config:no_effect_selected");
    expect(errs).toContain("config:tts_template_missing");
  });
});

describe("audit action whitelist", () => {
  it("every celebration-profile mutation action is registered for the Operations audit view", () => {
    for (const a of [
      "CELEBRATION_PROFILE_CREATED",
      "CELEBRATION_PROFILE_UPDATED",
      "CELEBRATION_PROFILE_ENABLED",
      "CELEBRATION_PROFILE_DISABLED",
      "CELEBRATION_PLAYED",
    ]) {
      expect(OPERATIONS_AUDIT_ACTIONS).toContain(a);
    }
  });
});
