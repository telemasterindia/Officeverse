/**
 * Officeverse — INCENTIVE ENGINE service (Phase 9). Server-side only.
 *
 *   CRM EVENT → SCORING ENGINE → POINT LEDGER → PERFORMANCE/LEADERBOARD
 *             → [ INCENTIVE ENGINE (this) ] → INCENTIVE RESULT
 *
 * It CONSUMES the authoritative Phase-8 performance snapshot (points + metrics +
 * rule attribution) and decides scheme / eligibility / reward. It NEVER scores,
 * never re-computes points, and NEVER writes payroll / salary / a payment.
 *
 * Schemes are versioned exactly like scoring rules (immutable versions, half-open
 * effective-date windows keyed on the period start). Editing appends a new
 * version — historical `incentive_results` keep the version they were calculated
 * against. Calculation is idempotent on
 * `<schemeId>:<schemeVersion>:<userId>:<from>:<to>`; a re-run replaces a
 * non-finalized result and returns an APPROVED/FINALIZED one unchanged.
 *
 * Lifecycle: CALCULATED → REVIEWED → APPROVED → FINALIZED  (+ REVERSED).
 *   create scheme / edit / enable / dry-run / calculate / review  → Admin + Closer
 *   approve / finalize / reverse                                   → Admin only
 */
import type { User } from "@/lib/db/schema";
import { getDb, isDbConfigured } from "@/lib/db";
import { recordAudit } from "../audit";
import { HttpError } from "../http-error";
import { nowIST } from "../time";
import {
  assertCanFinalizeIncentive,
  assertCanRunOperations,
  canRunOperations,
} from "../authz/operations";
import { canManageGamification } from "../authz/gamification";
import { selectVersionForDate } from "../scoring/versions";
import * as repo from "../db/repos/incentive";
import { getUserById } from "../db/repos/users";
import {
  resolvePerformancePeriod,
  buildIncentiveSnapshotRows,
  type PeriodInput,
} from "../gamification/performance";
import { currentShiftDate } from "../time";
import { validateConditionTree, type ConditionNode } from "./conditions";
import { validateReward } from "./reward";
import {
  combineResults,
  evaluateScheme,
  type CombineMode,
  type EmployeeSnapshotRow,
  type SchemeVersionConfig,
} from "./evaluator";

type Meta = { ip?: string | null; userAgent?: string | null };
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
const asJson = (v: unknown): JsonValue => (v ?? null) as JsonValue;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------ schemes ---------------------------- */

export interface SchemeDraft {
  name: string;
  description?: string | null;
  periodType: "daily" | "weekly" | "monthly" | "custom";
  priority?: number;
  combineMode?: CombineMode;
  scope?: Record<string, unknown> | null;
  eligibility?: ConditionNode | null;
  reward: unknown;
  /** "YYYY-MM-DD" operational date this (version of the) scheme starts from */
  effectiveFrom: string;
  currency?: string;
}

export function validateSchemeDraft(d: SchemeDraft): string[] {
  const errs: string[] = [];
  if (typeof d.name !== "string" || d.name.trim().length === 0 || d.name.length > 120)
    errs.push("name_invalid");
  if (!["daily", "weekly", "monthly", "custom"].includes(d.periodType))
    errs.push("period_type_invalid");
  if (!YMD.test(d.effectiveFrom)) errs.push("effective_from_invalid");
  if (
    d.priority !== undefined &&
    (!Number.isInteger(d.priority) || d.priority < 0 || d.priority > 100_000)
  )
    errs.push("priority_out_of_range");
  if (
    d.combineMode !== undefined &&
    !["independent", "exclusive", "highest"].includes(d.combineMode)
  )
    errs.push("combine_mode_invalid");
  errs.push(...validateConditionTree(d.eligibility ?? null).map((e) => `eligibility:${e}`));
  errs.push(...validateReward(d.reward).map((e) => `reward:${e}`));
  return errs;
}

