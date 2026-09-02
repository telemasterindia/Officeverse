/**
 * Officeverse — staff lookups needed by the Lead authorization/service layer.
 *
 * Data access only. Full agent/closer/client CRUD is a later phase; this file
 * holds just the reads Phase 3 requires (resolve the caller's agent/closer id,
 * hydrate agent/closer name+code onto Lead DTOs).
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type DBX } from "@/lib/db";
import {
  agents,
  closers,
  users,
  type Agent,
  type Closer,
  type NewUser,
  type User,
} from "@/lib/db/schema";
import { agentCode as fmtAgentCode, closerCode as fmtCloserCode, nextStaffSeq } from "../../ids";
import type { LeadActor } from "../../authz/leads";

/** Active closers (code + name + process), optionally scoped to one process.
 *  Used by the "assign to closer" picker on the new-lead form (Phase 24A). */
export async function listActiveClosers(
  process?: string,
): Promise<{ code: string; name: string; process: string }[]> {
  const conds = [eq(users.status, "active")];
  if (process) conds.push(eq(users.process, process as never));
  const rows = await getDb()
    .select({ code: closers.closerCode, name: users.fullName, process: users.process })
    .from(closers)
    .innerJoin(users, eq(users.id, closers.userId))
    .where(and(...conds))
    .orderBy(asc(users.fullName));
  return rows;
}

export async function getAgentByUserId(userId: number): Promise<Agent | undefined> {
  const rows = await getDb().select().from(agents).where(eq(agents.userId, userId)).limit(1);
  return rows[0];
}

export async function getCloserByUserId(userId: number): Promise<Closer | undefined> {
  const rows = await getDb().select().from(closers).where(eq(closers.userId, userId)).limit(1);
  return rows[0];
}

/**
 * The CURRENT canonical business Employee ID for a user — `agents.agent_code`
 * or `closers.closer_code`, the exact column Staff Directory / Agent List /
 * Presence / Assignments / Exports read. Never `users.id`, never generated.
 *
 * A promoted Agent→Closer resolves to their Closer code (the row that matches
 * their live `users.role`); the historical `agents` row is ignored. Admin / HR
 * get a code only if they actually have a staff record. `null` when the user
 * has no agent/closer profile at all.
 */
export async function employeeCodeForUser(
  userId: number,
  role: string,
  ex: DBX = getDb(),
): Promise<string | null> {
  const agentCodeRow = async () =>
    (
      await ex
        .select({ code: agents.agentCode })
        .from(agents)
        .where(eq(agents.userId, userId))
        .limit(1)
    )[0]?.code ?? null;
  const closerCodeRow = async () =>
    (
      await ex
        .select({ code: closers.closerCode })
        .from(closers)
        .where(eq(closers.userId, userId))
        .limit(1)
    )[0]?.code ?? null;

  // current identity first — the staff row matching the live role
  if (role === "closer") return (await closerCodeRow()) ?? (await agentCodeRow());
  if (role === "agent") return (await agentCodeRow()) ?? (await closerCodeRow());
  // Admin / HR — only if a staff record exists (Closer preferred, then Agent)
  return (await closerCodeRow()) ?? (await agentCodeRow());
}

export async function getAgentByCode(code: string): Promise<Agent | undefined> {
  const rows = await getDb().select().from(agents).where(eq(agents.agentCode, code)).limit(1);
  return rows[0];
}

export async function getCloserByCode(code: string): Promise<Closer | undefined> {
  const rows = await getDb().select().from(closers).where(eq(closers.closerCode, code)).limit(1);
  return rows[0];
}

/** Agent row + its user (resolve the originating agent's process for the
 *  "eligible closers" picker on the New Lead form). */
export async function getAgentWithUserByCode(
  code: string,
): Promise<{ agent: Agent; user: User } | undefined> {
  const rows = await getDb()
    .select({ agent: agents, user: users })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .where(eq(agents.agentCode, code))
    .limit(1);
  return rows[0];
}

/** Closer row + its user (for the process-isolation check on assignment — a
 *  US Lead may only go to a US Closer, and vice-versa). */
