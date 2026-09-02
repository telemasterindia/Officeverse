/**
 * Audit H-1 — every DIRECT lead-assignment path must enforce US ⇄ India
 * process isolation at the service boundary (never the UI). Bulk reassignment
 * was already guarded (assignments-placement.test.ts); this covers the direct
 * paths: createLead(assigned_closer_code), transferLead, convertFollowUpToLead.
 *
 * Structural checks against source — the end-to-end DB behaviour is verified
 * separately against the dryrun database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const leadSvc = readFileSync(join(root, "server", "leads", "service.ts"), "utf8");
const fuSvc = readFileSync(join(root, "server", "followups", "service.ts"), "utf8");
const staffRepo = readFileSync(join(root, "server", "db", "repos", "staff.ts"), "utf8");

describe("H-1 — direct assignment paths resolve the closer WITH its process", () => {
  it("staff repo exposes a code→closer+user lookup for the process check", () => {
    expect(staffRepo).toMatch(/export async function getCloserWithUserByCode/);
    const fn = staffRepo.slice(staffRepo.indexOf("getCloserWithUserByCode"));
    expect(fn).toMatch(/innerJoin\(users,/);
    expect(fn).toMatch(/users\.process|user:\s*users/);
  });

  it("leads/service has a same-process closer resolver that throws cross_process", () => {
    expect(leadSvc).toMatch(/function resolveCloserInProcess/);
    const fn = leadSvc.slice(leadSvc.indexOf("function resolveCloserInProcess"));
    expect(fn).toMatch(/getCloserWithUserByCode/);
    expect(fn).toMatch(/!==\s*leadProcess/);
    expect(fn).toMatch(/"cross_process"/);
  });

  it("createLead routes assigned_closer_code through the process check (not the bare lookup)", () => {
    const body = leadSvc.slice(
      leadSvc.indexOf("export async function createLead"),
      leadSvc.indexOf("export async function updateLead"),
    );
    expect(body).toMatch(/resolveCloserInProcess\(input\.assigned_closer_code,\s*process\)/);
    expect(body).not.toMatch(/getCloserByCode\(input\.assigned_closer_code\)/);
  });

  it("transferLead resolves the lead's process and checks the target closer against it", () => {
    const body = leadSvc.slice(
      leadSvc.indexOf("export async function transferLead"),
      leadSvc.length,
    );
    expect(body).toMatch(/processOfLeadRow\(row\)/);
    expect(body).toMatch(/resolveCloserInProcess\(toCloserCode,\s*leadProcess\)/);
    expect(body).not.toMatch(/getCloserByCode\(toCloserCode\)/);
  });

  it("convertFollowUpToLead (agent branch) rejects a closer in a different process", () => {
    const body = fuSvc.slice(fuSvc.indexOf("export async function convertFollowUpToLead"));
    expect(body).toMatch(/getCloserWithUserByCode\(toCloserCode!\)/);
    expect(body).toMatch(/targetCloser\.user\.process\s*!==\s*ownerProcess/);
    expect(body).toMatch(/"cross_process"/);
    // closer-owned conversions keep the same closer → inherently same-process
    expect(body).toMatch(/SAME closer keeps operational responsibility/);
  });
});
