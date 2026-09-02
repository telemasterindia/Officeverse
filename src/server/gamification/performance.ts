/**
 * Officeverse — PERFORMANCE INTELLIGENCE (Phase 8).
 *
 * A business-facing VISIBILITY layer over the EXISTING authoritative point
 * ledger (`gamification_point_transactions`) + the Phase-20 leaderboard
 * primitives. It reads and aggregates; it NEVER awards, recalculates, or
 * duplicates scoring logic, and it hard-codes NO point value / threshold /
 * employee id / incentive amount.
 *
 *   EVENT → SCORING RULE → POINTS → [ LEADERBOARD (this) ] → INCENTIVE (Phase 9) → RECOGNITION
 *
 * Phase 8 does NOT own incentive calculation. `incentiveReadySnapshot()` is the
 * clean handoff shape Phase 9 will consume without rewriting anything here.
 *
 * DATE SEMANTICS: every metric here is derived from the point ledger and uses
 * `operational_date` (the server shift date the Scoring Engine stamped) — never
 * `createdAt`, `occurredAt`, or a browser clock.
 */
import type { User } from "@/lib/db/schema";
import { getDb, isDbConfigured } from "@/lib/db";
import { HttpError } from "../http-error";
import { currentShiftDate } from "../time";
import { canManageGamification } from "../authz/gamification";
import { canRunOperations } from "../authz/operations";
import * as repo from "../db/repos/gamification";
import {
  customWindow,
  rankLeaderboard,
  rankOf,
  windowBounds,
  type LeaderboardRow,
  type WindowBounds,
} from "./leaderboard";

/* ------------------------------ period ------------------------------ */

export const PERFORMANCE_PERIODS = ["today", "week", "month", "custom"] as const;
export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number];

export interface ResolvedPeriod {
  period: PerformancePeriod;
  from: string | null;
  to: string | null;
  /** the server operational date the window was anchored on */
  anchor: string;
}

