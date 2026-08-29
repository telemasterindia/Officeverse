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
function htmlBody(heading: string, lines: string[]): string {
  const body = lines.map((l) => `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`).join("");
  return `<div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111"><h2 style="font-size:16px;margin:0 0 12px">${escapeHtml(
    heading,
  )}</h2>${body}</div>`;
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
      html: htmlBody(title, lines.length ? lines : [title]),
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
