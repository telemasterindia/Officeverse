import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_CLOSER_LEAD_STATUSES,
  ASSIGNABLE_FOLLOWUP_STATUSES,
  ASSIGNMENT_WORK_TYPES,
  assertCanReassignAssignments,
  canReassignAssignments,
  isAssignmentWorkType,
  WORKTYPE_ROLE,
  WORKTYPE_SUBJECT,
} from "../authz/assignments";

describe("Assignment Control — authorization", () => {
  it("only an Admin may bulk-reassign", () => {
    expect(canReassignAssignments("admin")).toBe(true);
    for (const r of ["agent", "closer", "hr"]) {
      expect(canReassignAssignments(r)).toBe(false);
      expect(() => assertCanReassignAssignments(r)).toThrow(/Admin/i);
    }
    expect(() => assertCanReassignAssignments("admin")).not.toThrow();
  });
});

describe("Assignment Control — work types map to the right role + subject", () => {
  it("agent follow-ups → agent / follow_up", () => {
    expect(WORKTYPE_ROLE.AGENT_FOLLOWUPS).toBe("agent");
    expect(WORKTYPE_SUBJECT.AGENT_FOLLOWUPS).toBe("follow_up");
  });
  it("closer leads → closer / lead", () => {
    expect(WORKTYPE_ROLE.CLOSER_LEADS).toBe("closer");
    expect(WORKTYPE_SUBJECT.CLOSER_LEADS).toBe("lead");
  });
  it("closer follow-ups → closer / follow_up", () => {
    expect(WORKTYPE_ROLE.CLOSER_FOLLOWUPS).toBe("closer");
    expect(WORKTYPE_SUBJECT.CLOSER_FOLLOWUPS).toBe("follow_up");
  });
  it("rejects an unknown work type", () => {
    expect(isAssignmentWorkType("AGENT_LEADS")).toBe(false);
    expect(ASSIGNMENT_WORK_TYPES).toHaveLength(3);
  });
});

describe("Assignment Control — eligibility excludes archived / terminal records", () => {
  it("only SCHEDULED follow-ups are assignable (COMPLETED / CANCELLED / CONVERTED are not)", () => {
    expect([...ASSIGNABLE_FOLLOWUP_STATUSES]).toEqual(["SCHEDULED"]);
    for (const terminal of ["COMPLETED", "CANCELLED", "CONVERTED"]) {
      expect((ASSIGNABLE_FOLLOWUP_STATUSES as readonly string[]).includes(terminal)).toBe(false);
    }
  });

  it("only in-flight leads are closer-assignable (NEW / COMPLETED / REJECTED are not)", () => {
    expect([...ASSIGNABLE_CLOSER_LEAD_STATUSES].sort()).toEqual(
      ["ACCEPTED", "ASSIGNED", "FOLLOW-UP"].sort(),
    );
    for (const excluded of ["NEW", "COMPLETED", "REJECTED"]) {
      expect((ASSIGNABLE_CLOSER_LEAD_STATUSES as readonly string[]).includes(excluded)).toBe(false);
    }
  });
});