export interface PeriodInput {
  period?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * Resolve a period to an inclusive operational-date window. Deterministic:
 * anchored on the caller's server shift date, never the browser clock.
 *   today  → windowBounds("daily")
 *   week   → windowBounds("weekly")   (Mon..Sun ISO week)
 *   month  → windowBounds("monthly")  (calendar month)
 *   custom → explicit from..to (both required, from <= to)
 */
/** scheme-style aliases (`daily/weekly/monthly`) → the Phase-8 period names */
const PERIOD_ALIAS: Readonly<Record<string, PerformancePeriod>> = {
  daily: "today",
  weekly: "week",
  monthly: "month",
};

export function resolvePerformancePeriod(anchorDate: string, input: PeriodInput): ResolvedPeriod {
  const raw = input.period ?? "";
  const mapped = PERIOD_ALIAS[raw] ?? raw;
  const period = (PERFORMANCE_PERIODS as readonly string[]).includes(mapped)
    ? (mapped as PerformancePeriod)
    : "today";
  let win: WindowBounds;
  if (period === "custom") {
    if (!input.from || !input.to) {
      throw new HttpError(400, "A custom period needs 'from' and 'to' dates", "bad_range");
    }
    win = customWindow(input.from, input.to);
  } else {
    win = windowBounds(
      period === "today" ? "daily" : period === "week" ? "weekly" : "monthly",
      anchorDate,
    );
  }
  return { period, from: win.from, to: win.to, anchor: anchorDate };
}

/* --------------------------- authorization -------------------------- */

/** Full performance visibility = Admin OR the Operations Manager (Closer). */
function assertOperationsView(role: string): void {
  if (!canRunOperations(role)) {
    throw new HttpError(
      403,
      "Full performance visibility is limited to Admin and the Operations Manager (Closer)",
      "forbidden",
    );
  }
}

/** Drill-down: self, OR Admin/HR (existing gamification boundary), OR the
 *  Operations Manager (Closer, Phase 8). Never widens HR/agent beyond this. */
function assertCanViewEmployee(actor: Pick<User, "id" | "role">, targetUserId: number): void {
  if (
    actor.id === targetUserId ||
    canManageGamification(actor.role) ||
    canRunOperations(actor.role)
  ) {
    return;
  }
  throw new HttpError(403, "You can only view your own performance detail", "forbidden");
}

/* ------------------------------ DTOs ------------------------------- */

export interface PerformanceRow {
  rank: number;
  userId: number;
  name: string;
  role: "agent" | "closer";
  process: string;
  photoAvailable: boolean;
  points: number;
  leadsSubmitted: number;
  leadsAccepted: number;
  followUps: number;
  sales: number;
  /** ledger rows attributed to a Scoring-Engine rule (rule_id not null) */
  scoredLeads: number;
  /** Phase 9 owns the real value — surfaced here as a placeholder only */
  incentiveStatus: "pending_phase_9";
}

export interface PerformanceCards {
  totalPoints: number;
  totalLeadsSubmitted: number;
  totalLeadsAccepted: number;
  totalSales: number;
  participants: number;
  topPerformer: { userId: number; name: string; points: number } | null;
  mostLeadsAccepted: { userId: number; name: string; count: number } | null;
  mostLeadsSubmitted: { userId: number; name: string; count: number } | null;
  /** deferred — needs a defensible comparison period + a prior snapshot store */
  mostImproved: null;
  /** deferred — needs an authoritative high-value signal; see the rule breakdown */
  mostHighValueLeads: null;
}

export interface PerformanceLeaderboard {
  dbUnavailable?: boolean;
  period: ResolvedPeriod;
  process: string | null;
  ranking: PerformanceRow[];
  cards: PerformanceCards;
  myRank: number | null;
  /** true when the caller is an Agent → `ranking` is their own row only */
  selfOnly: boolean;
  /** ranking convention, surfaced so a manager can explain the order */
  rankingRule: string;
}

const RANKING_RULE = "points DESC, then userId ASC (standard competition ranks 1,2,2,4)";

function toRows(ranked: LeaderboardRow[]): PerformanceRow[] {
  return ranked.map((r) => ({
    rank: r.rank,
    userId: r.userId,
    name: r.name,
    role: r.role,
    process: r.process,
    photoAvailable: r.photoAvailable ?? false,
    points: r.points,
    leadsSubmitted: r.leadsSubmitted ?? 0,
    leadsAccepted: r.leadsAccepted ?? 0,
    followUps: r.followUps ?? 0,
    sales: r.sales ?? 0,
    scoredLeads: r.scoredLeads ?? 0,
    incentiveStatus: "pending_phase_9" as const,
  }));
}

function buildCards(agg: repo.PerformanceAggRow[]): PerformanceCards {
  const sum = (k: keyof repo.PerformanceAggRow) =>
    agg.reduce((a, r) => a + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
  const maxBy = (k: keyof repo.PerformanceAggRow) =>
    agg.reduce<repo.PerformanceAggRow | null>(
      (best, r) =>
        !best ||
        (r[k] as number) > (best[k] as number) ||
        ((r[k] as number) === (best[k] as number) && r.userId < best.userId)
          ? r
          : best,
      null,
    );
  const top = maxBy("points");
  const acc = maxBy("leadsAccepted");
  const sub = maxBy("leadsSubmitted");
  return {
    totalPoints: sum("points"),
    totalLeadsSubmitted: sum("leadsSubmitted"),
    totalLeadsAccepted: sum("leadsAccepted"),
    totalSales: sum("sales"),
    participants: agg.length,
    topPerformer:
      top && top.points > 0 ? { userId: top.userId, name: top.name, points: top.points } : null,
    mostLeadsAccepted:
      acc && acc.leadsAccepted > 0
        ? { userId: acc.userId, name: acc.name, count: acc.leadsAccepted }
        : null,
    mostLeadsSubmitted:
      sub && sub.leadsSubmitted > 0
        ? { userId: sub.userId, name: sub.name, count: sub.leadsSubmitted }
        : null,
    mostImproved: null,
    mostHighValueLeads: null,
  };
}

export async function performanceLeaderboard(
  viewer: Pick<User, "id" | "role" | "process">,
  input: PeriodInput & { process?: string | undefined },
): Promise<PerformanceLeaderboard> {
  const anchor = currentShiftDate(viewer.process);
  const period = resolvePerformancePeriod(anchor, input);
  const selfOnly = !canRunOperations(viewer.role) && !canManageGamification(viewer.role);
  if (selfOnly && viewer.role !== "agent" && viewer.role !== "closer") {
    // any other role with no visibility → hard deny
    assertOperationsView(viewer.role);
  }

  if (!isDbConfigured()) {
    return {
      dbUnavailable: true,
      period,
      process: input.process ?? null,
      ranking: [],
      cards: buildCards([]),
      myRank: null,
      selfOnly,
      rankingRule: RANKING_RULE,
    };
  }

  const agg = await repo.performanceAggregate(period.from, period.to, { process: input.process });
  const ranked = rankLeaderboard(
    agg.map((r) => ({
      userId: r.userId,
      name: r.name,
      role: r.role,
      process: r.process,
      points: r.points,
      photoAvailable: r.photoAvailable,
      leadsSubmitted: r.leadsSubmitted,
      leadsAccepted: r.leadsAccepted,
      followUps: r.followUps,
      sales: r.sales,
      scoredLeads: r.scoredLeads,
    })),
  );
  const myRank = rankOf(ranked, viewer.id);
  const rows = toRows(ranked);
  return {
    period,
    process: input.process ?? null,
    ranking: selfOnly ? rows.filter((r) => r.userId === viewer.id) : rows,
    cards: selfOnly ? buildCards([]) : buildCards(agg),
    myRank,
    selfOnly,
    rankingRule: RANKING_RULE,
  };
}

/* ------------------------- employee drill-down ------------------------ */

export interface PerformanceEmployee {
  dbUnavailable?: boolean;
  userId: number;
  name: string;
  role: string;
  process: string;
  period: ResolvedPeriod;
  totalPoints: number;
  eventBreakdown: repo.EventBreakdownRow[];
  ruleBreakdown: repo.RuleBreakdownRow[];
  ledger: repo.LedgerRow[];
}

export async function performanceEmployee(
  actor: Pick<User, "id" | "role" | "process">,
  targetUserId: number,
  input: PeriodInput,
): Promise<PerformanceEmployee> {
  assertCanViewEmployee(actor, targetUserId);
  const anchor = currentShiftDate(actor.process);
  const period = resolvePerformancePeriod(anchor, input);
  if (!isDbConfigured()) {
    return {
      dbUnavailable: true,
      userId: targetUserId,
      name: "",
      role: "",
      process: "",
      period,
      totalPoints: 0,
      eventBreakdown: [],
      ruleBreakdown: [],
      ledger: [],
    };
  }
  const db = getDb();
  const { getUserById } = await import("../db/repos/users");
  const u = await getUserById(targetUserId);
  if (!u) throw new HttpError(404, "User not found", "not_found");

  const [total, events, rules, ledger] = await Promise.all([
    repo.sumActivePoints(targetUserId, period.from, period.to, db),
    repo.eventBreakdown(period.from, period.to, { userId: targetUserId }, db),
    repo.ruleBreakdown(period.from, period.to, { userId: targetUserId }, db),
    repo.userLedger(targetUserId, period.from, period.to, 400, db),
  ]);
  return {
    userId: u.id,
    name: u.fullName,
    role: u.role,
    process: u.process,
    period,
    totalPoints: total,
    eventBreakdown: events,
    ruleBreakdown: rules,
    ledger,
  };
}

/* ---------------------- event / rule breakdown ---------------------- */

export interface PerformanceBreakdown {
  dbUnavailable?: boolean;
  period: ResolvedPeriod;
  filters: { userId: number | null; process: string | null };
  byEvent: repo.EventBreakdownRow[];
  byRule: repo.RuleBreakdownRow[];
}

export async function performanceBreakdown(
  viewer: Pick<User, "id" | "role" | "process">,
  input: PeriodInput & { userId?: number; process?: string },
): Promise<PerformanceBreakdown> {
  assertOperationsView(viewer.role);
  const anchor = currentShiftDate(viewer.process);
  const period = resolvePerformancePeriod(anchor, input);
  const filters = { userId: input.userId ?? null, process: input.process ?? null };
  if (!isDbConfigured()) {
    return { dbUnavailable: true, period, filters, byEvent: [], byRule: [] };
  }
  const db = getDb();
  const f: { userId?: number; process?: string } = {};
  if (input.userId) f.userId = input.userId;
  if (input.process) f.process = input.process;
  const [byEvent, byRule] = await Promise.all([
    repo.eventBreakdown(period.from, period.to, f, db),
    repo.ruleBreakdown(period.from, period.to, f, db),
  ]);
  return { period, filters, byEvent, byRule };
}

/* --------------------- Phase 9 incentive handoff -------------------- */

export interface IncentiveSnapshotRow {
  userId: number;
  name: string;
  role: "agent" | "closer";
  process: string;
  points: number;
  metrics: {
    leadsSubmitted: number;
    leadsAccepted: number;
    followUps: number;
    sales: number;
    scoredLeads: number;
  };
  ruleBreakdown: repo.RuleBreakdownRow[];
}

export interface IncentiveSnapshot {
  dbUnavailable?: boolean;
  period: ResolvedPeriod;
  process: string | null;
  /** Phase 9 (Incentive Engine) consumes this — it is NOT an incentive result */
  rows: IncentiveSnapshotRow[];
  note: string;
}

/**
 * UNGUARDED builder for the incentive read model over a resolved window. The
 * Incentive Engine (Phase 9) calls this directly and applies its OWN role gate;
 * `incentiveReadySnapshot` below is the Operations-gated wrapper for the UI.
 * NO incentive amount / eligibility / payment logic here.
 */
export async function buildIncentiveSnapshotRows(
  from: string | null,
  to: string | null,
  process?: string,
): Promise<IncentiveSnapshotRow[]> {
  if (!isDbConfigured()) return [];
  const db = getDb();
  const agg = await repo.performanceAggregate(from, to, { process }, db);
  const rows: IncentiveSnapshotRow[] = [];
  for (const r of agg) {
    const rb = await repo.ruleBreakdown(from, to, { userId: r.userId }, db);
    rows.push({
      userId: r.userId,
      name: r.name,
      role: r.role,
      process: r.process,
      points: r.points,
      metrics: {
        leadsSubmitted: r.leadsSubmitted,
        leadsAccepted: r.leadsAccepted,
        followUps: r.followUps,
        sales: r.sales,
        scoredLeads: r.scoredLeads,
      },
      ruleBreakdown: rb,
    });
  }
  return rows;
}

/**
 * The clean data model Phase 9 reads to determine
 * `employee + period + points + qualifying metrics + applicable scheme`.
 * Operations-gated. NO incentive amount, eligibility, or payment logic.
 */
export async function incentiveReadySnapshot(
  viewer: Pick<User, "id" | "role" | "process">,
  input: PeriodInput & { process?: string },
): Promise<IncentiveSnapshot> {
  assertOperationsView(viewer.role);
  const anchor = currentShiftDate(viewer.process);
  const period = resolvePerformancePeriod(anchor, input);
  const note =
    "Phase-8 read model for the Incentive Engine. Contains authoritative points + " +
    "qualifying metrics + rule attribution per employee for the period. No incentive value is computed.";
  if (!isDbConfigured()) {
    return { dbUnavailable: true, period, process: input.process ?? null, rows: [], note };
  }
  const rows = await buildIncentiveSnapshotRows(period.from, period.to, input.process);
  return { period, process: input.process ?? null, rows, note };
}
