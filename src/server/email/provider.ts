/**
 * Officeverse — email provider abstraction (Phase 5: DECLARED, NOT CONFIGURED).
 *
 * Phase 5 builds the persistence + queue only. NO transactional provider
 * (Resend / SES / Postmark / SMTP / …) is integrated or configured here. The
 * future email-delivery phase (15/16) implements a concrete `EmailProvider` and
 * wires `getEmailProvider()` to read provider settings from the environment.
 *
 * Nothing in this file performs network I/O or reads a secret value.
 */

export interface OutgoingEmail {
  to: string;
  toName?: string | null;
  subject: string;
  text: string;
  html?: string | null;
}

export interface EmailSendResult {
  providerMessageId?: string | null;
}

export interface EmailProvider {
  /** short identifier stored on the job row, e.g. "resend" — never a secret */
  readonly name: string;
  send(msg: OutgoingEmail): Promise<EmailSendResult>;
}

/**
 * Resolve the configured provider. Phase 5: always `null` (unconfigured). The
 * worker in a later phase treats `null` as "leave the job queued".
 */
export function getEmailProvider(): EmailProvider | null {
  // Intentionally unimplemented in Phase 5. A later phase inspects
  // process.env for the chosen provider and returns an adapter.
  return null;
}

/** True once a real provider has been wired up (future phases). */
export function isEmailProviderConfigured(): boolean {
  return getEmailProvider() !== null;
}
