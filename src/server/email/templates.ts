/**
 * Officeverse — email template registry (Phase 5).
 *
 * PURE. No sending, no provider, no I/O. Business logic never hand-writes email
 * HTML: it passes a template id + a small typed payload and this module renders
 * `{ subject, text, html }`. Adding a template = add an id to EMAIL_TEMPLATES in
 * the schema + a renderer here (no migration — `email_jobs.kind` is a varchar).
 *
 * The rendered bodies are deliberately plain and provider-agnostic. The final
 * email-delivery phase (15/16) may re-render from `email_jobs.payload` with
 * richer, branded templates without touching this file's callers.
 */
import { EMAIL_TEMPLATES, type EmailTemplateId } from "@/lib/db/schema";

export type { EmailTemplateId };

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export type EmailPayload = Record<string, unknown>;

const KNOWN = new Set<string>(EMAIL_TEMPLATES);

export function isKnownTemplate(id: string): id is EmailTemplateId {
  return KNOWN.has(id);
}

/* ------------------------------- helpers ---------------------------- */

function str(payload: EmailPayload, key: string, fallback = ""): string {
  const v = payload[key];
  return v == null || v === "" ? fallback : String(v);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wrap plain lines in a minimal, self-contained HTML body. */
/**
 * Admin UAT §7 — every official email uses the ONE central company logo + name.
 * The renderer pulls `logo_url` / `org_name` / `doc_footer` from the payload;
 * the caller fills them from `getCompanyBranding()`. When no logo is configured
 * the header degrades to the company name only.
 */
function brandFromPayload(p: EmailPayload): { logoUrl: string; orgName: string; footer: string } {
  return {
    logoUrl: str(p, "logo_url"),
    orgName: str(p, "org_name", "TMI Officeverse"),
    footer: str(p, "doc_footer"),
  };
}

function htmlBody(heading: string, lines: string[], p: EmailPayload = {}): string {
  const { logoUrl, orgName, footer } = brandFromPayload(p);
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(orgName)}" style="max-height:40px;max-width:180px;display:block;margin:0 0 4px" />`
    : "";
  const header = `<div style="margin:0 0 14px">${logo}<div style="font-weight:600;color:#333">${escapeHtml(
    orgName,
  )}</div></div>`;
  const body = lines.map((l) => `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`).join("");
  const foot = footer
    ? `<p style="margin:16px 0 0;font-size:12px;color:#888">${escapeHtml(footer)}</p>`
    : "";
  return `<div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${header}<h2 style="font-size:16px;margin:0 0 12px">${escapeHtml(
    heading,
  )}</h2>${body}${foot}</div>`;
}

/* ------------------------------ renderers -------------------------- */

type Renderer = (p: EmailPayload) => RenderedEmail;

const RENDERERS: Record<EmailTemplateId, Renderer> = {
  FOLLOW_UP_REMINDER: (p) => {
    const customer = str(p, "customer_name", "your customer");
    const code = str(p, "follow_up_code", "your follow-up");
    const at = str(p, "scheduled_at", "soon");
    const lines = [
      `Hi ${str(p, "recipient_name", "there")},`,
      `Follow-up ${code} with ${customer} is due at ${at}.`,
      str(p, "comment") ? `Notes: ${str(p, "comment")}` : "",
    ].filter(Boolean);
    return {
      subject: `Follow-up due — ${customer} (${code})`,
      text: lines.join("\n"),
      html: htmlBody("Follow-up reminder", lines),
    };
  },

  FOLLOW_UP_RESCHEDULED: (p) => {
    const code = str(p, "follow_up_code", "A follow-up");
    const from = str(p, "from", "its previous time");
    const to = str(p, "to", "a new time");
    const lines = [
      `Hi ${str(p, "recipient_name", "there")},`,
      `Follow-up ${code} was rescheduled from ${from} to ${to}.`,
      str(p, "reason") ? `Reason: ${str(p, "reason")}` : "",
    ].filter(Boolean);
    return {
      subject: `Follow-up rescheduled — ${code}`,
      text: lines.join("\n"),
      html: htmlBody("Follow-up rescheduled", lines),
    };
  },

  LEAD_ASSIGNED: (p) => {
    const lead = str(p, "lead_code", "A lead");
    const customer = str(p, "customer_name", "a customer");
    const lines = [
      `Hi ${str(p, "recipient_name", "there")},`,
      `Lead ${lead} (${customer}) is now assigned to you.`,
      str(p, "source") ? `Source: ${str(p, "source")}` : "",
    ].filter(Boolean);
    return {
      subject: `Lead assigned — ${customer} (${lead})`,
      text: lines.join("\n"),
      html: htmlBody("Lead assigned", lines),
    };
  },

  LEAD_STATUS_CHANGED: (p) => {
    const lead = str(p, "lead_code", "A lead");
    const from = str(p, "from", "?");
    const to = str(p, "to", "?");
    const lines = [
      `Hi ${str(p, "recipient_name", "there")},`,
      `Lead ${lead} moved from ${from} to ${to}.`,
    ];
    return {
      subject: `Lead ${lead} — ${to}`,
      text: lines.join("\n"),
      html: htmlBody("Lead status changed", lines),
    };
  },

  SYSTEM_NOTIFICATION: (p) => {
    const title = str(p, "title", "Officeverse notification");
    const message = str(p, "message", "");
    const lines = [`Hi ${str(p, "recipient_name", "there")},`, message].filter(Boolean);
    return {
      subject: title,
      text: lines.join("\n") || title,
      html: htmlBody(title, lines.length ? lines : [title], p),
    };
  },

  // UAT #15 / Admin UAT §10 — one plain branded email per agent per day, stating
  // ONLY today's count. No customer names, phones or lead details.
  FOLLOW_UP_DAILY_SUMMARY: (p) => {
    const countRaw = Number(p["count"]);
    const count = Number.isFinite(countRaw) ? Math.max(0, Math.trunc(countRaw)) : 0;
    const noun = count === 1 ? "follow-up" : "follow-ups";
    const line = `You have ${count} ${noun} for today.`;
    return {
      subject: `You have ${count} ${noun} for today`,
      text: line,
      html: htmlBody("Today's follow-ups", [line], p),
    };
  },

  // UAT #16 / Admin UAT §9 — automatic branded office birthday greeting.
  BIRTHDAY_GREETING: (p) => {
    const name = str(p, "recipient_name", "there");
    const org = str(p, "org_name", "TMI Officeverse");
    const lines = [
      `Happy Birthday, ${name}! 🎉`,
      `Everyone at ${org} wishes you a wonderful day and a fantastic year ahead.`,
      `Thank you for being part of the team.`,
    ];
    return {
      subject: `Happy Birthday, ${name}! 🎂`,
      text: lines.join("\n"),
      html: htmlBody(`Happy Birthday from ${org}`, lines, p),
    };
  },

  // legacy identifiers — kept renderable so the pre-Phase-5 outbox concepts
  // still resolve if enqueued through the new pipeline.
  "closer-followup": (p) => RENDERERS.FOLLOW_UP_REMINDER(p),
  "shift-summary": (p) => RENDERERS.SYSTEM_NOTIFICATION({ title: "Your upcoming shift", ...p }),
};

/**
 * Render a template. Unknown ids throw — callers validate against
 * `isKnownTemplate` / the Zod schema first, so this is a guard, not a code path.
 */
export function renderEmailTemplate(id: string, payload: EmailPayload = {}): RenderedEmail {
  if (!isKnownTemplate(id)) {
    throw new Error(`Unknown email template "${id}"`);
  }
  return RENDERERS[id](payload);
}
