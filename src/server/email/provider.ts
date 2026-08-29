/**
 * Officeverse — email provider abstraction.
 *
 * Phase 5 declared this interface (persistence + queue only, no delivery).
 * Phase 14 wires a concrete DEVELOPMENT-SAFE provider so the salary-slip
 * send → confirm → record flow works end to end without a real transactional
 * provider and without any secret.
 *
 * Production (Resend / SES / Postmark / SMTP …) is still deferred: when a real
 * provider is added it registers here and `getEmailProvider()` returns it when
 * `OFFICEVERSE_EMAIL_PROVIDER` selects it. Nothing in this file reads a secret
 * or performs network I/O today.
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
  /** short identifier stored on the send row, e.g. "devlog" — never a secret */
  readonly name: string;
  send(msg: OutgoingEmail): Promise<EmailSendResult>;
}

/* ------------------------- dev-safe provider -------------------- */

export interface DevLogEntry {
  at: number;
  to: string;
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
    if (!msg.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.to)) {
      throw new Error("devlog provider: invalid recipient address");
    }
    devSeq += 1;
    const providerMessageId = `devlog-${Date.now()}-${devSeq}`;
    devOutbox.push({
      at: Date.now(),
      to: msg.to,
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

/* --------------------------- resolution ------------------------ */

/**
 * Resolve the active provider.
 *   - `OFFICEVERSE_EMAIL_PROVIDER=devlog`  → dev-safe provider (any env)
 *   - `OFFICEVERSE_EMAIL_PROVIDER=none`    → disabled (returns null)
 *   - unset + non-production                → dev-safe provider
 *   - unset + production                    → null (no real provider wired yet)
 */
export function getEmailProvider(): EmailProvider | null {
  const choice = env("OFFICEVERSE_EMAIL_PROVIDER")?.toLowerCase();
  if (choice === "devlog") return devLogEmailProvider;
  if (choice === "none") return null;
  if (!choice && !isProd()) return devLogEmailProvider;
  return null;
}

/** True once a provider (dev-safe or real) is active. */
export function isEmailProviderConfigured(): boolean {
  return getEmailProvider() !== null;
}