export async function getCloserWithUserByCode(
  code: string,
): Promise<{ closer: Closer; user: User } | undefined> {
  const rows = await getDb()
    .select({ closer: closers, user: users })
    .from(closers)
    .innerJoin(users, eq(users.id, closers.userId))
    .where(eq(closers.closerCode, code))
    .limit(1);
  return rows[0];
}

/** Agent row + its user's process (needed to default a lead's shift date). */
export async function getAgentWithUser(
  agentId: number,
): Promise<{ agent: Agent; user: User } | undefined> {
  const rows = await getDb()
    .select({ agent: agents, user: users })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .where(eq(agents.id, agentId))
    .limit(1);
  return rows[0];
}

/** Closer row + its user (Phase 21 — recognition needs the closer's user id). */
export async function getCloserWithUser(
  closerId: number,
): Promise<{ closer: Closer; user: User } | undefined> {
  const rows = await getDb()
    .select({ closer: closers, user: users })
    .from(closers)
    .innerJoin(users, eq(users.id, closers.userId))
    .where(eq(closers.id, closerId))
    .limit(1);
  return rows[0];
}

export interface StaffMeta {
  code: string;
  name: string;
  /** the employee's process — needed to scope the lead → closer picker */
  process: string;
}

export async function loadAgentMeta(ids: number[]): Promise<Map<number, StaffMeta>> {
  const map = new Map<number, StaffMeta>();
  if (!ids.length) return map;
  const rows = await getDb()
    .select({ id: agents.id, code: agents.agentCode, name: users.fullName, process: users.process })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .where(inArray(agents.id, ids));
  for (const r of rows) map.set(r.id, { code: r.code, name: r.name, process: r.process });
  return map;
}

export async function loadCloserMeta(ids: number[]): Promise<Map<number, StaffMeta>> {
  const map = new Map<number, StaffMeta>();
  if (!ids.length) return map;
  const rows = await getDb()
    .select({
      id: closers.id,
      code: closers.closerCode,
      name: users.fullName,
      process: users.process,
    })
    .from(closers)
    .innerJoin(users, eq(users.id, closers.userId))
    .where(inArray(closers.id, ids));
  for (const r of rows) map.set(r.id, { code: r.code, name: r.name, process: r.process });
  return map;
}

export interface StaffCodeRef {
  id: number;
  userId: number;
  code: string;
}

/** Batch-resolve agent codes → { id, userId, code } (bulk import). */
export async function loadAgentsByCodes(codes: string[]): Promise<Map<string, StaffCodeRef>> {
  const map = new Map<string, StaffCodeRef>();
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return map;
  const rows = await getDb()
    .select({ id: agents.id, userId: agents.userId, code: agents.agentCode })
    .from(agents)
    .where(inArray(agents.agentCode, unique));
  for (const r of rows) map.set(r.code, r);
  return map;
}

/** Batch-resolve closer codes → { id, userId, code } (bulk import). */
export async function loadClosersByCodes(codes: string[]): Promise<Map<string, StaffCodeRef>> {
  const map = new Map<string, StaffCodeRef>();
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return map;
  const rows = await getDb()
    .select({ id: closers.id, userId: closers.userId, code: closers.closerCode })
    .from(closers)
    .where(inArray(closers.closerCode, unique));
  for (const r of rows) map.set(r.code, r);
  return map;
}

/** agents.id → users.id, for hydrating existing-lead ownership on import. */
export async function loadAgentUserIds(agentIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const unique = [...new Set(agentIds.filter((n) => Number.isFinite(n)))];
  if (!unique.length) return map;
  const rows = await getDb()
    .select({ id: agents.id, userId: agents.userId })
    .from(agents)
    .where(inArray(agents.id, unique));
  for (const r of rows) map.set(r.id, r.userId);
  return map;
}

/* ===================== staff directory CRUD (Phase 24A) ================== *
 * `users` + its 1:1 `agents` / `closers` profile row are the authoritative
 * employee records. Creation is Admin/HR-only and runs in one transaction.  */

export interface StaffRow {
  userId: number;
  staffId: number;
  code: string;
  kind: "agent" | "closer";
  fullName: string;
  email: string;
  phone: string | null;
  process: string;
  status: string;
  registeredOn: string;
  /** Admin UAT Batch-2 follow-up §2 — official joining date (agents only). */
  joiningDate: string | null;
  /** date of birth (both roles) */
  dob: string | null;
  /** work anniversary date (both roles) */
  anniversaryDate: string | null;
  photoAvailable: boolean;
}

