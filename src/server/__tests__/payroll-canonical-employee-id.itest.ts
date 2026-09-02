/**
 * PAYROLL & SALARY — canonical Employee ID lookup · LIVE dryrun UAT (opt-in,
 * DB-touching).
 *
 * Verifies against tmi_officeverse_dryrun that:
 *   - `resolveEmployeeUserId` maps a FULL canonical Employee ID → users.id via
 *     the prefix-routed exact-string match (TMI_CC_ → agents, TMI_CL_ → closers)
 *   - an Agent ID and a Closer ID with the SAME numeric suffix resolve to two
 *     DIFFERENT users and never collide
 *   - a bare "010" / "10" / "TMI_CC_" is rejected (never coerced to a number,
 *     prefix + leading zeros never stripped)
 *   - a non-existent canonical ID is a 404 (records are never invented)
 *   - the resolved id drives setSalaryProfile / calculatePayroll for a
 *     throwaway employee; the calc formula is unchanged
 *
 * SAFETY: asserts SELECT DATABASE() first. Only READS pre-existing employees.
 * Writes only for two throwaway staff (prefix "UAT PCID"), fully deleted in
 * afterAll. Never mutates real salary / payroll / audit history.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import mysql from "mysql2/promise";
import type { User } from "@/lib/db/schema";
import { createStaff } from "@/server/staff/service";
import {
  calculatePayrollForEmployee,
  resolveEmployeeUserId,
  setSalaryProfile,
} from "@/server/hr/payroll-service";

const ADMIN = { id: 1, role: "admin", process: "US" } as unknown as User;
const sfx = Date.now().toString().slice(-8);

let conn: mysql.Connection;
let agent = { code: "", userId: 0 };
let closer = { code: "", userId: 0 };

const scalar = async (sql: string, a: unknown[] = []): Promise<number> => {
  const [r] = (await conn.query(sql, a)) as [Record<string, unknown>[], unknown];
  return Number(Object.values(r[0] ?? { v: 0 })[0]);
};

beforeAll(async () => {
  conn = await mysql.createConnection(process.env["DATABASE_URL"] as string);
  const [r] = (await conn.query("SELECT DATABASE() AS v")) as unknown as [{ v: string }[], unknown];
  if (r[0]!.v !== "tmi_officeverse_dryrun") throw new Error(`REFUSING — ${r[0]!.v}`);

  const a = await createStaff(ADMIN, {
    kind: "agent",
    full_name: `UAT PCID Agent ${sfx}`,
    email: `uat.pcid.a.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
  });
  agent = { code: a.code, userId: a.user_id };
  const c = await createStaff(ADMIN, {
    kind: "closer",
    full_name: `UAT PCID Closer ${sfx}`,
    email: `uat.pcid.c.${sfx}@officeverse.local`,
    password: "uat-password-1234",
    process: "US",
  });
  closer = { code: c.code, userId: c.user_id };
});

afterAll(async () => {
  const uids = [agent.userId, closer.userId].filter(Boolean);
  await conn.query("DELETE FROM regularity_bonus WHERE user_id IN (?)", [uids]);
  await conn.query("DELETE FROM payroll_runs WHERE user_id IN (?)", [uids]);
  await conn.query("DELETE FROM salary_profiles WHERE user_id IN (?)", [uids]);
  await conn.query("DELETE FROM sessions WHERE user_id IN (?)", [uids]);
  await conn.query("DELETE FROM users WHERE id IN (?)", [uids]);
  await conn.end();
});

/* ------------------------------------------------------------------ */