export interface SchemeDTO {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  periodType: string;
  priority: number;
  combineMode: string;
  currentVersion: number;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  versions: {
    id: number;
    version: number;
    nameSnapshot: string;
    periodTypeSnapshot: string;
    scope: JsonValue;
    eligibility: JsonValue;
    reward: JsonValue;
    currency: string;
    effectiveFrom: string;
    effectiveUntil: string | null;
    createdByUserId: number | null;
    createdAt: string;
  }[];
}

async function schemeToDTO(id: number): Promise<SchemeDTO> {
  const s = await repo.getScheme(id);
  if (!s) throw new HttpError(404, "Scheme not found", "not_found");
  const versions = await repo.getVersionsForScheme(id);
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? null,
    enabled: s.enabled,
    periodType: s.periodType,
    priority: s.priority,
    combineMode: s.combineMode,
    currentVersion: s.currentVersion,
    createdByUserId: s.createdByUserId ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      nameSnapshot: v.nameSnapshot,
      periodTypeSnapshot: v.periodTypeSnapshot,
      scope: asJson(v.scope),
      eligibility: asJson(v.eligibility),
      reward: asJson(v.reward),
      currency: v.currency,
      effectiveFrom: v.effectiveFrom,
      effectiveUntil: v.effectiveUntil ?? null,
      createdByUserId: v.createdByUserId ?? null,
      createdAt: v.createdAt,
    })),
  };
}

export async function listIncentiveSchemes(
  actor: Pick<User, "role">,
): Promise<{ dbUnavailable?: boolean; schemes: SchemeDTO[] }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) return { dbUnavailable: true, schemes: [] };
  const rows = await repo.listSchemes();
  const schemes: SchemeDTO[] = [];
  for (const r of rows) schemes.push(await schemeToDTO(r.id));
  return { schemes };
}

