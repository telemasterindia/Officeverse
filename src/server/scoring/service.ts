/**
 * Officeverse — Scoring Engine RULE SERVICE (Phase 2). Server-side only.
 *
 * The authoritative, permission-checked place scoring rules are created,
 * versioned and enabled. Editing a rule NEVER mutates a version row — it
 * appends a new immutable `scoring_rule_versions` snapshot and closes the
 * previous window, so historical ledger rows keep scoring at the version that
 * was effective on their operational date.
 *
 * PHASE 2 SCOPE: no client-facing server function and no Admin route yet
 * (that is Phase 3). This module is the foundation those will call. There is
 * NO endpoint through which a client can submit a computed award — only rule
 * DEFINITIONS, and only for an Admin.
 */
import { getDb, isDbConfigured } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { nowIST } from "../time";
import { assertCanManageScoringRules } from "../authz/operations";
import * as repo from "../db/repos/scoring";
import { isKnownEvent, isScoringEnabledEvent } from "./events";
import { collectConditionIssues, type ConditionNode } from "./conditions";
import {
  DEFAULT_RULE_MATCHING_MODE,
  isRuleMatchingMode,
  validateOutcome,
  type AppliesToShape,
  type Outcome,
  type RuleMatchingMode,
} from "./modes";
import { isYmd } from "./versions";

type Meta = { ip?: string | null; userAgent?: string | null };

const PRIORITY_MIN = 0;
const PRIORITY_MAX = 100_000;

export interface RuleDraft {
  name: string;
  event: string;
  appliesTo?: AppliesToShape | null;
  ruleMatchingMode?: RuleMatchingMode;
  priority?: number;
  conditionTree?: ConditionNode | null;
  outcome: Outcome;
  /** "YYYY-MM-DD" — the operational date this (version of the) rule starts scoring from */
  effectiveFrom: string;
}

/** Static validation for a rule draft. Returns [] when the draft is saveable. */
export function validateRuleDraft(draft: RuleDraft): string[] {
  const errs: string[] = [];
  if (typeof draft.name !== "string" || draft.name.trim().length === 0 || draft.name.length > 120) {
    errs.push("name_invalid");
  }
  if (typeof draft.event !== "string" || !isKnownEvent(draft.event)) {
    errs.push("event_unknown");
  } else if (!isScoringEnabledEvent(draft.event)) {
    errs.push("event_not_enabled_for_scoring");
  }
  if (draft.ruleMatchingMode !== undefined && !isRuleMatchingMode(draft.ruleMatchingMode)) {
    errs.push("rule_matching_mode_invalid");
  }
  if (draft.priority !== undefined) {
    if (
      !Number.isInteger(draft.priority) ||
      draft.priority < PRIORITY_MIN ||
      draft.priority > PRIORITY_MAX
    ) {
      errs.push("priority_out_of_range");
    }
  }
  if (!isYmd(draft.effectiveFrom)) errs.push("effective_from_invalid");
  errs.push(...validateOutcome(draft.outcome).map((e) => `outcome:${e}`));
  errs.push(
    ...collectConditionIssues(draft.conditionTree ?? null, draft.event).map(
      (e) => `condition:${e}`,
    ),
  );
  return errs;
}

async function assertReady(actorRole: string): Promise<void> {
  assertCanManageScoringRules(actorRole);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
}

export interface CreatedRule {
  ruleId: number;
  version: number;
}