test("resolves the §11 canonical IDs that exist; 404s the ones that don't (never invents)", async () => {
  // adaptive: the dryrun roster changes as the Owner does live UAT, so assert
  // against the ACTUAL rows — resolve when present, 404 when absent.
  for (const code of ["TMI_CC_009", "TMI_CC_010", "TMI_CL_009", "TMI_CL_010"]) {
    const table = code.startsWith("TMI_CC_") ? "agents" : "closers";
    const col = table === "agents" ? "agent_code" : "closer_code";
    const uid = await scalar(`SELECT user_id v FROM ${table} WHERE ${col} = ?`, [code]);
    if (uid > 0) {
      expect(await resolveEmployeeUserId(code)).toBe(uid);
    } else {
      await expect(resolveEmployeeUserId(code)).rejects.toMatchObject({ status: 404 });
    }
  }
  // a canonical ID that is definitely unassigned → 404
  await expect(resolveEmployeeUserId("TMI_CC_997")).rejects.toMatchObject({ status: 404 });
  await expect(resolveEmployeeUserId("TMI_CL_998")).rejects.toMatchObject({ status: 404 });
});

test("TMI_CC_### and TMI_CL_### with the SAME suffix are different employees", async () => {
  for (const suffix of ["001", "007"]) {
    const agentUid = await scalar("SELECT user_id v FROM agents WHERE agent_code = ?", [
      `TMI_CC_${suffix}`,
    ]);
    const closerUid = await scalar("SELECT user_id v FROM closers WHERE closer_code = ?", [
      `TMI_CL_${suffix}`,
    ]);
    expect(agentUid).toBeGreaterThan(0);
    expect(closerUid).toBeGreaterThan(0);
    expect(agentUid).not.toBe(closerUid);

    const resolvedAgent = await resolveEmployeeUserId(`TMI_CC_${suffix}`);
    const resolvedCloser = await resolveEmployeeUserId(`TMI_CL_${suffix}`);
    expect(resolvedAgent).toBe(agentUid);
    expect(resolvedCloser).toBe(closerUid);
    expect(resolvedAgent).not.toBe(resolvedCloser); // no collision
  }
});

test("Employee ID is an opaque string — never coerced, prefix + zeros never stripped", async () => {
  for (const bad of ["010", "10", "9", "TMI_CC_", "TMI_CL", "tmi_cc_010", "AG-00010", "CL-00010"]) {
    await expect(resolveEmployeeUserId(bad)).rejects.toMatchObject({ status: 422 });
  }
  // a surrounding space is trimmed, but the canonical body is matched verbatim
  const u010 = await scalar("SELECT user_id v FROM agents WHERE agent_code = 'TMI_CC_010'");
  expect(await resolveEmployeeUserId("  TMI_CC_010  ")).toBe(u010);
});

test("resolved id drives setSalaryProfile + calculatePayroll for a throwaway employee; formula unchanged", async () => {
  // set base salary via the canonical ID → resolved id
  const target = await resolveEmployeeUserId(agent.code);
  expect(target).toBe(agent.userId);
  await setSalaryProfile(ADMIN, target, { baseSalary: 40000, effectiveFrom: "2026-01-01" });
  expect(
    await scalar(
      "SELECT COUNT(*) v FROM salary_profiles WHERE user_id = ? AND base_salary = 40000",
      [agent.userId],
    ),
  ).toBe(1);

  const res = await calculatePayrollForEmployee(ADMIN, target, "2026-09");
  expect(res.ok).toBe(true);
  expect(res.payroll.userId).toBe(agent.userId);
  // documented invariant: gross = payable base + regularity bonus + overtime +
  // adjustments − unpaid-leave − off − late-units. For a fresh throwaway with no
  // attendance / OT / adjustments those extras are 0, so gross == payable base
  // + bonus and the base itself is the effective-dated 40000.
  expect(Number(res.payroll.baseSalary)).toBe(40000);
  const expectedGross =
    Number(res.payroll.payableBaseSalary) +
    res.payroll.regularityBonus +
    Number(res.payroll.overtimeAmount) +
    Number(res.payroll.adjustmentsTotal) -
    Number(res.payroll.unpaidLeaveDeduction) -
    Number(res.payroll.offDeduction) -
    Number(res.payroll.lateDeduction);
  expect(Number(res.payroll.calculatedSalary)).toBeCloseTo(expectedGross, 2);

  // the closer resolves to a DIFFERENT user — same suffix family, no bleed
  expect(await resolveEmployeeUserId(closer.code)).toBe(closer.userId);
  expect(closer.userId).not.toBe(agent.userId);
});