export async function createIncentiveScheme(
  actor: Pick<User, "id" | "role">,
  draft: SchemeDraft,
  meta: Meta = {},
): Promise<{ schemeId: number; version: number }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const errs = validateSchemeDraft(draft);
  if (errs.length) throw new HttpError(400, `Invalid scheme: ${errs.join(", ")}`, "invalid_scheme");

  const db = getDb();
  const now = nowIST();
  const currency = (draft.currency || "INR").slice(0, 8);
  const schemeId = await repo.insertScheme(
    {
      name: draft.name.trim().slice(0, 120),
      description: draft.description?.trim().slice(0, 400) ?? null,
      enabled: false, // always created disabled — enable after a dry run
      periodType: draft.periodType,
      priority: draft.priority ?? 100,
      combineMode: draft.combineMode ?? "independent",
      currentVersion: 1,
      createdByUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    },
    db,
  );
  await repo.insertSchemeVersion(
    {
      schemeId,
      version: 1,
      nameSnapshot: draft.name.trim().slice(0, 120),
      periodTypeSnapshot: draft.periodType,
      scope: (draft.scope ?? null) as never,
      eligibility: (draft.eligibility ?? null) as never,
      reward: draft.reward as never,
      currency,
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
    action: "INCENTIVE_SCHEME_CREATED",
    entityType: "incentive_scheme",
    entityId: schemeId,
    metadata: {
      before: null,
      after: {
        name: draft.name,
        periodType: draft.periodType,
        combineMode: draft.combineMode ?? "independent",
        priority: draft.priority ?? 100,
        effectiveFrom: draft.effectiveFrom,
      },
      success: true,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { schemeId, version: 1 };
}

export async function updateIncentiveScheme(
  actor: Pick<User, "id" | "role">,
  schemeId: number,
  draft: SchemeDraft,
  meta: Meta = {},
): Promise<{ schemeId: number; version: number }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const errs = validateSchemeDraft(draft);
  if (errs.length) throw new HttpError(400, `Invalid scheme: ${errs.join(", ")}`, "invalid_scheme");
  const db = getDb();
  const scheme = await repo.getScheme(schemeId);
  if (!scheme) throw new HttpError(404, "Scheme not found", "not_found");
  const versions = await repo.getVersionsForScheme(schemeId);
  const latest = versions.reduce((m, v) => (v.version > m ? v.version : m), 0);
  const openFrom = versions
    .filter((v) => v.effectiveUntil == null)
    .map((v) => v.effectiveFrom)
    .sort()
    .pop();
  if (openFrom && draft.effectiveFrom <= openFrom) {
    throw new HttpError(
      400,
      "effectiveFrom must be after the currently-open version's start (historical results are preserved)",
      "bad_effective_from",
    );
  }
  const now = nowIST();
  const nextVersion = latest + 1;
  const currency = (draft.currency || versions[0]?.currency || "INR").slice(0, 8);
  await repo.closeOpenSchemeVersionAt(schemeId, draft.effectiveFrom, db);
  await repo.insertSchemeVersion(
    {
      schemeId,
      version: nextVersion,
      nameSnapshot: draft.name.trim().slice(0, 120),
      periodTypeSnapshot: draft.periodType,
      scope: (draft.scope ?? null) as never,
      eligibility: (draft.eligibility ?? null) as never,
      reward: draft.reward as never,
      currency,
      effectiveFrom: draft.effectiveFrom,
      effectiveUntil: null,
      createdByUserId: actor.id,
      createdAt: now,
    },
    db,
  );
  await repo.updateSchemeHeader(
    schemeId,
    {
      name: draft.name.trim().slice(0, 120),
      description: draft.description?.trim().slice(0, 400) ?? null,
      periodType: draft.periodType,
      priority: draft.priority ?? scheme.priority,
      combineMode: draft.combineMode ?? (scheme.combineMode as CombineMode),
      currentVersion: nextVersion,
      updatedAt: now,
    },
    db,
  );
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "INCENTIVE_SCHEME_UPDATED",
    entityType: "incentive_scheme",
    entityId: schemeId,
    metadata: {
      before: { version: latest },
      after: { version: nextVersion, effectiveFrom: draft.effectiveFrom },
      success: true,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { schemeId, version: nextVersion };
}

export async function setIncentiveSchemeEnabled(
  actor: Pick<User, "id" | "role">,
  schemeId: number,
  enabled: boolean,
  meta: Meta = {},
): Promise<{ ok: true }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const scheme = await repo.getScheme(schemeId);
  if (!scheme) throw new HttpError(404, "Scheme not found", "not_found");
  await repo.updateSchemeHeader(schemeId, { enabled, updatedAt: nowIST() });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: enabled ? "INCENTIVE_SCHEME_ENABLED" : "INCENTIVE_SCHEME_DISABLED",
    entityType: "incentive_scheme",
    entityId: schemeId,
    metadata: { before: { enabled: scheme.enabled }, after: { enabled }, success: true },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true };
}

/* ------------------------- evaluation core ------------------------ */

function toEmployeeRow(r: {
  userId: number;
  name: string;
  role: "agent" | "closer";
  process: string;
  points: number;
  metrics: EmployeeSnapshotRow["metrics"];
  ruleBreakdown: EmployeeSnapshotRow["ruleBreakdown"];
}): EmployeeSnapshotRow {
  return {
    userId: r.userId,
    name: r.name,
    role: r.role,
    process: r.process,
    team: null,
    points: r.points,
    metrics: r.metrics,
    ruleBreakdown: r.ruleBreakdown,
  };
}

function versionConfig(
  scheme: { id: number },
  v: {
    version: number;
    nameSnapshot: string;
    scope: unknown;
    eligibility: unknown;
    reward: unknown;
    currency: string;
  },
): SchemeVersionConfig {
  return {
    schemeId: scheme.id,
    version: v.version,
    name: v.nameSnapshot,
    scope: (v.scope ?? null) as SchemeVersionConfig["scope"],
    eligibility: (v.eligibility ?? null) as ConditionNode | null,
    reward: v.reward,
    currency: v.currency,
  };
}