const staffSelect = {
  userId: users.id,
  fullName: users.fullName,
  email: users.email,
  phone: users.phone,
  process: users.process,
  status: users.status,
  photoAssetId: users.photoAssetId,
};

/**
 * Next server-generated staff code, computed from the current max — the caller
 * never supplies it.
 *   agent  → `TMI_CC_###`. The sequence runs over the CANONICAL codes only;
 *            legacy `TMI_CC###` / `AG-#####` agents don't perturb it.
 *   closer → `TMI_CL_###`. Likewise, legacy `CL-#####` closers don't perturb it.
 * After the 0025 migration every current row is canonical, so the max is simply
 * the highest existing sequence number.
 */
/** Admin UAT §3/§4 — user ids of the agents + closers in one process. */
export async function staffUserIdsByProcess(process: string, ex: DBX = getDb()): Promise<number[]> {
  const rows = await ex
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.process, process as never), inArray(users.role, ["agent", "closer"])));
  return rows.map((r) => r.id);
}

export async function nextStaffCode(kind: "agent" | "closer", ex: DBX = getDb()): Promise<string> {
  // `MAX(...)` comes back from mysql2 as a string — `nextStaffSeq` coerces it,
  // but we also pass `?? 0` so an empty namespace starts at 1 (→ TMI_CC_001).
  if (kind === "agent") {
    const rows = await ex
      .select({
        max: sql<number | string | null>`max(case when left(${agents.agentCode}, 7) = 'TMI_CC_'
          then cast(substring(${agents.agentCode}, 8) as unsigned) else 0 end)`,
      })
      .from(agents);
    return fmtAgentCode(nextStaffSeq(rows[0]?.max ?? 0));
  }
  const rows = await ex
    .select({
      max: sql<number | string | null>`max(case when left(${closers.closerCode}, 7) = 'TMI_CL_'
        then cast(substring(${closers.closerCode}, 8) as unsigned) else 0 end)`,
    })
    .from(closers);
  return fmtCloserCode(nextStaffSeq(rows[0]?.max ?? 0));
}

export interface InsertStaffInput {
  kind: "agent" | "closer";
  user: Omit<NewUser, "createdAt" | "updatedAt">;
  code: string;
  dob: string | null;
  registeredOn: string;
  /** Admin UAT Batch-2 follow-up §2 — official joining date (agents only). */
  joiningDate?: string | null;
  now: string;
}

/** Insert a `users` row + its agent/closer profile in ONE transaction. */
export async function insertStaff(input: InsertStaffInput): Promise<StaffRow> {
  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({ ...input.user, createdAt: input.now, updatedAt: input.now })
      .$returningId();
    const userId = Number(inserted[0]?.id ?? 0);
    if (!userId) throw new Error("staff_user_insert_failed");

    if (input.kind === "agent") {
      await tx.insert(agents).values({
        userId,
        agentCode: input.code,
        dob: input.dob,
        registeredOn: input.registeredOn,
        joiningDate: input.joiningDate ?? null,
        createdAt: input.now,
        updatedAt: input.now,
      });
    } else {
      await tx.insert(closers).values({
        userId,
        closerCode: input.code,
        dob: input.dob,
        registeredOn: input.registeredOn,
        createdAt: input.now,
        updatedAt: input.now,
      });
    }

    return {
      userId,
      staffId: 0,
      code: input.code,
      kind: input.kind,
      fullName: input.user.fullName,
      email: input.user.email,
      phone: input.user.phone ?? null,
      process: String(input.user.process ?? "US"),
      status: String(input.user.status ?? "active"),
      registeredOn: input.registeredOn,
      joiningDate: input.kind === "agent" ? (input.joiningDate ?? null) : null,
      dob: input.dob,
      anniversaryDate: null,
      photoAvailable: false,
    };
  });
}

