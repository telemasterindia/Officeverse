/**
 * Officeverse — email provider abstraction (Phase 5 interface, Phase 14 dev
 * provider, Phase 15 real provider).
 *
 * `getEmailProvider()` resolves an `EmailProvider` from `OFFICEVERSE_EMAIL_PROVIDER`:
 *   - "devlog" → in-process dev-safe provider (any env)
 *   - "resend" → real transactional provider (needs RESEND_API_KEY)
 *   - "none"   → disabled (returns null)
 *   - unset    → devlog outside production, null in production
 *
 * Secrets (RESEND_API_KEY) are read ONLY here, server-side, via `env()`. They
 * are never returned to a caller, never put in audit metadata, never logged.
 * This module is server-only and never imported by client code.
 */
import { env, isProd } from "../env";

export interface EmailAttachment {
  filename: string;
  /** base64-encoded content */
  contentBase64: string;
  contentType: string;
}

export interface OutgoingEmail {
  to: string;
  toName?: string | null;
  from?: string | null;
  subject: string;
  text: string;
  html?: string | null;
  attachments?: EmailAttachment[];
}

export interface EmailSendResult {
  providerMessageId?: string | null;
}

export interface EmailProvider {
  /** short identifier stored on the send row, e.g. "devlog" / "resend" — never a secret */
  readonly name: string;
  send(msg: OutgoingEmail): Promise<EmailSendResult>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------- dev-safe provider -------------------- */

export interface DevLogEntry {
  at: number;
  to: string;
  from: string | null;
  subject: string;
  attachmentNames: string[];
  providerMessageId: string;
}

const devOutbox: DevLogEntry[] = [];
let devSeq = 0;

/**
 * A provider that "delivers" by appending to an in-process log. It never
 * touches the network. Used in development / tests so the full send flow —
 * including the provider CONFIRMING success — can be exercised.
 */
export const devLogEmailProvider: EmailProvider = {
  name: "devlog",
  async send(msg: OutgoingEmail): Promise<EmailSendResult> {
    if (!msg.to || !EMAIL_RE.test(msg.to)) {
      throw new Error("devlog provider: invalid recipient address");
    }
    devSeq += 1;
    const providerMessageId = `devlog-${Date.now()}-${devSeq}`;
    devOutbox.push({
      at: Date.now(),
      to: msg.to,
      from: msg.from ?? null,
      subject: msg.subject,
      attachmentNames: (msg.attachments ?? []).map((a) => a.filename),
      providerMessageId,
    });
    return { providerMessageId };
  },
};

/** Test / diagnostics helpers for the dev provider's in-memory log. */
export function getDevEmailOutbox(): readonly DevLogEntry[] {
  return devOutbox;
}
export function resetDevEmailOutbox(): void {
  devOutbox.length = 0;
  devSeq = 0;
}

/* --------------------------- resend provider ------------------- */

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface ResendProviderDeps {
  apiKey: string;
  defaultFrom: string;
  fetchImpl?: FetchLike;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Build a Resend-backed provider. The API key is captured here and never
 * exposed again — the returned object only reveals `name` and, per send, a
 * provider message id.
 */
export function makeResendProvider(deps: ResendProviderDeps): EmailProvider {
  const doFetch: FetchLike =
    deps.fetchImpl ??
    (globalThis.fetch as unknown as FetchLike | undefined) ??
    (() => {
      throw new Error("resend provider: fetch is not available in this runtime");
    });

  return {
    name: "resend",
    async send(msg: OutgoingEmail): Promise<EmailSendResult> {
      if (!msg.to || !EMAIL_RE.test(msg.to)) {
        throw new Error("resend provider: invalid recipient address");
      }
      const body = JSON.stringify({
        from: msg.from ?? deps.defaultFrom,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
        ...(msg.attachments && msg.attachments.length
          ? {
              attachments: msg.attachments.map((a) => ({
                filename: a.filename,
                content: a.contentBase64,
                content_type: a.contentType,
              })),
            }
          : {}),
      });

      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await doFetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${deps.apiKey}`,
            "Content-Type": "application/json",
          },
          body,
        });
      } catch {
        // never surface the request (it carries the bearer token)
        throw new Error("resend provider: network error contacting the email API");
      }

      if (!res.ok) {
        throw new Error(`resend provider: email API rejected the message (HTTP ${res.status})`);
      }
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      const providerMessageId =
        json && typeof json === "object" && "id" in json
          ? String((json as { id: unknown }).id)
          : null;
      return { providerMessageId };
    },
  };
}

/* --------------------------- resolution ------------------------ */

export interface EmailProviderStatus {
  configured: boolean;
  /** provider name if resolvable, else null */
  name: string | null;
  /** short, secret-free reason when not configured */
  reason: string | null;
}

function resendConfig(): { apiKey: string; from: string } | { error: string } {
  const apiKey = env("RESEND_API_KEY");
  if (!apiKey) return { error: "RESEND_API_KEY is not set" };
  const from = env("OFFICEVERSE_EMAIL_FROM") ?? env("EMAIL_FROM") ?? "no-reply@officeverse.local";
  return { apiKey, from };
}

/**
 * Resolve the active provider, or null when sending is disabled / unconfigured.
 * A missing production key returns null — callers must surface a controlled
 * error and must NOT fake a successful send.
 */
export function getEmailProvider(): EmailProvider | null {
  const choice = env("OFFICEVERSE_EMAIL_PROVIDER")?.toLowerCase();
  if (choice === "none") return null;
  if (choice === "devlog") return devLogEmailProvider;
  if (choice === "resend") {
    const cfg = resendConfig();
    if ("error" in cfg) return null;
    return makeResendProvider({ apiKey: cfg.apiKey, defaultFrom: cfg.from });
  }
  if (!choice && !isProd()) return devLogEmailProvider;
  return null;
}

export function isEmailProviderConfigured(): boolean {
  return getEmailProvider() !== null;
}

/** Secret-free description for diagnostics / the Admin UI. */
export function describeEmailProvider(): EmailProviderStatus {
  const choice = env("OFFICEVERSE_EMAIL_PROVIDER")?.toLowerCase();
  if (choice === "none") {
    return { configured: false, name: null, reason: "email sending is disabled (provider=none)" };
  }
  if (choice === "devlog") return { configured: true, name: "devlog", reason: null };
  if (choice === "resend") {
    const cfg = resendConfig();
    return "error" in cfg
      ? { configured: false, name: "resend", reason: cfg.error }
      : { configured: true, name: "resend", reason: null };
  }
  if (!choice && !isProd()) return { configured: true, name: "devlog", reason: null };
  return {
    configured: false,
    name: null,
    reason: "OFFICEVERSE_EMAIL_PROVIDER is not set (no provider in production)",
  };
}
