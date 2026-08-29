/**
 * Phase-4 correction — conversion ownership rules (pure).
 *
 *   AGENT-owned follow-up  → resulting Lead has an originating agent; a Closer
 *                            MUST be selected.
 *   CLOSER-owned follow-up → resulting Lead has NO originating agent; the SAME
 *                            closer stays responsible; selecting another closer
 *                            is refused.
 */
import { describe, expect, it } from "vitest";
import { conversionOwnershipPlan, validateConversionCloser } from "../authz/followups";

describe("conversionOwnershipPlan", () => {
  it("agent-owned → agent plan, closer selection required", () => {
    expect(conversionOwnershipPlan("agent")).toEqual({ kind: "agent", needsCloserSelection: true });
  });
  it("closer-owned → closer plan, keep the same closer", () => {
    expect(conversionOwnershipPlan("closer")).toEqual({ kind: "closer", keepSameCloser: true });
  });
});

describe("validateConversionCloser — AGENT owner", () => {
  it("a closer code is required", () => {
    expect(validateConversionCloser("agent", "CL-00002", null)).toEqual({ ok: true });
    expect(validateConversionCloser("agent", null, null)).toMatchObject({
      ok: false,
      code: "closer_required",
    });
  });
});

describe("validateConversionCloser — CLOSER owner (no reassignment)", () => {
  it("omitting the closer code is fine", () => {
    expect(validateConversionCloser("closer", null, "CL-00007")).toEqual({ ok: true });
  });
  it("supplying the follow-up owner's OWN closer code is fine (idempotent)", () => {
    expect(validateConversionCloser("closer", "CL-00007", "CL-00007")).toEqual({ ok: true });
  });
  it("supplying a DIFFERENT closer code is refused — the lead must stay with the same closer", () => {
    expect(validateConversionCloser("closer", "CL-00009", "CL-00007")).toMatchObject({
      ok: false,
      code: "closer_cannot_reassign",
    });
  });
});
