import { logger } from '../lib/logger';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Outbound email adapter. Production deployments configure SMTP (EMAIL_TRANSPORT=smtp, SMTP_URL).
 * In development the "console" transport prints messages to the server log so flows such as
 * password reset can be exercised without an email provider. Nothing is ever sent silently:
 * the transport in use is reported at startup.
 */
export interface EmailService {
  readonly transport: 'console' | 'smtp' | 'disabled' | 'memory';
  send(msg: EmailMessage): Promise<void>;
}

export function createConsoleEmail(): EmailService {
  return {
    transport: 'console',
    async send(msg) {
      logger.info(`\n──── email (console transport) ────\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n───────────────────────────────────`);
    },
  };
}

export function createDisabledEmail(): EmailService {
  return { transport: 'disabled', async send() {} };
}

/** Captures messages in memory — used by tests. */
export function createMemoryEmail(): EmailService & { outbox: EmailMessage[] } {
  const outbox: EmailMessage[] = [];
  return {
    transport: 'memory',
    outbox,
    async send(msg) {
      outbox.push(msg);
    },
  };
}

export async function createSmtpEmail(smtpUrl: string, from: string): Promise<EmailService> {
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport(smtpUrl);
  return {
    transport: 'smtp',
    async send(msg) {
      await transporter.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text });
    },
  };
}