/**
 * The full agent OR closer directory.
 *
 * AUTHORITATIVE ROLE FILTER: a row is an "agent" only when `users.role = 'agent'`
 * (and a "closer" only when `users.role = 'closer'`) — NOT merely because an
 * `agents` / `closers` registry row exists. A promoted Agent keeps its historical
 * `agents` row for lead-ownership integrity but its `users.role` is now `closer`,
 * so it correctly leaves the agent directory and appears in the closer directory.
 *
 * `activeOnly` additionally restricts to `users.status = 'active'` — used for the
 * OPERATIONAL rosters (a deactivated / removed employee disappears). The plain
 * directory keeps inactive rows so Admin/HR can still edit or re-activate them.
 */
export async function listStaffRows(
  kind: "agent" | "closer",
  opts: { process?: string; q?: string; activeOnly?: boolean } = {},
): Promise<StaffRow[]> {
  const db = getDb();
  const conds = [eq(users.role, kind)];
  if (opts.activeOnly) conds.push(eq(users.status, "active"));
  if (opts.process) conds.push(eq(users.process, opts.process as never));
  if (opts.q && opts.q.trim()) {
    const term = `%${opts.q.trim()}%`;
    conds.push(sql`(${users.fullName} like ${term} or ${users.email} like ${term})`);
  }
  if (kind === "agent") {
    const rows = await db
      .select({
        ...staffSelect,
        staffId: agents.id,
        code: agents.agentCode,
        registeredOn: agents.registeredOn,
        joiningDate: agents.joiningDate,
        dob: agents.dob,
        anniversaryDate: agents.anniversaryDate,
      })
      .from(agents)
      .innerJoin(users, eq(users.id, agents.userId))
      .where(and(...conds))
      .orderBy(desc(agents.id));
    return rows.map((r) => ({
      userId: r.userId,
      staffId: r.staffId,
      code: r.code,
      kind: "agent" as const,
      fullName: r.fullName,
      email: r.email,
      phone: r.phone ?? null,
      process: r.process,
      status: r.status,
      registeredOn: r.registeredOn,
      joiningDate: r.joiningDate ?? null,
      dob: r.dob ?? null,
      anniversaryDate: r.anniversaryDate ?? null,
      photoAvailable: r.photoAssetId != null,
    }));
  }
  const rows = await db
    .select({
      ...staffSelect,
      staffId: closers.id,
      code: closers.closerCode,
      registeredOn: closers.registeredOn,
      dob: closers.dob,
      anniversaryDate: closers.anniversaryDate,
    })
    .from(closers)
    .innerJoin(users, eq(users.id, closers.userId))
    .where(and(...conds))
    .orderBy(desc(closers.id));
  return rows.map((r) => ({
    userId: r.userId,
    staffId: r.staffId,
    code: r.code,
    kind: "closer" as const,
    fullName: r.fullName,
    email: r.email,
    phone: r.phone ?? null,
    process: r.process,
    status: r.status,
    registeredOn: r.registeredOn,
    joiningDate: null,
    dob: r.dob ?? null,
    anniversaryDate: r.anniversaryDate ?? null,
    photoAvailable: r.photoAssetId != null,
  }));
}

/** One staff row by business code, filtered by the authoritative role. */
export async function getStaffRowByCode(
  kind: "agent" | "closer",
  code: string,
): Promise<StaffRow | undefined> {
  const rows = await listStaffRows(kind, {});
  return rows.find((r) => r.code === code);
}

/* ------------------------ profile edit + lifecycle ------------------- */

export interface StaffProfilePatch {
  fullName?: string;
  phone?: string | null;
  process?: string;
  status?: string;
  dob?: string | null;
  anniversaryDate?: string | null;
  /** agents only */
  joiningDate?: string | null;
}

/**
 * Admin/HR profile correction. Writes `users` (name / phone / process / status)
 * and the role registry (`dob` / `anniversary_date`, plus `joining_date` for
 * agents) in ONE transaction. Salary is handled separately by the existing
 * payroll salary-profile model. Never touches the role or any historical table.
 * Returns the changed field keys.
 */