/** Create a new rule. It is ALWAYS created disabled; an Admin enables it after a dry run. */
export async function createScoringRule(
  actor: Pick<User, "id" | "role">,
  draft: RuleDraft,
  meta: Meta = {},
): Promise<CreatedRule> {
  await assertReady(actor.role);
  const errs = validateRuleDraft(draft);
  if (errs.length) throw new HttpError(400, `Invalid rule: ${errs.join(", ")}`, "invalid_rule");

  const db = getDb();
  const now = nowIST();
  const mode = draft.ruleMatchingMode ?? DEFAULT_RULE_MATCHING_MODE;
  const appliesTo = draft.appliesTo ?? null;

  const ruleId = await repo.insertRule(
    {
      name: draft.name.trim().slice(0, 120),
      event: draft.event,
      appliesTo: appliesTo as never,
      ruleMatchingMode: mode,
      priority: draft.priority ?? 100,
      enabled: false,
      currentVersion: 1,
      createdByUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    },
    db,
  );

  await repo.insertRuleVersion(
    {
      ruleId,
      version: 1,
      nameSnapshot: draft.name.trim().slice(0, 120),
      eventSnapshot: draft.event,
      appliesToSnapshot: appliesTo as never,
      conditionTree: (draft.conditionTree ?? null) as never,
      outcome: draft.outcome as never,
      effectiveFrom: draft.effectiveFrom,
      effectiveUntil: null,
      createdByUserId: actor.id,
      createdAt: now,
    },
    db,
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "scoring.rule_create",
    entityType: "scoring_rule",
    entityId: ruleId,
    metadata: { name: draft.name, event: draft.event, mode, effectiveFrom: draft.effectiveFrom },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { ruleId, version: 1 };
}

/** Edit a rule — appends an immutable new version and closes the previous window. */
export async function updateScoringRule(
  actor: Pick<User, "id" | "role">,
  ruleId: number,
  draft: RuleDraft,
  meta: Meta = {},
): Promise<CreatedRule> {
  await assertReady(actor.role);
  const errs = validateRuleDraft(draft);
  if (errs.length) throw new HttpError(400, `Invalid rule: ${errs.join(", ")}`, "invalid_rule");

  const db = getDb();
  const rule = await repo.getRuleById(ruleId, db);
  if (!rule) throw new HttpError(404, "Rule not found", "not_found");

  const versions = await repo.getVersionsForRule(ruleId, db);
  const latest = versions.reduce((m, v) => (v.version > m ? v.version : m), 0);
  const openFrom = versions
    .filter((v) => v.effectiveUntil === null)
    .map((v) => v.effectiveFrom)
    .sort()
    .pop();
  if (openFrom && draft.effectiveFrom <= openFrom) {
    throw new HttpError(
      400,
      "effectiveFrom must be after the currently-open version's start",
      "bad_effective_from",
    );
  }

  const now = nowIST();
  const nextVersion = latest + 1;
  const mode = draft.ruleMatchingMode ?? (rule.ruleMatchingMode as RuleMatchingMode);
  const appliesTo = draft.appliesTo ?? null;

  await repo.closeOpenVersionAt(ruleId, draft.effectiveFrom, db);
  await repo.insertRuleVersion(
    {
      ruleId,
      version: nextVersion,
      nameSnapshot: draft.name.trim().slice(0, 120),
      eventSnapshot: draft.event,
      appliesToSnapshot: appliesTo as never,
      conditionTree: (draft.conditionTree ?? null) as never,
      outcome: draft.outcome as never,
      effectiveFrom: draft.effectiveFrom,
      effectiveUntil: null,
      createdByUserId: actor.id,
      createdAt: now,
    },
    db,
  );
  await repo.updateRuleHeader(
    ruleId,
    {
      name: draft.name.trim().slice(0, 120),
      event: draft.event,
      appliesTo: appliesTo as never,
      ruleMatchingMode: mode,
      priority: draft.priority ?? rule.priority,
      currentVersion: nextVersion,
      updatedAt: now,
    },
    db,
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "scoring.rule_update",
    entityType: "scoring_rule",
    entityId: ruleId,
    metadata: { version: nextVersion, effectiveFrom: draft.effectiveFrom },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { ruleId, version: nextVersion };
}

export async function setScoringRuleEnabled(
  actor: Pick<User, "id" | "role">,
  ruleId: number,
  enabled: boolean,
  meta: Meta = {},
): Promise<{ ok: true }> {
  await assertReady(actor.role);
  const db = getDb();
  const rule = await repo.getRuleById(ruleId, db);
  if (!rule) throw new HttpError(404, "Rule not found", "not_found");

  await repo.setRuleEnabled(ruleId, enabled, nowIST(), db);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: enabled ? "scoring.rule_enable" : "scoring.rule_disable",
    entityType: "scoring_rule",
    entityId: ruleId,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

export type RuleDetail = repo.RuleWithVersions;

export async function listScoringRules(
  actor: Pick<User, "role">,
  filter: { event?: string } = {},
): Promise<{ dbUnavailable?: boolean; rules: RuleDetail[] }> {
  assertCanManageScoringRules(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, rules: [] };
  const db = getDb();
  const headers = await repo.listRules(filter, db);
  const rules: RuleDetail[] = [];
  for (const h of headers) {
    rules.push({ ...h, versions: await repo.getVersionsForRule(h.id, db) });
  }
  return { rules };
}

export async function getScoringRule(
  actor: Pick<User, "role">,
  ruleId: number,
): Promise<RuleDetail> {
  assertCanManageScoringRules(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const rule = await repo.getRuleById(ruleId, db);
  if (!rule) throw new HttpError(404, "Rule not found", "not_found");
  return { ...rule, versions: await repo.getVersionsForRule(ruleId, db) };
}
