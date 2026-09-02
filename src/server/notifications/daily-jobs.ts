/**
 * Officeverse — cron-driven daily jobs (Agent-side UAT #15 / #16).
 *
 * Called ONLY from `POST /internal/tick` (cron-secret authenticated). Both jobs
 * are idempotent per day via the email/notification `dedupeKey`, so a cron that
 * fires more than once a day produces no duplicates.
 *
 *   #15  runDailyFollowUpSummary — one plain email per agent who has any
 *        follow-up scheduled for today (IST): "You have N follow-ups for today."
 *   #16  runBirthdayGreetings   — one office birthday email per employee whose
 *        date of birth falls on today (IST), month + day match.
 *
 * Nothing here touches payroll, points, attendance or lead/follow-up state.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { agents, closers, users } from "@/lib/db/schema";
import { calendarTodayIST } from "../time";
import { listActiveScheduled } from "../db/repos/followups";
import { getUserById } from "../db/repos/users";
import { enqueueEmail } from "../email/service";
import { getCompanyBranding } from "../branding/service";
import { createNotification } from "./service";

/** Admin UAT §7/§9/§10 — the ONE central branding, resolved once per job run. */
async function brandingPayload(): Promise<{
  org_name: string;
  logo_url: string;
  doc_footer: string;
}> {
  const b = await getCompanyBranding().catch(() => null);
  return {
    org_name: b?.companyName ?? "TMI Officeverse",
    logo_url: b?.logoUrl ?? "",
    doc_footer: b?.documentFooter ?? "",
  };
}

export interface DailyJobResult {
  job: string;
  date: string;
  dryRun: boolean;
  candidates: number;
  emailsQueued: number;
  notificationsCreated: number;
  details?: unknown;
}

/* ----------------------------- #15 ------------------------------- */

export async function runDailyFollowUpSummary(opts: { dryRun: boolean }): Promise<DailyJobResult> {
  const today = calendarTodayIST();
  const base: DailyJobResult = {
    job: "daily_followup_summary",
    date: today,
    dryRun: opts.dryRun,
    candidates: 0,
    emailsQueued: 0,
    notificationsCreated: 0,
  };
  if (!isDbConfigured()) return base;

  const rows = await listActiveScheduled(`${today} 00:00:00`, `${today} 23:59:59`);
  // count SCHEDULED follow-ups per owner for today
  const byOwner = new Map<number, number>();
  for (const r of rows) byOwner.set(r.ownerUserId, (byOwner.get(r.ownerUserId) ?? 0) + 1);
  base.candidates = byOwner.size;
  if (opts.dryRun) return base;

  const brand = await brandingPayload();
  for (const [ownerUserId, count] of byOwner) {
    const u = await getUserById(ownerUserId).catch(() => null);
    // Agent-side scope: agents only, and only active accounts.
    if (!u || u.role !== "agent" || u.status !== "active" || !u.email) continue;

    const emailRes = await enqueueEmail({
      template: "FOLLOW_UP_DAILY_SUMMARY",
      toEmail: u.email,
      toName: u.fullName,
      toUserId: u.id,
      payload: { count, recipient_name: u.fullName, ...brand },
      relatedEntityType: "follow_up_daily",
      dedupeKey: `daily-followup:${u.id}:${today}:email`,
    }).catch(() => ({ created: false }));
    if (emailRes.created) base.emailsQueued++;

    const noteRes = await createNotification({
      recipientUserId: u.id,
      type: "followup.daily_summary",
      title: "Today's follow-ups",
      message: `You have ${count} ${count === 1 ? "follow-up" : "follow-ups"} for today.`,
      relatedEntityType: "follow_up_daily",
      dedupeKey: `daily-followup:${u.id}:${today}`,
    }).catch(() => ({ created: false }));
    if (noteRes.created) base.notificationsCreated++;
  }
  return base;
}

/* ----------------------------- #16 ------------------------------- */

export async function runBirthdayGreetings(opts: { dryRun: boolean }): Promise<DailyJobResult> {
  const today = calendarTodayIST();
  const [, mm, dd] = today.split("-");
  const year = today.slice(0, 4);
  const base: DailyJobResult = {
    job: "birthday_greetings",
    date: today,
    dryRun: opts.dryRun,
    candidates: 0,
    emailsQueued: 0,
    notificationsCreated: 0,
  };
  if (!isDbConfigured()) return base;

  const db = getDb();
  const want = `${mm}-${dd}`;

  const agentRows = await db
    .select({ userId: users.id, email: users.email })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .where(and(eq(users.status, "active"), sql`date_format(${agents.dob}, '%m-%d') = ${want}`));
  const closerRows = await db
    .select({ userId: users.id, email: users.email })
    .from(closers)
    .innerJoin(users, eq(users.id, closers.userId))
    .where(and(eq(users.status, "active"), sql`date_format(${closers.dob}, '%m-%d') = ${want}`));

  const seen = new Set<number>();
  const list = [...agentRows, ...closerRows].filter(
    (f) => Boolean(f.email) && !seen.has(f.userId) && (seen.add(f.userId), true),
  );
  base.candidates = list.length;
  if (opts.dryRun) return base;

  const brand = await brandingPayload();
  for (const person of list) {
    const u = await getUserById(person.userId).catch(() => null);
    if (!u || !u.email || u.status !== "active") continue;

    const emailRes = await enqueueEmail({
      template: "BIRTHDAY_GREETING",
      toEmail: u.email,
      toName: u.fullName,
      toUserId: u.id,
      payload: { recipient_name: u.fullName, ...brand },
      relatedEntityType: "birthday",
      dedupeKey: `birthday:${u.id}:${year}:email`,
    }).catch(() => ({ created: false }));
    if (emailRes.created) base.emailsQueued++;

    const noteRes = await createNotification({
      recipientUserId: u.id,
      type: "hr.birthday",
      title: `Happy Birthday, ${u.fullName.split(" ")[0]}! 🎂`,
      message: `Everyone at ${brand.org_name} wishes you a wonderful day.`,
      relatedEntityType: "birthday",
      dedupeKey: `birthday:${u.id}:${year}`,
    }).catch(() => ({ created: false }));
    if (noteRes.created) base.notificationsCreated++;
  }
  return base;
}

/** Run both — the single entry point `/internal/tick` calls. */
export async function runDailyTick(opts: { dryRun: boolean }): Promise<{
  ok: true;
  dryRun: boolean;
  followUpSummary: DailyJobResult;
  birthdays: DailyJobResult;
}> {
  const [followUpSummary, birthdays] = await Promise.all([
    runDailyFollowUpSummary(opts),
    runBirthdayGreetings(opts),
  ]);
  return { ok: true, dryRun: opts.dryRun, followUpSummary, birthdays };
}