export async function updateStaffProfileRow(
  userId: number,
  kind: "agent" | "closer",
  patch: StaffProfilePatch,
  now: string,
): Promise<string[]> {
  const changed: string[] = [];
  const userSet: Record<string, unknown> = {};
  if (patch.fullName !== undefined) {
    userSet["fullName"] = patch.fullName;
    changed.push("full_name");
  }
  if (patch.phone !== undefined) {
    userSet["phone"] = patch.phone;
    changed.push("phone");
  }
  if (patch.process !== undefined) {
    userSet["process"] = patch.process;
    changed.push("process");
  }
  if (patch.status !== undefined) {
    userSet["status"] = patch.status;
    changed.push("status");
  }

  const regSet: Record<string, unknown> = {};
  if (patch.dob !== undefined) {
    regSet["dob"] = patch.dob;
    changed.push("dob");
  }
  if (patch.anniversaryDate !== undefined) {
    regSet["anniversaryDate"] = patch.anniversaryDate;
    changed.push("anniversary_date");
  }
  if (kind === "agent" && patch.joiningDate !== undefined) {
    regSet["joiningDate"] = patch.joiningDate;
    changed.push("joining_date");
  }

  if (changed.length === 0) return changed;

  await getDb().transaction(async (tx) => {
    if (Object.keys(userSet).length) {
      await tx
        .update(users)
        .set({ ...userSet, updatedAt: now })
        .where(eq(users.id, userId));
    }
    if (Object.keys(regSet).length) {
      if (kind === "agent") {
        await tx
          .update(agents)
          .set({ ...regSet, updatedAt: now })
          .where(eq(agents.userId, userId));
      } else {
        await tx
          .update(closers)
          .set({ ...regSet, updatedAt: now })
          .where(eq(closers.userId, userId));
      }
    }
  });
  return changed;
}

/** Deactivate (terminate) a staff user — the authoritative "remove from active
 *  workforce" primitive. Sets status only; NO historical row is deleted. */
export async function deactivateStaffUser(userId: number, now: string): Promise<void> {
  await getDb()
    .update(users)
    .set({ status: "inactive", updatedAt: now })
    .where(eq(users.id, userId));
}

/** Update a staff member's `users.status` (+ phone). Admin/HR only (asserted in service). */
export async function updateStaffUser(
  userId: number,
  patch: { status?: string; phone?: string | null },
  now: string,
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.status !== undefined) set["status"] = patch.status;
  if (patch.phone !== undefined) set["phone"] = patch.phone;
  await getDb().update(users).set(set).where(eq(users.id, userId));
}

/**
 * Promote an AGENT user to CLOSER — Admin-only (asserted in the service).
 *
 *   - keeps the SAME `users` row (identity, email, employee id preserved) and
 *     flips only `users.role` → "closer"
 *   - keeps the existing `agents` row untouched, so historical lead ownership
 *     (`leads.agent_id`) and follow-up history are preserved
 *   - creates a `closers` registry row (with a server-generated code) unless one
 *     already exists — never a second `users` account
 *   - does NOT move any lead or follow-up
 *
 * Returns the closer code (new or pre-existing).
 */
export async function promoteAgentUserToCloser(
  userId: number,
  registeredOn: string,
  dob: string | null,
  now: string,
  anniversaryDate: string | null = null,
): Promise<{ closerCode: string; createdCloserRow: boolean }> {
  return getDb().transaction(async (tx) => {
    const existing = await tx
      .select({ code: closers.closerCode })
      .from(closers)
      .where(eq(closers.userId, userId))
      .limit(1);
    let closerCode = existing[0]?.code ?? null;
    let createdCloserRow = false;
    if (!closerCode) {
      closerCode = await nextStaffCode("closer", tx);
      // carry the identity fields forward so the same person reads consistently
      // as a Closer; the historical `agents` row is left untouched.
      await tx.insert(closers).values({
        userId,
        closerCode,
        dob,
        registeredOn,
        anniversaryDate,
        createdAt: now,
        updatedAt: now,
      });
      createdCloserRow = true;
    }
    await tx.update(users).set({ role: "closer", updatedAt: now }).where(eq(users.id, userId));
    return { closerCode, createdCloserRow };
  });
}

export async function emailExists(email: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return rows.length > 0;
}

/** Resolve the authenticated user into a Lead authorization actor. */
export async function resolveLeadActor(user: User): Promise<LeadActor> {
  let agentId: number | null = null;
  let closerId: number | null = null;
  if (user.role === "agent") agentId = (await getAgentByUserId(user.id))?.id ?? null;
  else if (user.role === "closer") closerId = (await getCloserByUserId(user.id))?.id ?? null;
  return { user: { id: user.id, role: user.role }, agentId, closerId };
}