/* ------------------------------ dry run --------------------------- */

export interface DryRunInput extends PeriodInput {
  schemeId: number;
  userId: number;
  process?: string;
}

export async function dryRunIncentive(
  actor: Pick<User, "id" | "role" | "process">,
  input: DryRunInput,
  meta: Meta = {},
) {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const period = resolvePerformancePeriod(currentShiftDate(actor.process), input);
  const scheme = await repo.getScheme(input.schemeId);
  if (!scheme) throw new HttpError(404, "Scheme not found", "not_found");
  const versions = await repo.getVersionsForScheme(input.schemeId);
  const selected = selectVersionForDate(
    versions.map((v) => ({
      version: v.version,
      effectiveFrom: v.effectiveFrom,
      effectiveUntil: v.effectiveUntil ?? null,
      raw: v,
    })),
    period.from ?? currentShiftDate(actor.process),
  );
  if (!selected) {
    return { period, scheme: { id: scheme.id, name: scheme.name }, version: null, result: null };
  }
  const rows = await buildIncentiveSnapshotRows(period.from, period.to, input.process);
  const target = rows.find((r) => r.userId === input.userId);
  const cfg = versionConfig(scheme, selected.raw);
  const evaluation = target
    ? evaluateScheme(cfg, toEmployeeRow(target))
    : evaluateScheme(cfg, {
        userId: input.userId,
        name: (await getUserById(input.userId))?.fullName ?? String(input.userId),
        role: "agent",
        process: input.process ?? actor.process,
        points: 0,
        metrics: { leadsSubmitted: 0, leadsAccepted: 0, followUps: 0, sales: 0, scoredLeads: 0 },
        ruleBreakdown: [],
      });

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "INCENTIVE_CALCULATION_RUN",
    entityType: "incentive_dry_run",
    entityId: scheme.id,
    metadata: {
      dryRun: true,
      schemeVersion: selected.version,
      userId: input.userId,
      period: { from: period.from, to: period.to },
      eligibility: evaluation.eligibility,
      rewardAmount: evaluation.rewardAmount,
      success: true,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return {
    period,
    scheme: { id: scheme.id, name: scheme.name },
    version: selected.version,
    result: evaluation,
  };
}

/* --------------------------- live calc --------------------------- */

export interface CalculateInput extends PeriodInput {
  /** one scheme, or omit for every ENABLED scheme */
  schemeId?: number;
  process?: string;
  /** restrict to specific employees (default: everyone in the snapshot) */
  userIds?: number[];
}

export interface CalcResultDTO {
  id: number | null;
  schemeId: number;
  schemeName: string;
  schemeVersion: number;
  userId: number;
  userName: string;
  status: string;
  points: number;
  rewardKind: string;
  rewardAmount: number;
  currency: string;
  rewardLabel: string | null;
  superseded: boolean;
  explanation: JsonValue;
}

export async function calculateIncentives(
  actor: Pick<User, "id" | "role" | "process">,
  input: CalculateInput,
  meta: Meta = {},
): Promise<{ period: { from: string | null; to: string | null }; results: CalcResultDTO[] }> {
  assertCanRunOperations(actor.role);
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const period = resolvePerformancePeriod(currentShiftDate(actor.process), input);
  const from = period.from ?? currentShiftDate(actor.process);
  const to = period.to ?? from;

  const schemes = input.schemeId
    ? [await repo.getScheme(input.schemeId)].filter(Boolean)
    : await repo.listEnabledSchemes();
  if (input.schemeId && schemes.length === 0)
    throw new HttpError(404, "Scheme not found", "not_found");

  const snapshot = await buildIncentiveSnapshotRows(from, to, input.process);
  const targets =
    input.userIds && input.userIds.length
      ? snapshot.filter((r) => input.userIds!.includes(r.userId))
      : snapshot;

  const now = nowIST();
  const out: CalcResultDTO[] = [];
  let replaced = 0;
  let created = 0;

  // per employee: evaluate every applicable scheme, then combine
  const byUser = new Map<number, typeof targets>();
  for (const r of targets) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);

  for (const [userId, rowsForUser] of byUser) {
    const emp = toEmployeeRow(rowsForUser[0]!);
    const perScheme: {
      schemeId: number;
      schemeName: string;
      combineMode: CombineMode;
      priority: number;
      version: number;
      currency: string;
      evaluation: ReturnType<typeof evaluateScheme>;
    }[] = [];

    for (const s of schemes as NonNullable<(typeof schemes)[number]>[]) {
      const versions = await repo.getVersionsForScheme(s.id);
      const selected = selectVersionForDate(
        versions.map((v) => ({
          version: v.version,
          effectiveFrom: v.effectiveFrom,
          effectiveUntil: v.effectiveUntil ?? null,
          raw: v,
        })),
        from,
      );
      if (!selected) continue;
      const cfg = versionConfig(s, selected.raw);
      perScheme.push({
        schemeId: s.id,
        schemeName: s.name,
        combineMode: s.combineMode as CombineMode,
        priority: s.priority,
        version: selected.version,
        currency: selected.raw.currency,
        evaluation: evaluateScheme(cfg, emp),
      });
    }

    const combined = combineResults(
      perScheme.map((p) => ({
        combineMode: p.combineMode,
        priority: p.priority,
        evaluation: p.evaluation,
      })),
    );

    for (const c of combined) {
      const meta2 = perScheme.find((p) => p.schemeId === c.schemeId)!;
      const status = c.superseded
        ? "NO_MATCH"
        : c.eligibility === "OUT_OF_SCOPE"
          ? "OUT_OF_SCOPE"
          : c.eligibility === "NOT_ELIGIBLE"
            ? "NOT_ELIGIBLE"
            : "CALCULATED";
      const dedupeKey = `${c.schemeId}:${c.schemeVersion}:${userId}:${from}:${to}`;
      const existing = await repo.getResultByDedupe(dedupeKey, db);
      const payload = {
        schemeId: c.schemeId,
        schemeVersion: c.schemeVersion,
        userId,
        periodFrom: from,
        periodTo: to,
        status,
        points: c.points,
        rewardKind: c.rewardKind,
        rewardAmount: c.rewardAmount,
        currency: meta2.currency || "INR",
        rewardLabel: c.rewardLabel ?? null,
        metrics: emp.metrics as never,
        explanation: c.explanation as never,
        dedupeKey,
        calculatedByUserId: actor.id,
        calculatedAt: now,
        updatedAt: now,
      };

      let resultId: number | null = null;
      if (!existing) {
        resultId = await repo.insertResult({ ...payload, createdAt: now } as never, db);
        created++;
      } else if (["APPROVED", "FINALIZED", "REVERSED"].includes(existing.status)) {
        // historical / finalized — never overwritten. Return it unchanged.
        resultId = existing.id;
      } else {
        // CALCULATED / REVIEWED / NOT_ELIGIBLE / NO_MATCH / OUT_OF_SCOPE — safe to replace
        await repo.updateResult(existing.id, payload as never, db);
        resultId = existing.id;
        replaced++;
        await recordAudit({
          actorUserId: actor.id,
          actorRole: actor.role,
          action: "INCENTIVE_RESULT_RECALCULATED",
          entityType: "incentive_result",
          entityId: existing.id,
          metadata: {
            before: { status: existing.status, rewardAmount: existing.rewardAmount },
            after: { status, rewardAmount: c.rewardAmount },
            success: true,
          },
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        });
      }

      out.push({
        id: resultId,
        schemeId: c.schemeId,
        schemeName: meta2.schemeName,
        schemeVersion: c.schemeVersion,
        userId,
        userName: emp.name,
        status: existing ? existing.status : status,
        points: c.points,
        rewardKind: c.rewardKind,
        rewardAmount:
          existing && ["APPROVED", "FINALIZED", "REVERSED"].includes(existing.status)
            ? existing.rewardAmount
            : c.rewardAmount,
        currency: meta2.currency || "INR",
        rewardLabel: c.rewardLabel ?? null,
        superseded: c.superseded,
        explanation: asJson(c.explanation),
      });
    }
  }

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "INCENTIVE_CALCULATION_RUN",
    entityType: "incentive_calculation",
    entityId: input.schemeId ?? 0,
    metadata: {
      dryRun: false,
      period: { from, to },
      schemes: (schemes as { id: number }[]).map((s) => s.id),
      employees: byUser.size,
      resultsCreated: created,
      resultsReplaced: replaced,
      success: true,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { period: { from, to }, results: out };
}

/* ---------------------------- lifecycle -------------------------- */

async function transitionResult(
  actor: Pick<User, "id" | "role">,
  resultId: number,
  to: "REVIEWED" | "APPROVED" | "FINALIZED" | "REVERSED",
  reason: string | undefined,
  meta: Meta,
): Promise<{ ok: true; status: string }> {
  // gate FIRST (before any DB / row lookup): review = Ops; approve/finalize/reverse = Admin only
  if (to === "REVIEWED") assertCanRunOperations(actor.role);
  else assertCanFinalizeIncentive(actor.role);

  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const row = await repo.getResultById(resultId, db);
  if (!row) throw new HttpError(404, "Incentive result not found", "not_found");

  const isPay = ["ELIGIBLE"].includes(row.status);

  const legal: Record<string, string[]> = {
    REVIEWED: ["CALCULATED"],
    APPROVED: ["CALCULATED", "REVIEWED"],
    FINALIZED: ["APPROVED"],
    REVERSED: ["FINALIZED"],
  };
  if (!legal[to]!.includes(row.status)) {
    throw new HttpError(
      409,
      `Cannot move an incentive result from ${row.status} to ${to}`,
      "bad_transition",
    );
  }
  if (["NOT_ELIGIBLE", "NO_MATCH", "OUT_OF_SCOPE"].includes(row.status)) {
    throw new HttpError(409, "A non-eligible result cannot be reviewed / approved", "not_payable");
  }

  const now = nowIST();
  const patch: Record<string, unknown> = { status: to, updatedAt: now };
  if (reason) patch["reason"] = reason.slice(0, 255);
  if (to === "REVIEWED") {
    patch["reviewedByUserId"] = actor.id;
    patch["reviewedAt"] = now;
  } else if (to === "APPROVED") {
    patch["approvedByUserId"] = actor.id;
    patch["approvedAt"] = now;
  } else if (to === "FINALIZED") {
    patch["finalizedByUserId"] = actor.id;
    patch["finalizedAt"] = now;
  } else if (to === "REVERSED") {
    patch["reversedByUserId"] = actor.id;
    patch["reversedAt"] = now;
  }
  await repo.updateResult(resultId, patch as never, db);

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action:
      to === "REVIEWED"
        ? "INCENTIVE_RESULT_REVIEWED"
        : to === "APPROVED"
          ? "INCENTIVE_RESULT_APPROVED"
          : to === "FINALIZED"
            ? "INCENTIVE_RESULT_FINALIZED"
            : "INCENTIVE_RESULT_REVERSED",
    entityType: "incentive_result",
    entityId: resultId,
    metadata: {
      before: { status: row.status, rewardAmount: row.rewardAmount, payable: isPay },
      after: { status: to },
      reason: reason ?? null,
      success: true,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, status: to };
}

export const reviewIncentiveResult = (
  actor: Pick<User, "id" | "role">,
  resultId: number,
  reason?: string,
  meta: Meta = {},
) => transitionResult(actor, resultId, "REVIEWED", reason, meta);
export const approveIncentiveResult = (
  actor: Pick<User, "id" | "role">,
  resultId: number,
  reason?: string,
  meta: Meta = {},
) => transitionResult(actor, resultId, "APPROVED", reason, meta);
export const finalizeIncentiveResult = (
  actor: Pick<User, "id" | "role">,
  resultId: number,
  reason?: string,
  meta: Meta = {},
) => transitionResult(actor, resultId, "FINALIZED", reason, meta);
export const reverseIncentiveResult = (
  actor: Pick<User, "id" | "role">,
  resultId: number,
  reason?: string,
  meta: Meta = {},
) => transitionResult(actor, resultId, "REVERSED", reason, meta);

/* --------------------------- read views ------------------------- */

export interface ResultRowDTO {
  id: number;
  schemeId: number;
  schemeVersion: number;
  userId: number;
  periodFrom: string;
  periodTo: string;
  status: string;
  points: number;
  rewardKind: string;
  rewardAmount: number;
  currency: string;
  rewardLabel: string | null;
  metrics: JsonValue;
  explanation: JsonValue;
  reason: string | null;
  calculatedByUserId: number | null;
  calculatedAt: string;
  reviewedByUserId: number | null;
  approvedByUserId: number | null;
  finalizedByUserId: number | null;
  reversedByUserId: number | null;
}

function resultToDTO(r: Awaited<ReturnType<typeof repo.listResults>>[number]): ResultRowDTO {
  return {
    id: r.id,
    schemeId: r.schemeId,
    schemeVersion: r.schemeVersion,
    userId: r.userId,
    periodFrom: r.periodFrom,
    periodTo: r.periodTo,
    status: r.status,
    points: r.points,
    rewardKind: r.rewardKind,
    rewardAmount: r.rewardAmount,
    currency: r.currency,
    rewardLabel: r.rewardLabel ?? null,
    metrics: asJson(r.metrics),
    explanation: asJson(r.explanation),
    reason: r.reason ?? null,
    calculatedByUserId: r.calculatedByUserId ?? null,
    calculatedAt: r.calculatedAt,
    reviewedByUserId: r.reviewedByUserId ?? null,
    approvedByUserId: r.approvedByUserId ?? null,
    finalizedByUserId: r.finalizedByUserId ?? null,
    reversedByUserId: r.reversedByUserId ?? null,
  };
}

export async function listIncentiveResults(
  actor: Pick<User, "id" | "role">,
  filter: {
    schemeId?: number | undefined;
    userId?: number | undefined;
    status?: string[] | undefined;
    from?: string | undefined;
    to?: string | undefined;
  } = {},
): Promise<{ dbUnavailable?: boolean; selfOnly: boolean; results: ResultRowDTO[] }> {
  const ops = canRunOperations(actor.role) || canManageGamification(actor.role);
  const selfOnly = !ops;
  if (!isDbConfigured()) return { dbUnavailable: true, selfOnly, results: [] };
  const f = { ...filter };
  if (selfOnly) f.userId = actor.id; // agent → own results only
  const rows = await repo.listResults(f);
  return { selfOnly, results: rows.map(resultToDTO) };
}

/** Agent self view — own incentive status for a period (from live results). */
export async function myIncentive(
  user: Pick<User, "id" | "role" | "process">,
  input: PeriodInput,
): Promise<{
  dbUnavailable?: boolean;
  period: { from: string | null; to: string | null };
  results: ResultRowDTO[];
}> {
  const period = resolvePerformancePeriod(currentShiftDate(user.process), input);
  if (!isDbConfigured()) return { dbUnavailable: true, period, results: [] };
  const rows = await repo.listResults({
    userId: user.id,
    ...(period.from ? { from: period.from } : {}),
    ...(period.to ? { to: period.to } : {}),
  });
  return { period, results: rows.map(resultToDTO) };
}
