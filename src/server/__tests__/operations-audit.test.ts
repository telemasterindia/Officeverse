/**
 * Phase 6.5 — every Operations Control mutation writes an immutable audit row,
 * and the actor is the authenticated server-session user (never the browser).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("Phase 6.5 — audit coverage for ops mutations", () => {
  it("celebration test trigger audits CELEBRATION_TEST_TRIGGERED / _AUDIO_ with the session actor", () => {
    const src = read("server/live/celebration-ops.ts");
    const block = src.slice(src.indexOf("triggerTestCelebration"));
    expect(block).toMatch(/recordAudit\(\{/);
    // Phase 7 — visual-only test vs. audio test choose the matching action
    expect(block).toMatch(
      /action:\s*input\.withAudio \? "CELEBRATION_AUDIO_TEST_TRIGGERED" : "CELEBRATION_TEST_TRIGGERED"/,
    );
    expect(block).toMatch(/actorUserId:\s*actor\.id/);
    expect(block).toMatch(/actorRole:\s*actor\.role/);
    // never from request input
    expect(block).not.toMatch(/actorUserId:\s*(input|data)\./);
  });

  it("power hour create / start / stop each record a POWER_HOUR_* audit row with before/after", () => {
    const src = read("server/live/power-hour.ts");
    for (const action of ["POWER_HOUR_CREATED", "POWER_HOUR_STARTED", "POWER_HOUR_STOPPED"]) {
      expect(src).toMatch(new RegExp(`action:\\s*"${action}"`));
    }
    const auditBlocks = [...src.matchAll(/recordAudit\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
    expect(auditBlocks.length).toBe(3);
    for (const b of auditBlocks) {
      expect(b).toMatch(/actorUserId:\s*actor\.id/);
      expect(b).toMatch(/actorRole:\s*actor\.role/);
      expect(b).toMatch(/before:/);
      expect(b).toMatch(/after:/);
      expect(b).toMatch(/success:\s*true/);
    }
  });

  it("scoring rule create/update/toggle already audit (pre-existing, retained)", () => {
    const src = read("server/scoring/service.ts");
    expect(src).toMatch(/action:\s*"scoring\.rule_create"/);
    expect(src).toMatch(/action:\s*"scoring\.rule_update"/);
    expect(src).toMatch(/action:\s*enabled \? "scoring\.rule_enable" : "scoring\.rule_disable"/);
    expect(src).toMatch(/actorUserId:\s*actor\.id/);
  });

  it("announcement create/publish/stop already audit (pre-existing, retained)", () => {
    const src = read("server/live/service.ts");
    expect(src).toMatch(
      /action:\s*publishNow \? "office_tv\.announcement_publish" : "office_tv\.announcement_schedule"/,
    );
    expect(src).toMatch(/action:\s*"office_tv\.announcement_stop"/);
  });

  it("the ops audit reader reuses the existing audit_logs table — no parallel audit store", () => {
    const src = read("server/live/ops-audit.ts");
    expect(src).toMatch(/from "@\/lib\/db\/schema"/);
    expect(src).toMatch(/auditLogs/);
    expect(src).not.toMatch(/mysqlTable|CREATE TABLE|new .*AuditStore/i);
  });
});
