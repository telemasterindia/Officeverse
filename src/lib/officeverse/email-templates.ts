/**
 * Rendered email content for the follow-up workflow. Pure — no sending.
 * The reminder engine and the outbox panel both use these so the "resend"
 * preview is byte-identical to what the workflow queues automatically.
 */
import { DEMO_USERS, PROCESSES } from "./data";
import {
  displayDate,
  displayTime,
  nextShiftStart,
  resolveCustomer,
  shiftWindow,
  type FollowUpRecord,
} from "./followups";
import type { SessionUser } from "./types";

function origin(): string {
  return typeof window !== "undefined" ? window.location.origin : "https://crm.telemasterindia";
}

function emailFor(name: string): string {
  const demo = Object.values(DEMO_USERS).find((u) => u.name === name);
  if (demo) return demo.email;
  const first = name.toLowerCase().split(" ")[0] ?? "user";
  return `${first}@exclusiveverifiedleads.com`;
}

export interface RenderedEmail {
  kind: "closer-followup" | "shift-summary";
  to: string;
  to_name: string;
  subject: string;
  body: string;
  dedupe_key: string;
}

/** Closer-only reminder for a single follow-up. Customer data comes from the Lead. */
export function renderCloserEmail(fu: FollowUpRecord): RenderedEmail {
  const c = resolveCustomer(fu);
  const to = emailFor(fu.owner_name);
  const lines = [
    `Hi ${fu.owner_name.split(" ")[0]},`,
    ``,
    `You have a Closer follow-up coming up.`,
    ``,
    `  Customer:    ${c.name}`,
    `  Lead ID:     ${fu.lead_id}`,
    `  Phone:       ${c.phone}`,
    ...(c.email ? [`  Email:       ${c.email}`] : []),
    `  Follow-up:   ${displayDate(fu.scheduled_at)} at ${displayTime(fu.scheduled_at)}`,
    `  Owner:       ${fu.owner_name} (Closer)`,
    ...(c.file_name ? [`  Lead file:   ${c.file_name}`] : []),
    `  Notes:       ${fu.comment || "—"}`,
    ``,
    `Open the follow-up:  ${origin()}/followups/${fu.follow_up_id}`,
    ...(fu.lead_id ? [`Open the lead:       ${origin()}/leads/${fu.lead_id}`] : []),
    ``,
    `— TeleMaster India CRM · queued to outbox (no mail server connected)`,
  ];
  return {
    kind: "closer-followup",
    to,
    to_name: fu.owner_name,
    subject: `Upcoming Follow-up — ${c.name} — ${displayTime(fu.scheduled_at)}`,
    body: lines.join("\n"),
    dedupe_key: `mail|closer|${fu.follow_up_id}|${fu.scheduled_at}`,
  };
}

/** 4-hours-before-shift summary of the user's follow-ups for that shift. */
export function renderShiftEmail(user: SessionUser, items: FollowUpRecord[]): RenderedEmail {
  const startISO = nextShiftStart(user.process);
  const { end } = shiftWindow(user.process);
  const proc = PROCESSES[user.process];
  const rows =
    items.length === 0
      ? [`  No follow-ups are scheduled inside this shift window yet.`]
      : items.flatMap((f, i) => [
          `  ${i + 1}. ${displayTime(f.scheduled_at)} — ${resolveCustomer(f).name}  (Lead ${f.lead_id})`,
          `     Type:  ${f.owner_role === "closer" ? "Closer" : "Agent"} follow-up · Owner ${f.owner_name}`,
          `     Notes: ${f.comment || "—"}`,
          `     Open:  ${origin()}/followups/${f.follow_up_id}`,
        ]);
  const lines = [
    `Hi ${user.name.split(" ")[0]},`,
    ``,
    `Your ${proc.shift} starts at ${displayTime(startISO)} on ${displayDate(startISO)} (runs to ${end} IST).`,
    `You have ${items.length} follow-up${items.length === 1 ? "" : "s"} on your board for this shift:`,
    ``,
    ...rows,
    ``,
    `Full board: ${origin()}/followups`,
    ``,
    `— TeleMaster India CRM · queued to outbox (no mail server connected)`,
  ];
  return {
    kind: "shift-summary",
    to: user.email,
    to_name: user.name,
    subject: `Your Upcoming Shift — ${items.length} Follow-up${items.length === 1 ? "" : "s"}`,
    body: lines.join("\n"),
    dedupe_key: `mail|shift|${user.id}|${startISO.slice(0, 10)}`,
  };
}
