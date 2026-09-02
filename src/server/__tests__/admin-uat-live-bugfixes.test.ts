/**
 * Admin UAT — live bug fixes regression guard.
 *   1 Closer lead assignment (process-scoped picker + real errors)
 *   2 Agent photo thumbnail (preview + stored-photo display)
 *   3 Agent Employee ID (server-generated, shown prominently)
 *   4 Shift override HH:MM validation (form + Zod aligned on strict "HH:MM")
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toLeadDTO } from "../leads/dto";
import { HHMM_RE, isHHMM } from "../attendance/classify";
import { agentCode, AGENT_CODE_RE } from "../ids";
import type { Lead } from "@/lib/db/schema";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/* --------------------------- Bug 1 --------------------------- */

const LEAD_ROW = {
  id: 1,
  leadCode: "TMI_00012007",
  shiftDate: "2026-08-01",
  customerName: "Test",
  phone: "5550001111",
  email: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  debtAmount: "1000",
  creditStatus: null,
  currentDebts: "Current",
  leadFile: null,
  comments: null,
  status: "NEW",
  source: "manual",
  agentId: 3,
  assignedCloserId: null,
  convertedFromFollowUpId: null,
  createdAt: "2026-08-01 10:00:00",
  updatedAt: "2026-08-01 10:00:00",
} as unknown as Lead;

describe("Bug 1 — the lead DTO carries the process for a scoped closer picker", () => {
  it("toLeadDTO surfaces meta.process", () => {
    expect(toLeadDTO(LEAD_ROW, { process: "IN" }).process).toBe("IN");
    expect(toLeadDTO(LEAD_ROW, {}).process).toBeNull();
  });

  it("hydrate derives the lead process from the agent, else the closer", () => {
    const svc = read("server/leads/service.ts");
    expect(svc).toMatch(/process:\s*aMeta\?\.process \?\? cMeta\?\.process \?\? null/);
    const staff = read("server/db/repos/staff.ts");
    expect(staff).toMatch(/process: users\.process/); // loadAgentMeta / loadCloserMeta select it
  });

  it("the reassign-closer card filters to same-process closers and shows the real error", () => {
    const route = read("routes/_shell.leads.$leadId.tsx");
    expect(route).toMatch(/c\.process === lead\.process/);
    expect(route).toMatch(/e instanceof Error \? e\.message/);
    expect(route).not.toMatch(/must be in the same process \(US \/ India\) as the lead/); // no misleading canned text
  });

  it("UiLead exposes process for the picker", () => {
    const hook = read("lib/officeverse/use-lead-lifecycle.ts");
    expect(hook).toMatch(/process:\s*string \| null/);
    expect(hook).toMatch(/process: d\.process \?\? null/);
  });
});

/* --------------------------- Bug 2 --------------------------- */

