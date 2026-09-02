import { describe, expect, it } from "vitest";
import {
  EVENT_DEFS,
  getEventDef,
  isKnownEvent,
  isScoringEnabledEvent,
  listScoringEnabledEventTypes,
} from "../scoring/events";
import { FIELD_DEFS, fieldsForEvent, getFieldDef, isFieldValidForEvent } from "../scoring/fields";

describe("scoring — EVENT REGISTRY is the validation authority", () => {
  it("ships the five enabled types and four defined-but-disabled future types", () => {
    expect(listScoringEnabledEventTypes().sort()).toEqual(
      ["ACHIEVEMENT_UNLOCKED", "LEAD_ACCEPTED", "LEAD_SUBMITTED", "SALE", "TEAM_MILESTONE"].sort(),
    );
    for (const t of ["FOLLOW_UP_COMPLETED", "QUALIFIED", "DISPOSITION_SET", "LEAD_GRADED"]) {
      expect(isKnownEvent(t)).toBe(true);
      expect(isScoringEnabledEvent(t)).toBe(false);
    }
  });

  it("unknown type is not known and not scoring-enabled", () => {
    expect(isKnownEvent("TOTALLY_MADE_UP")).toBe(false);
    expect(isScoringEnabledEvent("TOTALLY_MADE_UP")).toBe(false);
    expect(getEventDef("TOTALLY_MADE_UP")).toBeUndefined();
  });

  it("no point value or business number lives in the event registry", () => {
    for (const d of EVENT_DEFS) {
      expect(Object.keys(d)).toEqual(
        expect.arrayContaining([
          "type",
          "label",
          "enabledForScoring",
          "recognitionKind",
          "introducedIn",
        ]),
      );
      expect(Object.values(d).some((v) => typeof v === "number")).toBe(false);
    }
  });
});

describe("scoring — FIELD REGISTRY whitelists payload keys per event", () => {
  it("debt_amount is money and valid for the three lead events only", () => {
    expect(getFieldDef("debt_amount")?.type).toBe("money");
    expect(isFieldValidForEvent("debt_amount", "LEAD_SUBMITTED")).toBe(true);
    expect(isFieldValidForEvent("debt_amount", "SALE")).toBe(true);
    expect(isFieldValidForEvent("debt_amount", "TEAM_MILESTONE")).toBe(false);
  });

  it("a future field is registered but marked future", () => {
    expect(getFieldDef("sale_amount")?.introducedIn).toBe("future");
    expect(getFieldDef("closer_tenure_days")?.introducedIn).toBe("future");
  });

  it("unknown field key resolves to undefined and is invalid for every event", () => {
    expect(getFieldDef("nope")).toBeUndefined();
    expect(isFieldValidForEvent("nope", "LEAD_SUBMITTED")).toBe(false);
  });

  it("fieldsForEvent returns only fields whose events include the type", () => {
    const keys = fieldsForEvent("LEAD_SUBMITTED").map((f) => f.key);
    expect(keys).toContain("debt_amount");
    expect(keys).toContain("state");
    expect(keys).not.toContain("disposition");
  });

  it("no business value (amount / threshold / id) is baked into the field registry", () => {
    for (const f of FIELD_DEFS) {
      expect(Object.values(f).some((v) => typeof v === "number")).toBe(false);
    }
  });
});
