import { describe, expect, it } from "vitest";
import { pairLeadsAndFollowUps } from "../export/combine";

const lead = (id: number, code: string) => ({
  leadNumId: id,
  cells: { lead_id: code, agent_code: "AG-00001", closer_code: null },
});
const fu = (leadNumId: number | null, code: string) => ({
  leadNumId,
  cells: { follow_up_id: code, follow_up_status: "SCHEDULED" },
});

describe("pairLeadsAndFollowUps — one row per Lead↔Follow-up relationship", () => {
  it("one Lead with one Follow-up → one combined row", () => {
    const rows = pairLeadsAndFollowUps([lead(1, "TMI_1")], [fu(1, "FU_1")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      lead_id: "TMI_1",
      follow_up_id: "FU_1",
      agent_code: "AG-00001",
    });
  });

  it("one Lead with multiple Follow-ups → one row each, history preserved", () => {
    const rows = pairLeadsAndFollowUps(
      [lead(1, "TMI_1")],
      [fu(1, "FU_1"), fu(1, "FU_2"), fu(1, "FU_3")],
    );
    expect(rows.map((r) => r["follow_up_id"])).toEqual(["FU_1", "FU_2", "FU_3"]);
    expect(rows.every((r) => r["lead_id"] === "TMI_1")).toBe(true);
  });

  it("a Lead with no Follow-up → exactly one row, follow-up columns absent/blank", () => {
    const rows = pairLeadsAndFollowUps([lead(1, "TMI_1")], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["follow_up_id"]).toBeUndefined();
  });

  it("a Follow-up whose lead does not resolve is DROPPED (never a follow-up without a Lead)", () => {
    const rows = pairLeadsAndFollowUps(
      [lead(1, "TMI_1")],
      [fu(1, "FU_1"), fu(null, "FU_ORPHAN"), fu(99, "FU_GHOST")],
    );
    expect(rows.map((r) => r["follow_up_id"])).toEqual(["FU_1"]);
  });

  it("ownership columns from the Lead repeat on every pair row", () => {
    const rows = pairLeadsAndFollowUps(
      [{ leadNumId: 1, cells: { lead_id: "TMI_1", agent_code: "AG-9", closer_code: "CL-3" } }],
      [fu(1, "FU_1"), fu(1, "FU_2")],
    );
    expect(rows.every((r) => r["agent_code"] === "AG-9" && r["closer_code"] === "CL-3")).toBe(true);
  });

  it("mixed: 2 leads, one with 2 follow-ups, one with none", () => {
    const rows = pairLeadsAndFollowUps(
      [lead(1, "TMI_1"), lead(2, "TMI_2")],
      [fu(1, "FU_1"), fu(1, "FU_2")],
    );
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r["lead_id"] === "TMI_2")).toHaveLength(1);
  });
});