describe("Bug 2 — agent photo preview + stored-photo display", () => {
  it("the create form shows an immediate preview from the selected file", () => {
    for (const f of ["routes/_shell.agents.new.tsx", "routes/_shell.closers.new.tsx"]) {
      const src = read(f);
      expect(src).toMatch(/URL\.createObjectURL/);
      expect(src).toMatch(/URL\.revokeObjectURL/); // no leak
      expect(src).toMatch(/photoPreview/);
      expect(src).toMatch(/onChange=\{onPhotoChange\}/);
    }
  });

  it("StaffDTO exposes user_id so Admin/HR can load the official photo", () => {
    const svc = read("server/staff/service.ts");
    expect(svc).toMatch(/user_id:\s*number/);
    expect(svc).toMatch(/user_id:\s*r\.userId/);
  });

  it("the agent list + detail render the stored photo via the shared StaffAvatar (no separate photo system)", () => {
    const route = read("routes/_shell.agents.index.tsx");
    // the list row uses the server-aware avatar wired to the DTO
    expect(route).toMatch(/StaffAvatar/);
    expect(route).toMatch(/userId=\{a\.user_id\}/); // list row
    expect(route).not.toMatch(/agentPhotoFn|closerPhotoFn/); // reuses the one photo API
    // the profile editor (shared by agents + closers) also uses it, wired to the DTO
    const editor = read("components/officeverse/staff-edit-dialog.tsx");
    expect(editor).toMatch(/userId=\{staff\.user_id\}/);
    expect(editor).not.toMatch(/agentPhotoFn|closerPhotoFn/);

    // StaffAvatar resolves the AUTHORITATIVE Phase-19 photo, not a new store
    const avatar = read("components/officeverse/staff-avatar.tsx");
    expect(avatar).toMatch(/useProfilePhoto\(/);
    expect(avatar).toMatch(/photoDataUrl\(/);
    expect(avatar).not.toMatch(/agentPhotoFn|closerPhotoFn/);
  });
});

/* --------------------------- Bug 3 --------------------------- */

describe("Bug 3 — Employee ID is server-generated and shown", () => {
  it("the id format is canonical TMI_CC_### and matched by the shared regex", () => {
    expect(agentCode(1)).toBe("TMI_CC_001");
    expect(agentCode(23)).toBe("TMI_CC_023");
    expect(AGENT_CODE_RE.test("TMI_CC_001")).toBe(true);
    expect(AGENT_CODE_RE.test("TMI_CC001")).toBe(true); // legacy still resolves
    expect(AGENT_CODE_RE.test("AG-90001")).toBe(true); // legacy still resolves
  });

  it("the create form has NO manual employee-id input and shows the generated one prominently", () => {
    const src = read("routes/_shell.agents.new.tsx");
    expect(src).not.toMatch(/name="(agent_code|employee_id|code)"/);
    expect(src).toMatch(/Employee ID/);
    expect(src).toMatch(/\{created\?\.code\}/);
    expect(src).toMatch(/Employee ID \$\{res\.staff\.code\}/); // toast
  });

  it("createStaff generates + returns the code server-side; the CREATE fn never accepts one", () => {
    expect(read("server/staff/service.ts")).toMatch(/repo\.nextStaffCode\(input\.kind\)/);
    const fns = read("lib/officeverse/staff-fns.ts");
    // scope the check to the create input schema — the promote fn legitimately
    // takes an existing `agent_code` to identify who is being promoted (§9).
    const createSchema = fns.slice(
      fns.indexOf("const createInput = z.object("),
      fns.indexOf("const listInput = z.object("),
    );
    expect(createSchema).not.toMatch(/agent_code|employee_id|\bcode\b/);
  });
});

/* --------------------------- Bug 4 --------------------------- */

describe("Bug 4 — HH:MM (24h) validation accepts real times, form + schema aligned", () => {
  it("accepts exactly valid 24-hour HH:MM", () => {
    for (const ok of ["21:30", "06:30", "18:30", "09:30", "00:00", "23:59"]) {
      expect(isHHMM(ok), ok).toBe(true);
    }
  });

  it("still rejects malformed / out-of-range values (no weakening)", () => {
    for (const bad of [
      "6:30",
      "21:30:00",
      "24:00",
      "23:60",
      "9:5",
      "2130",
      "21.30",
      "",
      " 21:30",
    ]) {
      expect(isHHMM(bad), bad).toBe(false);
    }
  });

  it("the server Zod schema uses the identical strict pattern", () => {
    const fns = read("lib/officeverse/shift-override-fns.ts");
    expect(fns).toContain("/^([01]\\d|2[0-3]):[0-5]\\d$/");
    expect(HHMM_RE.source).toBe("^([01]\\d|2[0-3]):[0-5]\\d$");
  });

  it("the form uses native time inputs and normalises H:MM / HH:MM:SS before sending", () => {
    const route = read("routes/_shell.shifts.tsx");
    expect(route).toMatch(/name="startHHMM" type="time"/);
    expect(route).toMatch(/name="endHHMM" type="time"/);
    expect(route).toMatch(/padStart\(2, "0"\)/); // single-digit hour → 2 digits
  });
});
