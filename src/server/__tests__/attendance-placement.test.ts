import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const fns = readFileSync(join(root, "lib", "officeverse", "attendance-fns.ts"), "utf8");
const service = readFileSync(join(root, "server", "attendance", "service.ts"), "utf8");
const repo = readFileSync(join(root, "server", "db", "repos", "attendance.ts"), "utf8");
const context = readFileSync(join(root, "server", "context.ts"), "utf8");

describe("attendance endpoint placement + identity", () => {
  it("no attendance module under src/server/api (client import-protection)", () => {
    expect(readdirSync(join(root, "server", "api")).some((f) => /attendance/i.test(f))).toBe(false);
  });

  it("exactly three fns, each authenticating from the session", () => {
    const names = [...fns.matchAll(/export const (\w+Fn)\b/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["adminAttendanceFn", "correctAttendanceFn", "myAttendanceFn"]);
    expect((fns.match(/requireUser\(\)/g) ?? []).length).toBe(3);
  });

  it("no browser-supplied user id / role / process / shift / timestamp drives the result", () => {
    // the fns take no userId/role/process identity input; self-view is scoped to requireUser()
    expect(fns).not.toMatch(/userId\s*:/);
    expect(fns).not.toMatch(/\brole\s*:\s*z\./);
    expect(service).toMatch(/user\.process/); // server-authoritative process
    // touchAttendance derives times from session rows / nowIST, not request data
    expect(service).not.toMatch(/data\.(timestamp|checkIn|process|role)/);
  });

  it("attendance is wired into getAuth() as a best-effort side effect (no second tracker)", () => {
    expect(context).toMatch(/touchAttendanceSafe\(/);
    expect(context).toMatch(/void touchAttendanceSafe/); // fire-and-forget
  });

  it("a corrected row is never clobbered by the derived path, and the original is snapshotted", () => {
    expect(service).toMatch(/source === "corrected"/);
    expect(repo).toMatch(/originalSnapshot == null/); // first correction preserves the original
    expect(repo).toMatch(/correctedByUserId|corrected_by_user_id/);
    expect(repo).toMatch(/correctedAt|corrected_at/);
    expect(repo).toMatch(/correctionReason|correction_reason/);
  });
});
