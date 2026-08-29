/**
 * Officeverse — staff lookups needed by the Lead authorization/service layer.
 *
 * Data access only. Full agent/closer/client CRUD is a later phase; this file
 * holds just the reads Phase 3 requires (resolve the caller's agent/closer id,
 * hydrate agent/closer name+code onto Lead DTOs).
 */
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { agents, closers, users, type Agent, type Closer, type User } from "@/lib/db/schema";
import type { LeadActor } from "../../authz/leads";

export async function getAgentByUserId(userId: number): Promise<Agent | undefined> {
  const rows = await getDb().select().from(agents).where(eq(agents.userId, userId)).limit(1);
  return rows[0];
}

export async function getCloserByUserId(userId: number): Promise<Closer | undefined> {
  const rows = await getDb().select().from(closers).where(eq(closers.userId, userId)).limit(1);
  return rows[0];
}

export async function getAgentByCode(code: string): Promise<Agent | undefined> {
  const rows = await getDb().select().from(agents).where(eq(agents.agentCode, code)).limit(1);
  return rows[0];
}

export async function getCloserByCode(code: string): Promise<Closer | undefined> {
  const rows = await getDb().select().from(closers).where(eq(closers.closerCode, code)).limit(1);
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

export interface StaffMeta {
  code: string;
  name: string;
}

export async function loadAgentMeta(ids: number[]): Promise<Map<number, StaffMeta>> {
  const map = new Map<number, StaffMeta>();
  if (!ids.length) return map;
  const rows = await getDb()
    .select({ id: agents.id, code: agents.agentCode, name: users.fullName })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .where(inArray(agents.id, ids));
  for (const r of rows) map.set(r.id, { code: r.code, name: r.name });
  return map;
}

export async function loadCloserMeta(ids: number[]): Promise<Map<number, StaffMeta>> {
  const map = new Map<number, StaffMeta>();
  if (!ids.length) return map;
  const rows = await getDb()
    .select({ id: closers.id, code: closers.closerCode, name: users.fullName })
    .from(closers)
    .innerJoin(users, eq(users.id, closers.userId))
    .where(inArray(closers.id, ids));
  for (const r of rows) map.set(r.id, { code: r.code, name: r.name });
  return map;
}

/** Resolve the authenticated user into a Lead authorization actor. */
export async function resolveLeadActor(user: User): Promise<LeadActor> {
  let agentId: number | null = null;
  let closerId: number | null = null;
  if (user.role === "agent") agentId = (await getAgentByUserId(user.id))?.id ?? null;
  else if (user.role === "closer") closerId = (await getCloserByUserId(user.id))?.id ?? null;
  return { user: { id: user.id, role: user.role }, agentId, closerId };
}
