import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const holidayFns = join(root, "lib", "officeverse", "holiday-fns.ts");
const hrService = readFileSync(join(root, "server", "hr", "service.ts"), "utf8");
const hrServiceCode = hrService.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("holiday + regularity-bonus endpoints — placement & trust boundary", () => {
  it("no holiday / bonus module under src/server/api (client import-protection)", () => {
    const apiDir = join(root, "server", "api");
    const files = readdirSync(apiDir);
    expect(files.some((f) => /holiday|bonus|regularit/i.test(f))).toBe(false);
  });

  it("every exported holiday/bonus server fn derives identity via requireUser()", () => {
    const src = readFileSync(holidayFns, "utf8");
    const fns = [...src.matchAll(/export const (\w+Fn)\b/g)].map((m) => m[1]);
    expect(fns.sort()).toEqual(
      [
        "addHolidayFn",
        "adminBonusFn",
        "deactivateHolidayFn",
        "holidaysFn",
        "myBonusFn",
        "recalcBonusFn",
        "seedUsFederalFn",
        "updateHolidayFn",
      ].sort(),
    );
    const handlers = src.split(/export const \w+Fn/).slice(1);
    for (const h of handlers) expect(h).toMatch(/requireUser\(\)/);
  });

  it("the client cannot supply bonus amount / eligibility / a leave-day count", () => {
    const src = readFileSync(holidayFns, "utf8");
    // no writable result fields anywhere in the validators
    expect(src).not.toMatch(/bonusAmount/);
    expect(src).not.toMatch(/leaveCount|offCount/);
    // recalc takes only a target user + month — never a precomputed result
    const recalcBody = src
      .slice(src.indexOf("recalcBonusInput = z.object({"))
      .split("});")[0]!
      .replace("recalcBonusInput = z.object({", "");
    expect(recalcBody).toMatch(/userId:/);
    expect(recalcBody).toMatch(/month,/);
    expect(recalcBody).not.toMatch(/eligible|bonus|amount/i);
    // `eligible` appears ONLY as an optional admin list filter
    for (const m of src.matchAll(/eligible[^,\n]*/g)) {
      expect(m[0]).toMatch(/\.optional\(\)/);
    }
  });

  it("recomputeBonus consumes the authoritative Phase-11 outputs, not attendance.status", () => {
    const fn = hrServiceCode.slice(
      hrServiceCode.indexOf("export async function recomputeBonus"),
      hrServiceCode.indexOf("export async function", hrServiceCode.indexOf("recomputeBonus") + 1),
    );
    expect(fn).toMatch(/countLeaveDaysInMonth/);
    expect(fn).toMatch(/countActiveOffInMonth/);
    expect(fn).toMatch(/computeRegularityBonus/);
    expect(fn).not.toMatch(/attendance\.status|countAttendanceStatus/);
  });

  it("there is exactly ONE connected-non-working engine (no second sandwich algorithm)", () => {
    const hrDir = join(root, "server", "hr");
    const defs = readdirSync(hrDir).filter((f) => {
      if (!f.endsWith(".ts")) return false;
      return /export function expandSandwich/.test(readFileSync(join(hrDir, f), "utf8"));
    });
    expect(defs).toEqual(["non-working.ts"]);
  });

  it("holidayMapInRange feeds the existing engine through buildHolidayMap", () => {
    const repo = readFileSync(join(root, "server", "db", "repos", "hr.ts"), "utf8");
    expect(repo).toMatch(/return buildHolidayMap\(rows, process\)/);
  });

  it("holiday + bonus mutations are gated behind Admin/HR authz", () => {
    expect(hrServiceCode).toMatch(/assertCanManageHolidays\(actor\.role as HrRole\)/);
    // listAllBonus / recalcBonusForEmployee use the leave-management gate
    const bonusMgmt = hrServiceCode.slice(
      hrServiceCode.indexOf("export async function listAllBonus"),
    );
    expect(bonusMgmt).toMatch(/assertCanManageLeave\(actor\.role as HrRole\)/);
  });
});
